// 即刻宝可梦卡片生成器
// 1. 托管 public/ 静态文件
// 2. /api/profile?id=<uuid|username> 代理 m.okjike.com 的 SSR 数据
// 3. /api/img?u=<url> 代理即刻 CDN 图片并附带 CORS 头，供 canvas 导出使用
// 4. /og/default.png 与 /og/u/<id>.png 生成社交分享用横版 OG 图片

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildCard } from './public/card.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4399;
const HOST = process.env.HOST || undefined;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

const OG_W = 1200;
const OG_H = 630;
const OG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const OG_CACHE_MAX = 300;
const ogCache = new Map(); // key -> { png, expiresAt }
let defaultOgPng = null;

// ---- 频率限制：内存滑动窗口，按 key（IP）分桶 ----
const RATE_WINDOW_MS = 60_000;

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// 生成一个按 key 限流的函数：窗口内超过 max 次返回 true
function createRateLimiter(max, windowMs = RATE_WINDOW_MS) {
  const hits = new Map(); // key -> [timestamp, ...]
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }
    recent.push(now);
    hits.set(key, recent);
    // 防止 Map 无限增长：条目过多时清掉窗口外的 key
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return false;
  };
}

// /api/profile：每 IP 每分钟 10 次
const profileLimiter = createRateLimiter(10);
const isRateLimited = (req) => profileLimiter(clientIp(req));

// /og/u/<id>.png 缓存未命中（昂贵：上游抓取 + resvg 同步渲染）：每 IP 每分钟 30 次
const ogLimiter = createRateLimiter(30);

// 全局渲染预算：不论来源，每分钟最多 N 次渲染，兜底防分布式攻击打满 CPU
const RENDER_MAX_PER_MIN = 120;
let renderTimes = [];
function renderBudgetAvailable() {
  const now = Date.now();
  renderTimes = renderTimes.filter((t) => now - t < RATE_WINDOW_MS);
  if (renderTimes.length >= RENDER_MAX_PER_MIN) return false;
  renderTimes.push(now);
  return true;
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

function buildMetaTags(req, profileId = '') {
  const base = getPublicBaseUrl(req);
  const pageUrl = new URL(req.url, base).href;
  const imagePath = profileId ? `/og/u/${encodeURIComponent(profileId)}.png` : '/og/default.png';
  const imageUrl = new URL(imagePath, base).href;
  const title = '即可梦图鉴 · Jikémon';
  const description = profileId
    ? '这位即友的专属即可梦卡牌已经生成。'
    : '把你的即刻主页变成一张宝可梦风格的收藏卡牌。';
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

async function serveIndex(req, res, profileId = '') {
  try {
    const html = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    const withMeta = html.replace('</head>', `  ${buildMetaTags(req, profileId)}\n</head>`);
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(withMeta);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server Error');
  }
}

// 两张静态兜底图只渲染一次并缓存，攻击/失败路径零渲染成本
function defaultOg() {
  return (defaultOgPng ||= renderOgPng(defaultOgCard(), { isDefault: true }));
}
let notFoundOgPng = null;
function notFoundOg() {
  return (notFoundOgPng ||= renderOgPng(defaultOgCard('暂时没有捕捉到这位即友'), { isDefault: true }));
}

async function handleOgDefault(res) {
  sendPng(res, defaultOg(), 'public, max-age=3600, s-maxage=86400');
}

async function handleOgUser(id, res, req) {
  const key = `user:${id}`;
  const cached = ogCache.get(key);
  // 缓存命中：直接发已渲染的图，零成本，不消耗限流额度
  if (cached && cached.expiresAt > Date.now()) {
    return sendPng(res, cached.png, 'public, max-age=3600, s-maxage=86400');
  }
  // 缓存未命中 = 昂贵路径（上游抓取 + resvg 渲染）。按 IP 限流 + 全局渲染预算，
  // 超限则回退到已缓存的默认图（不抓取、不渲染），既挡攻击又不误伤正常分享。
  if (ogLimiter(clientIp(req)) || !renderBudgetAvailable()) {
    return sendPng(res, defaultOg(), 'public, max-age=60');
  }

  try {
    const data = await getProfileData(id);
    const card = buildCard(data);
    const avatarDataUri = await loadAvatarDataUri(card.avatar);
    const png = renderOgPng(card, { avatarDataUri });
    rememberOg(key, png);
    sendPng(res, png, 'public, max-age=3600, s-maxage=86400');
  } catch (err) {
    // OG 爬虫拿到图片比拿到错误页更重要；失败退回缓存的“未找到”模板（零渲染），原因放调试头。
    res.setHeader('X-OG-Fallback', safeHeader(err.message));
    sendPng(res, notFoundOg(), 'public, max-age=120');
  }
}

async function loadAvatarDataUri(url) {
  if (!url) return '';
  let target;
  try {
    target = new URL(url);
  } catch {
    return '';
  }
  if (!isOkjikeImageHost(target.hostname)) return '';
  try {
    const img = await fetchUrl(target.href, { Referer: 'https://m.okjike.com/' }, 2, isOkjikeImageHost);
    if (img.status !== 200) return '';
    const type = String(img.headers['content-type'] || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) return '';
    return `data:${type};base64,${img.body.toString('base64')}`;
  } catch {
    return '';
  }
}

function rememberOg(key, png) {
  ogCache.set(key, { png, expiresAt: Date.now() + OG_CACHE_TTL_MS });
  while (ogCache.size > OG_CACHE_MAX) {
    const oldest = ogCache.keys().next().value;
    ogCache.delete(oldest);
  }
}

function defaultOgCard(message = '粘贴即刻主页链接，捕捉你的专属即可梦') {
  const type = { name: '无', color: '#b7b1a1', dark: '#7a7059', bg: '#efece2' };
  return {
    name: '神秘即友',
    hp: '??',
    type,
    stage: { label: '等待捕捉' },
    rarity: { key: '?', label: '未知' },
    moves: [
      { name: '主页改写', dmg: '??', cost: 2, text: '把 web.okjike.com 的域名改成 web.jikemon.com，卡牌即刻现身。', type },
      { name: '图鉴闪光', dmg: '??', cost: 1, text: '根据公开主页、圈子和互动记录生成专属属性、技能与图鉴描述。', type },
    ],
    weakness: null,
    resistance: null,
    handSpeed: 1,
    trait: '未知',
    cardNo: 'No.????',
    infoLine: '即可梦连接 ｜ 关注 ??　　被关注 ??　　获赞 ??',
    flavor: message,
  };
}

function renderOgPng(card, options = {}) {
  const svg = renderOgSvg(card, options);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      loadSystemFonts: false,
      defaultFontFamily: 'Arial',
      fontFamilies: {
        sans: ['Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Arial'],
      },
    },
  });
  return Buffer.from(resvg.render().asPng());
}

function renderOgSvg(card, { avatarDataUri = '', isDefault = false } = {}) {
  const type = card.type || { name: '无', color: '#b7b1a1', dark: '#7a7059', bg: '#efece2' };
  const name = truncate(card.name || '神秘即友', 15);
  const trait = card.trait || '未知';
  const rarityKey = card.rarity?.key || '?';
  const rarityLabel = card.rarity?.label || '未知';
  const stageLabel = card.stage?.label || '基础';
  const title = isDefault ? '把即刻主页变成专属卡牌' : `${name} 的即可梦卡牌`;
  const subtitle = isDefault ? 'JIKÉMON · 社交网站分享预览' : `${type.name}系 · ${trait} · ${stageLabel}`;
  const moves = normalizedMoves(card);
  const flavorLines = wrap(card.flavor || '', isDefault ? 27 : 18, 1);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b3a2d"/>
      <stop offset="0.52" stop-color="#10241c"/>
      <stop offset="1" stop-color="#142b36"/>
    </linearGradient>
    <radialGradient id="glowGold" cx="0.34" cy="0.18" r="0.72">
      <stop offset="0" stop-color="#e8c565" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#e8c565" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowType" cx="0.7" cy="0.76" r="0.62">
      <stop offset="0" stop-color="${xml(type.color)}" stop-opacity="0.52"/>
      <stop offset="1" stop-color="${xml(type.color)}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="goldText" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff2ae"/>
      <stop offset="1" stop-color="#d9a83c"/>
    </linearGradient>
    <linearGradient id="cardFrame" x1="0" y1="0" x2="1" y2="1">
      ${frameStops(rarityKey)}
    </linearGradient>
    <linearGradient id="innerPaper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf4"/>
      <stop offset="1" stop-color="#f3ead1"/>
    </linearGradient>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#000000" flood-opacity="0.48"/>
    </filter>
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
    <clipPath id="artClip"><rect x="116" y="154" width="304" height="170" rx="4"/></clipPath>
    <clipPath id="avatarClip"><circle cx="268" cy="239" r="63"/></clipPath>
  </defs>

  <rect width="1200" height="630" fill="url(#bgTop)"/>
  <rect width="1200" height="630" fill="url(#glowGold)"/>
  <rect width="1200" height="630" fill="url(#glowType)"/>
  <circle cx="1010" cy="92" r="220" fill="none" stroke="#e8c565" stroke-opacity="0.12" stroke-width="18"/>
  <circle cx="1040" cy="96" r="142" fill="none" stroke="${xml(type.color)}" stroke-opacity="0.22" stroke-width="10"/>

  ${renderMiniCard(card, avatarDataUri)}

  <g class="text" font-family="Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Arial, sans-serif">
    <text x="500" y="93" fill="url(#goldText)" font-size="64" font-weight="900" filter="url(#textShadow)">即可梦图鉴</text>
    <text x="503" y="128" fill="#9db8a7" font-size="18" letter-spacing="4">JIKÉMON · SOCIAL CARD PREVIEW</text>

    <text x="500" y="210" fill="#fffdf4" font-size="${isDefault ? 42 : 54}" font-weight="900">${xml(title)}</text>
    <text x="503" y="252" fill="#d8cfae" font-size="23" font-weight="700">${xml(subtitle)}</text>

    ${renderStatGrid(card, type)}

    <text x="503" y="423" fill="#e8c565" font-size="18" font-weight="900" letter-spacing="3">技能</text>
    ${renderOgMove(503, 448, moves[0], type)}
    ${renderOgMove(503, 515, moves[1], type)}

    <text x="503" y="603" fill="#9db8a7" font-size="20" font-weight="700">${xml(flavorLines[0] || '把 web.okjike.com 改成 web.jikemon.com')}</text>
    <rect x="880" y="572" width="272" height="44" rx="22" fill="#e8c565" opacity="0.96"/>
    <text x="1016" y="601" text-anchor="middle" fill="#10241c" font-size="19" font-weight="900">web.jikemon.com</text>
  </g>
</svg>`;
}

function renderMiniCard(card, avatarDataUri) {
  const type = card.type || { name: '无', color: '#b7b1a1', dark: '#7a7059', bg: '#efece2' };
  const moves = normalizedMoves(card);
  const name = truncate(card.name || '神秘即友', 9);
  const stage = truncate(card.stage?.label || '基础', 6);
  const rarity = `${card.rarity?.key || '?'} · ${card.rarity?.label || '未知'}`;
  const flavorLines = wrap(card.flavor || '', 27, 2);
  const hp = String(card.hp || '??');

  return `<g filter="url(#softShadow)" font-family="Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Arial, sans-serif">
    <rect x="88" y="64" width="360" height="504" rx="18" fill="url(#cardFrame)"/>
    <rect x="102" y="78" width="332" height="476" rx="9" fill="url(#innerPaper)" stroke="#1d1a12" stroke-opacity="0.22"/>
    <rect x="116" y="100" width="68" height="24" rx="12" fill="#efe8d1" stroke="#a89f8e"/>
    <text x="150" y="117" text-anchor="middle" fill="#5b523f" font-size="12" font-weight="900">${xml(stage)}</text>
    <text x="198" y="122" fill="#2b2620" font-size="26" font-weight="900">${xml(name)}</text>
    <text x="374" y="122" text-anchor="end" fill="#c22a2a" font-size="25" font-weight="900">HP${xml(hp)}</text>
    <circle cx="395" cy="112" r="15" fill="${xml(type.color)}" stroke="#ffffff" stroke-width="3"/>
    <text x="395" y="118" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="900">${xml(type.name)}</text>

    <g clip-path="url(#artClip)">
      <rect x="116" y="154" width="304" height="170" fill="${xml(type.bg || '#efece2')}"/>
      ${rippleSvg(type)}
      <circle cx="268" cy="239" r="68" fill="#fffdf4" opacity="0.84"/>
      ${
        avatarDataUri
          ? `<image href="${attr(avatarDataUri)}" x="205" y="176" width="126" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
          : `<text x="268" y="276" text-anchor="middle" fill="#cfc8b6" font-size="120" font-weight="900">?</text>`
      }
    </g>
    <rect x="116" y="154" width="304" height="170" fill="none" stroke="#d8cda6" stroke-width="7"/>
    <circle cx="268" cy="239" r="65" fill="none" stroke="#fffdf4" stroke-width="5" opacity="0.95"/>

    <rect x="128" y="336" width="280" height="24" rx="12" fill="#e5d8b2" stroke="#b3a67c"/>
    <text x="268" y="352" text-anchor="middle" fill="#4a4437" font-size="11" font-weight="700">${xml(truncate(card.infoLine || '', 28))}</text>

    ${renderMiniMove(120, 382, moves[0], type)}
    ${renderMiniMove(120, 451, moves[1], type)}

    <line x1="122" y1="512" x2="414" y2="512" stroke="#000000" stroke-opacity="0.18" stroke-width="2"/>
    <text x="122" y="532" fill="#6b6350" font-size="10">${xml(flavorLines[0] || '')}</text>
    ${flavorLines[1] ? `<text x="122" y="547" fill="#6b6350" font-size="10">${xml(flavorLines[1])}</text>` : ''}
    <text x="122" y="566" fill="#6b6350" font-size="10">${xml(card.cardNo || 'No.????')}</text>
    <text x="268" y="566" text-anchor="middle" fill="#6b6350" font-size="10">illus. JIKÉMON</text>
    <text x="414" y="566" text-anchor="end" fill="#6b6350" font-size="10" font-weight="900">${xml(rarity)}</text>
  </g>`;
}

function renderMiniMove(x, y, move, fallbackType) {
  const type = move.type || fallbackType;
  const cost = Math.max(1, Math.min(3, Number(move.cost) || 1));
  const dots = Array.from({ length: cost }, (_, i) => {
    const cx = x + 10 + i * 19;
    return `<circle cx="${cx}" cy="${y + 9}" r="8" fill="${xml(type.color)}" stroke="#fff" stroke-width="1.5"/>
      <text x="${cx}" y="${y + 13}" text-anchor="middle" fill="#fff" font-size="8" font-weight="900">${xml(type.name)}</text>`;
  }).join('');
  const text = wrap(move.text || '', 26, 1)[0] || '';
  return `<g>
    ${dots}
    <text x="${x + 68}" y="${y + 11}" fill="#2b2620" font-size="16" font-weight="900">${xml(truncate(move.name, 8))}</text>
    <text x="410" y="${y + 12}" text-anchor="end" fill="#2b2620" font-size="17" font-weight="900">${xml(String(move.dmg || ''))}</text>
    <text x="${x + 68}" y="${y + 32}" fill="#4a4437" font-size="10">${xml(text)}</text>
  </g>`;
}

function renderStatGrid(card, type) {
  const stats = [
    ['HP', String(card.hp || '??')],
    ['属性', `${type.name}系`],
    ['稀有度', `${card.rarity?.key || '?'} · ${card.rarity?.label || '未知'}`],
    ['阶段', card.stage?.label || '基础'],
  ];
  return stats.map(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 503 + col * 184;
    const y = 284 + row * 62;
    return `<g>
      <rect x="${x}" y="${y}" width="164" height="50" rx="8" fill="#fffdf4" fill-opacity="0.08" stroke="#e8c565" stroke-opacity="0.22"/>
      <text x="${x + 18}" y="${y + 22}" fill="#9db8a7" font-size="13" font-weight="700">${xml(label)}</text>
      <text x="${x + 18}" y="${y + 43}" fill="#fffdf4" font-size="20" font-weight="900">${xml(truncate(value, 10))}</text>
    </g>`;
  }).join('');
}

function renderOgMove(x, y, move, fallbackType) {
  const type = move.type || fallbackType;
  const text = wrap(move.text || '', 32, 1)[0] || '';
  return `<g>
    <rect x="${x}" y="${y}" width="546" height="52" rx="8" fill="#fffdf4" fill-opacity="0.07" stroke="${xml(type.color)}" stroke-opacity="0.42"/>
    <circle cx="${x + 28}" cy="${y + 26}" r="15" fill="${xml(type.color)}" stroke="#fffdf4" stroke-opacity="0.82" stroke-width="2"/>
    <text x="${x + 28}" y="${y + 32}" text-anchor="middle" fill="#fff" font-size="13" font-weight="900">${xml(type.name)}</text>
    <text x="${x + 58}" y="${y + 22}" fill="#fffdf4" font-size="20" font-weight="900">${xml(truncate(move.name, 12))}</text>
    <text x="${x + 518}" y="${y + 23}" text-anchor="end" fill="#e8c565" font-size="21" font-weight="900">${xml(String(move.dmg || ''))}</text>
    <text x="${x + 58}" y="${y + 43}" fill="#9db8a7" font-size="14">${xml(text)}</text>
  </g>`;
}

function normalizedMoves(card) {
  const fallback = card.type || { name: '无', color: '#b7b1a1' };
  const moves = Array.isArray(card.moves) ? card.moves.slice(0, 2) : [];
  while (moves.length < 2) {
    moves.push({ name: '神秘招式', dmg: '??', cost: 1, text: '等待更多公开动态被捕捉。', type: fallback });
  }
  return moves;
}

function rippleSvg(type) {
  const strong = mixWhite(type.color || '#b7b1a1', 0.4);
  const weak = mixWhite(type.color || '#b7b1a1', 0.1);
  return Array.from({ length: 16 }, (_, i) => {
    const r = 236 - i * 15;
    const fill = i % 2 === 0 ? weak : strong;
    return `<circle cx="268" cy="225" r="${r}" fill="${fill}"/>`;
  }).join('');
}

function frameStops(key) {
  if (key === 'UR') {
    return [
      ['0%', '#f7c3d0'],
      ['20%', '#f9e79b'],
      ['42%', '#b9f0c3'],
      ['64%', '#a9d8f5'],
      ['82%', '#d5b8f2'],
      ['100%', '#f7c3d0'],
    ].map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
  }
  const palettes = {
    C: ['#e1dbcf', '#a89f8e', '#cfc8bb'],
    U: ['#f0aa72', '#a05f2e', '#d8925c'],
    R: ['#a5c6ec', '#40679e', '#7fa8d9'],
    SR: ['#fff0a3', '#c9982e', '#f3d048'],
    '?': ['#ded8ca', '#a89f8e', '#cfc8bb'],
  };
  const colors = palettes[key] || palettes.SR;
  return `<stop offset="0" stop-color="${colors[0]}"/><stop offset="0.52" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/>`;
}

function mixWhite(hex, pct) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * pct + 255 * (1 - pct));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function wrap(text, maxUnits, maxLines) {
  const chars = String(text || '').replace(/\s+/g, ' ').trim();
  if (!chars) return [];
  const lines = [];
  let line = '';
  let units = 0;
  for (const ch of chars) {
    const u = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (units + u > maxUnits && line) {
      lines.push(line.trim());
      line = ch;
      units = u;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
      units += u;
    }
  }
  if (lines.length < maxLines && line) lines.push(line.trim());
  if (lines.length === maxLines && line.length < chars.length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1], maxUnits);
  }
  return lines;
}

function truncate(text, maxUnits) {
  const s = String(text || '');
  let out = '';
  let units = 0;
  for (const ch of s) {
    const u = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (units + u > maxUnits) return out + '…';
    out += ch;
    units += u;
  }
  return out;
}

function xml(v) {
  return String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function attr(v) {
  return xml(v);
}

function safeHeader(v) {
  return String(v || '').replace(/[^\t\x20-\x7e]/g, '').slice(0, 180);
}

function sendPng(res, png, cacheControl) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': png.length,
    'Cache-Control': cacheControl,
  });
  res.end(png);
}

function sendPngHead(res, cacheControl) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': cacheControl,
  });
  res.end();
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, getPublicBaseUrl(req));
  const ogUserMatch = url.pathname.match(/^\/og\/u\/([\w-]+)\.png$/);

  if (url.pathname === '/api/profile') {
    if (isRateLimited(req))
      return sendJson(res, 429, { error: '捕捉太频繁，精灵球冷却中，休息一分钟再来吧' });
    return handleProfile(url.searchParams, res);
  }
  if (url.pathname === '/api/img') return handleImage(url.searchParams, res);
  if (url.pathname === '/og/default.png') {
    if (req.method === 'HEAD') return sendPngHead(res, 'public, max-age=3600, s-maxage=86400');
    return handleOgDefault(res);
  }
  if (ogUserMatch) {
    if (req.method === 'HEAD') return sendPngHead(res, 'public, max-age=3600, s-maxage=86400');
    return handleOgUser(ogUserMatch[1], res, req);
  }
  if (url.pathname === '/') return serveIndex(req, res);
  // 直达链接：/u/<id> 与即刻个人页同构，把 web.okjike.com 换成本站域名即可直接出卡
  if (/^\/u\/[\w-]+$/.test(url.pathname)) return serveIndex(req, res, url.pathname.slice(3));
  serveStatic(url.pathname, res);
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
