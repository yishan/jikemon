// 即刻宝可梦卡片生成器 — 零依赖 Node 服务器
// 1. 托管 public/ 静态文件
// 2. /api/profile?id=<uuid|username> 代理 m.okjike.com 的 SSR 数据（浏览器直接请求会被 CORS 拦截）
// 3. /api/img?u=<url> 代理即刻 CDN 图片并附带 CORS 头，供 canvas 导出使用
// 4. 为 / 与 /u/<id> 注入固定 OG 图片，避免社交爬虫触发动态抓取/渲染

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4399;
const HOST = process.env.HOST || undefined;
const PUBLIC_DIR = path.join(__dirname, 'public');
const OG_W = 1200;
const OG_H = 630;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ---- 频率限制：/api/profile 按 IP 每分钟 10 次（内存滑动窗口） ----
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateHits = new Map(); // ip -> [timestamp, ...]

function isRateLimited(req) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    rateHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  // 防止 Map 无限增长：条目过多时清掉窗口外的 IP
  if (rateHits.size > 10_000) {
    for (const [k, v] of rateHits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return false;
}

// 即刻域名白名单：短链 okjk.co、m/web.okjike.com。用于 SSRF 防护（含每一跳重定向）。
function isOkjikeHost(h) {
  return h === 'okjk.co' || h === 'okjike.com' || h.endsWith('.okjike.com');
}

function isOkjikeImageHost(h) {
  return /(^|\.)ruguoapp\.com$/.test(h) || /(^|\.)okjike\.com$/.test(h);
}

// 跟随重定向抓取。okjk.co 短链会 302 到 http:// 的 m.okjike.com，故按协议选择 http/https。
// hostGuard 若提供，则校验初始及每一跳的目标域名，防止被重定向到站外。
function fetchUrl(url, headers = {}, redirects = 3, hostGuard = null) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('URL 无效'));
    }
    if (hostGuard && !hostGuard(u.hostname)) return reject(new Error('不允许的域名: ' + u.hostname));
    const mod = u.protocol === 'http:' ? http : https;
    mod
      .get(u, { headers: { 'User-Agent': MOBILE_UA, ...headers } }, (res) => {
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return resolve(fetchUrl(next, headers, redirects - 1, hostGuard));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      })
      .on('error', reject);
  });
}

// 把用户各种形态的输入解析成一个可抓取的即刻页面 URL：
// - okjk.co/<短码>：短链里没有 UUID，直接抓取并跟随跳转（会落到 m.okjike.com/users/<uuid>）
// - web.okjike.com/u/<id> · m.okjike.com/user(s)/<id> · 裸 /u/<id> 路径 · 裸 UUID：
//   提取出 ID 后统一拼成 m.okjike.com/users/<id>（web 端是 SPA 无 SSR 数据，不能直接抓）
function resolveProfileUrl(raw) {
  if (/^https?:\/\//i.test(raw)) {
    let host;
    try {
      host = new URL(raw).hostname;
    } catch {
      return { error: '链接无效' };
    }
    if (!isOkjikeHost(host)) return { error: '仅支持即刻链接（okjike.com / okjk.co）' };
    if (host === 'okjk.co') return { url: raw }; // 短链：跟随跳转解析
  }
  const m = raw.match(/\/u(?:sers?)?\/([\w-]+)/); // 匹配 /u/ /user/ /users/
  const id = m ? m[1] : /^https?:\/\//i.test(raw) ? null : raw;
  if (!id) return { error: '无法从链接中识别用户 ID' };
  return { url: `https://m.okjike.com/users/${encodeURIComponent(id)}` };
}

async function getProfileData(raw) {
  const resolved = resolveProfileUrl(raw);
  if (resolved.error) throw new Error(resolved.error);

  const page = await fetchUrl(resolved.url, {}, 4, isOkjikeHost);
  const html = page.body.toString('utf-8');
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error('未能在页面中找到用户数据，可能是用户不存在');
  const data = JSON.parse(match[1]);
  const props = data?.props?.pageProps;
  if (!props?.user) throw new Error('用户不存在');
  return { user: props.user, posts: props.posts || [] };
}

async function handleProfile(query, res) {
  const raw = (query.get('id') || '').trim();
  if (!raw) return sendJson(res, 400, { error: '缺少 id 参数' });

  try {
    sendJson(res, 200, await getProfileData(raw));
  } catch (err) {
    const isBadInput = err.message.includes('链接') || err.message.includes('URL') || err.message.includes('域名');
    const status = err.message === '用户不存在' ? 404 : isBadInput ? 400 : 502;
    sendJson(res, status, { error: '抓取即刻数据失败: ' + err.message });
  }
}

async function handleImage(query, res) {
  const u = query.get('u') || '';
  let target;
  try {
    target = new URL(u);
  } catch {
    return sendJson(res, 400, { error: 'URL 无效' });
  }
  // 只代理即刻自家 CDN，避免开放代理
  if (!isOkjikeImageHost(target.hostname)) {
    return sendJson(res, 403, { error: '仅允许即刻 CDN 域名' });
  }
  try {
    const img = await fetchUrl(target.href, { Referer: 'https://m.okjike.com/' });
    res.writeHead(img.status === 200 ? 200 : 502, {
      'Content-Type': img.headers['content-type'] || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(img.body);
  } catch (err) {
    sendJson(res, 502, { error: '图片代理失败: ' + err.message });
  }
}

function getPublicBaseUrl(req) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function buildMetaTags(req) {
  const base = getPublicBaseUrl(req);
  const pageUrl = new URL(req.url, base).href;
  const imageUrl = new URL('/og.png', base).href;
  const title = '即可梦图鉴 · Jikémon';
  const description = '把你的即刻主页变成一张宝可梦风格的收藏卡牌。';
  return [
    `<link rel="canonical" href="${attr(pageUrl)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${attr(pageUrl)}" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(description)}" />`,
    `<meta property="og:image" content="${attr(imageUrl)}" />`,
    `<meta property="og:image:secure_url" content="${attr(imageUrl)}" />`,
    '<meta property="og:image:type" content="image/png" />',
    `<meta property="og:image:width" content="${OG_W}" />`,
    `<meta property="og:image:height" content="${OG_H}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${attr(title)}" />`,
    `<meta name="twitter:description" content="${attr(description)}" />`,
    `<meta name="twitter:image" content="${attr(imageUrl)}" />`,
  ].join('\n  ');
}

async function serveIndex(req, res) {
  try {
    const html = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    const withMeta = html.replace('</head>', `  ${buildMetaTags(req)}\n</head>`);
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(withMeta);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server Error');
  }
}

function attr(v) {
  return String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res, method = 'GET') {
  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname === '/og.png' ? 'public, max-age=86400, s-maxage=604800' : 'public, max-age=0',
    });
    if (method === 'HEAD') return res.end();
    res.end(buf);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, getPublicBaseUrl(req));
  if (url.pathname === '/api/profile') {
    if (isRateLimited(req))
      return sendJson(res, 429, { error: '捕捉太频繁，精灵球冷却中，休息一分钟再来吧' });
    return handleProfile(url.searchParams, res);
  }
  if (url.pathname === '/api/img') return handleImage(url.searchParams, res);
  if (url.pathname === '/og.png') return serveStatic('/og.png', res, req.method);
  // 兼容旧版动态 OG URL，避免线上缓存或旧分享链接读到 404。
  if (url.pathname === '/og/default.png' || /^\/og\/u\/[\w-]+\.png$/.test(url.pathname)) {
    return serveStatic('/og.png', res, req.method);
  }
  if (url.pathname === '/') return serveIndex(req, res);
  // 直达链接：/u/<id> 与即刻个人页同构，把 web.okjike.com 换成本站域名即可直接出卡
  if (/^\/u\/[\w-]+$/.test(url.pathname)) return serveIndex(req, res);
  serveStatic(url.pathname, res, req.method);
}

http
  .createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Server Error');
    });
  })
  .listen(PORT, HOST, () => console.log(`即刻宝可梦卡片生成器 → http://${HOST || 'localhost'}:${PORT}`));
