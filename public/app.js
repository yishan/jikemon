import { buildCard } from './card.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const input = $('input');
const openBtn = $('openBtn');
const status = $('status');
const arena = $('arena');
const cardEl = $('card');
const tilt = $('tilt');
const dossier = $('dossier');
const actions = $('actions');

let currentCardNo = ''; // 当前卡片编号（如 No.1228），用于导出文件名
let currentCard = null; // 当前卡片对象，供导出合成读取属性/特质

// 从输入中提取用户 ID：支持 /u/ /user/ /users/ 路径或裸 ID（仅用作地址栏回退，权威 ID 用响应里的 username）
function extractId(raw) {
  const m = raw.match(/\/u(?:sers?)?\/([\w-]+)/);
  return m ? m[1] : raw;
}

// 卡片固定 366px 设计，窄屏按可用宽度等比缩放（写入 CSS 变量 --m），避免文字重排导致排版变形
const CARD_W = 366;
const stageEl = document.querySelector('.stage');
function fitCard() {
  const cs = getComputedStyle(stageEl);
  const avail = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const m = Math.min(1, avail / CARD_W);
  document.documentElement.style.setProperty('--m', m.toFixed(4));
}
fitCard();
window.addEventListener('resize', fitCard);

// 中央「抓取」按钮点击即提交表单（等同回车）
openBtn.addEventListener('click', () => form.requestSubmit());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = input.value.trim();
  if (!id) {
    setStatus('先在上方粘贴你的即刻主页链接～');
    input.focus();
    return;
  }
  setStatus('掷出精灵球，正在捕捉…');
  openBtn.disabled = true;
  openBtn.textContent = '捕捉中…';
  try {
    const res = await fetch(`/api/profile?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '捕捉失败');
    const card = buildCard(data);
    render(card);
    setStatus('');
    // 地址栏同步为可分享的直达链接：用响应里的权威 username（okjk.co 短链等也能正确归一）
    const canonicalId = data.user?.username || extractId(id);
    history.replaceState(null, '', `/u/${canonicalId}`);
  } catch (err) {
    setStatus('💨 它逃走了：' + err.message);
    // 回到占位卡，让用户可重试
    renderPlaceholder();
    openBtn.hidden = false;
    dossier.hidden = true;
    actions.hidden = true;
  } finally {
    openBtn.disabled = false;
    openBtn.textContent = '捕捉';
  }
});

// 初始：先渲染神秘占位卡（全「?」+ 中央抓取按钮）
renderPlaceholder();

// 直达链接：访问 /u/<id> 时自动填入并生成。
// 即刻推广场景：把 web.okjike.com/u/xxx 的域名换成本站域名，落地即出卡。
const pathId = location.pathname.match(/^\/u\/([\w-]+)/);
if (pathId) {
  // 输入框始终展示即刻原始链接的样子，让用户明白粘贴什么
  input.value = `https://web.okjike.com/u/${pathId[1]}`;
  form.requestSubmit();
}

function setStatus(msg) {
  status.textContent = msg;
  status.hidden = !msg;
}

function energyDots(type, count) {
  return Array.from(
    { length: count },
    () => `<span class="energy" style="--e-color:${type.color}">${type.icon}</span>`
  ).join('');
}

function proxied(url) {
  return url ? `/api/img?u=${encodeURIComponent(url)}` : '';
}

// 开卡礼花：真卡揭晓瞬间从卡片中心爆开，两侧再补两炮
function celebrate() {
  if (typeof confetti !== 'function') return; // CDN 未就绪则静默跳过
  const r = cardEl.getBoundingClientRect();
  const x = (r.left + r.width / 2) / window.innerWidth;
  const y = (r.top + r.height * 0.42) / window.innerHeight;
  const colors = ['#f5d03e', '#ef5b3a', '#3d9be9', '#4caf50', '#a75fbe', '#45b8ac', '#ffffff'];
  confetti({ particleCount: 130, spread: 100, startVelocity: 48, origin: { x, y }, colors, scalar: 0.95, ticks: 220 });
  setTimeout(() => {
    confetti({ particleCount: 60, angle: 65, spread: 70, startVelocity: 42, origin: { x: Math.max(0, x - 0.22), y }, colors });
    confetti({ particleCount: 60, angle: 115, spread: 70, startVelocity: 42, origin: { x: Math.min(1, x + 0.22), y }, colors });
  }, 130);
}

// 抓取前的神秘占位卡：各字段用「?」，中央浮着抓取按钮，吸引用户开卡
function renderPlaceholder() {
  cardEl.dataset.rarity = 'C'; // 中性银灰卡框
  cardEl.classList.add('is-mystery');
  cardEl.classList.remove('reveal');
  cardEl.style.setProperty('--type-color', '#b7b1a1');
  cardEl.style.setProperty('--type-bg', '#efece2');
  cardEl.style.setProperty('--ripple-strong', '#e2ded1');
  cardEl.style.setProperty('--ripple-weak', '#f5f2ea');
  const q = '？？？？？？？？？？？？？？？？？？';
  cardEl.innerHTML = `
    <div class="card-inner">
      <div class="card-top">
        <span class="stage-chip">？？</span>
        <h2 class="card-name">? ? ?</h2>
        <span class="card-hp"><small>HP</small>??</span>
        <span class="type-orb" style="--type-color:#b7b1a1">?</span>
      </div>
      <div class="card-art"><div class="mystery-q">?</div></div>
      <div class="card-info">即可梦连接 ｜ 关注 ??　　被关注 ??　　获赞 ??</div>
      <div class="moves">
        ${[0, 1]
          .map(
            () => `
        <div class="move">
          <span class="move-cost"><span class="energy" style="--e-color:#b7b1a1">?</span></span>
          <div class="move-main">
            <div class="move-head"><span class="move-name">？ ？ ？ ？</span><span class="move-dmg">??</span></div>
            <p class="move-text">${q}</p>
          </div>
        </div>`
          )
          .join('')}
      </div>
      <div class="card-bottom">
        <div class="cb-cell"><b>弱点</b><span class="cb-val">?</span></div>
        <div class="cb-cell"><b>抵抗力</b><span class="cb-val">?</span></div>
        <div class="cb-cell"><b>网感</b><span class="cb-val">?</span></div>
      </div>
      <p class="card-flavor mystery-hint">在上方粘贴你的即刻主页链接，点击中央「捕捉」，开启属于你的专属即可梦。</p>
      <div class="card-foot"><span>No.????</span><span>illus. JIKÉMON</span><span class="rarity-mark">?</span></div>
    </div>
  `;
}

// 把十六进制色与白色按比例混合，返回具体 rgb()。
function mixWhite(hex, pct) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * pct + 255 * (1 - pct));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// 把同心波纹预渲染成 PNG data URI，作为 card-art 的背景图。
// 之所以不用 CSS repeating-radial-gradient：浏览器把 SVG foreignObject 光栅化到 canvas 时
// 无法可靠渲染 CSS 渐变（导出会丢波纹退化为纯色），而位图背景可完整光栅化。
function makeRippleDataUrl(w, h, strong, weak) {
  const scale = 3;
  const cw = Math.max(1, Math.round(w)) * scale;
  const ch = Math.max(1, Math.round(h)) * scale;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  const cx = cw / 2;
  const cy = ch * 0.42; // 与原 CSS 的 circle at 50% 42% 对齐
  const maxR = Math.hypot(Math.max(cx, cw - cx), Math.max(cy, ch - cy));
  const band = 11 * scale; // 半周期，环间距 11px
  // 从外向内画交替色实心圆，形成同心环
  for (let i = Math.ceil(maxR / band); i >= 0; i--) {
    ctx.beginPath();
    ctx.arc(cx, cy, i * band, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? weak : strong;
    ctx.fill();
  }
  // 中心白色柔光（对应原 CSS 的白色径向叠层）
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.48, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  return cv.toDataURL('image/png');
}

function render(c) {
  currentCardNo = c.cardNo;
  currentCard = c;
  cardEl.classList.remove('is-mystery');
  openBtn.hidden = true; // 揭晓后收起中央按钮
  cardEl.dataset.rarity = c.rarity.key;
  cardEl.style.setProperty('--type-color', c.type.color);
  cardEl.style.setProperty('--type-bg', c.type.bg);
  // 波纹两档色：strong 为属性色浅调，weak 近白，交替形成清晰同心环
  const rippleStrong = mixWhite(c.type.color, 0.4);
  const rippleWeak = mixWhite(c.type.color, 0.1);

  const badges = [];
  if (c.isVerified) badges.push('<span>✔ 认证</span>');
  if (c.isSponsor) badges.push('<span>♦ 会员</span>');

  cardEl.innerHTML = `
    <div class="card-inner">
      <div class="card-top">
        <span class="stage-chip${c.stage.mega ? ' stage-chip--mega' : ''}">${
          c.stage.mega ? '✦ ' : ''
        }${c.stage.label}</span>
        <h2 class="card-name">${esc(c.name)}</h2>
        <span class="card-hp"><small>HP</small>${c.hp}</span>
        <span class="type-orb" style="--type-color:${c.type.color}">${c.type.icon}</span>
      </div>
      <div class="card-art">
        ${c.avatar ? `<img class="avatar" src="${proxied(c.avatar)}" crossorigin="anonymous" alt="${esc(c.name)}" />` : ''}
        <div class="art-badges">${badges.join('')}</div>
      </div>
      <div class="card-info">${esc(c.infoLine)}</div>
      <div class="moves">
        ${c.moves
          .map(
            (m) => `
        <div class="move">
          <span class="move-cost">${energyDots(m.type || c.type, m.cost)}</span>
          <div class="move-main">
            <div class="move-head">
              <span class="move-name">${esc(m.name)}</span>
              <span class="move-dmg">${m.dmg}</span>
            </div>
            <p class="move-text">${esc(m.text)}</p>
          </div>
        </div>`
          )
          .join('')}
      </div>
      <div class="card-bottom">
        <div class="cb-cell"><b>弱点</b>${
          c.weakness
            ? `<span class="cb-val"><span class="energy" style="--e-color:${c.weakness.color}">${c.weakness.icon}</span>×2</span>${
                c.weaknessTopic ? `<span class="cb-note">${esc(c.weaknessTopic)}</span>` : ''
              }`
            : '—'
        }</div>
        <div class="cb-cell"><b>抵抗力</b>${
          c.resistance
            ? `<span class="cb-val"><span class="energy" style="--e-color:${c.resistance.color}">${c.resistance.icon}</span>-30</span><span class="cb-note">${c.resistance.name}系免疫</span>`
            : '—'
        }</div>
        <div class="cb-cell"><b>网感</b><span class="cb-val">${energyDots(
          { color: '#9e9e9e', icon: '★' },
          c.handSpeed
        )}</span><span class="cb-note">${['', '潜水党', '规律党', '日更狂魔'][c.handSpeed] || ''}</span></div>
      </div>
      <p class="card-flavor">${esc(c.flavor)}</p>
      <div class="card-foot">
        <span>${esc(c.cardNo)}</span>
        <span>illus. JIKÉMON</span>
        <span class="rarity-mark">${c.rarity.key} · ${c.rarity.label}</span>
      </div>
    </div>
    <div class="holo"></div>
  `;

  // 用预渲染的波纹位图作 card-art 背景（导出可靠光栅化，替代 CSS 渐变）
  const artEl = cardEl.querySelector('.card-art');
  if (artEl) {
    // 波纹作为 <img> 铺在最底层（object-fit:fill 拉伸到实际尺寸），此处用设计尺寸生成位图
    const url = makeRippleDataUrl(320, 178, rippleStrong, rippleWeak);
    const rip = document.createElement('img');
    rip.className = 'art-ripple';
    rip.src = url;
    rip.alt = '';
    rip.setAttribute('aria-hidden', 'true');
    artEl.insertBefore(rip, artEl.firstChild);
  }

  const moveLines = c.moves
    .map((m) => {
      const t = m.type || c.type;
      return `${esc(m.origin || '行为特征')} → ${t.icon} ${t.name}系「${esc(m.name)}」`;
    })
    .join('<br/>');
  dossier.innerHTML = `
    <h2>即可梦档案</h2>
    <dl>
      <dt>稀有度评分</dt><dd>${c.rarityScore} / 100 → <b>${c.rarity.key}（${c.rarity.label}）</b></dd>
      <dt>突出特质</dt><dd><b>${c.trait}</b>（${c.traitWhy}）</dd>
      <dt>属性判定</dt><dd>${c.type.icon} ${c.type.name}系（圈子投票 + 简介关键词）</dd>
      <dt>技能匹配</dt><dd>${moveLines}</dd>
      ${
        c.respected > 0
          ? `<dt>夸夸强化</dt><dd>被夸 ${c.respected} 次 → 技能攻击 +${c.respectBonus}</dd>`
          : ''
      }
      <dt>进化阶段</dt><dd>账龄 ${c.metrics.years} 年 × 影响力 → 综合 ${c.metrics.evoScore}/100 → ${c.stage.label}${
        c.stage.mega ? '（6 年+ 且 5000 粉+ 解锁）' : ''
      }</dd>
      <dt>粉丝 / 获赞</dt><dd>${c.metrics.followers} / ${c.metrics.liked} → HP ${c.hp}</dd>
      <dt>发帖频率</dt><dd>约 ${c.metrics.postsPerDay} 条 / 天 → 网感 ${'★'.repeat(c.handSpeed)}</dd>
      ${
        c.weaknessTopic
          ? `<dt>弱点软肋</dt><dd>本命圈子「${esc(c.weaknessTopic)}」→ 一聊就上头</dd>`
          : ''
      }
      ${
        c.resistance
          ? `<dt>免疫领域</dt><dd>几乎不碰 ${c.resistance.icon} ${c.resistance.name}系内容 → 抵抗力 -30</dd>`
          : ''
      }
    </dl>
    <p class="verdict">${esc(c.bio || '这位即友很神秘，什么都没写。')}</p>
  `;

  arena.hidden = false;
  actions.hidden = false;
  dossier.hidden = false;
  cardEl.classList.remove('reveal');
  void cardEl.offsetWidth; // 重新触发入场动画
  cardEl.classList.add('reveal');
  setTimeout(celebrate, 140); // 与卡片弹出同步爆开礼花
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForImageElement(img, { timeoutMs = 5000, label = '图片', required = false } = {}) {
  if (img.complete) {
    if (!required || img.naturalWidth > 0) return Promise.resolve();
    return Promise.reject(new Error(`${label}加载失败`));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      img.removeEventListener('load', onload);
      img.removeEventListener('error', onerror);
    };
    const settle = (ok, err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!ok && required) reject(err);
      else resolve();
    };
    const onload = () => settle(true);
    const onerror = () => settle(false, new Error(`${label}加载失败`));
    const timer = setTimeout(() => settle(false, new Error(`${label}加载超时`)), timeoutMs);
    img.addEventListener('load', onload, { once: true });
    img.addEventListener('error', onerror, { once: true });
    if (img.complete) settle(!required || img.naturalWidth > 0, new Error(`${label}加载失败`));
  });
}

function loadImage(src, { timeoutMs = 8000, label = '图片' } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve(img);
      else reject(value);
    };
    const timer = setTimeout(() => finish(false, new Error(`${label}加载超时`)), timeoutMs);
    img.onload = () => finish(true);
    img.onerror = () => finish(false, new Error(`${label}加载失败`));
    img.src = src;
    if (img.complete && img.naturalWidth > 0) finish(true);
  });
}

async function decodeBestEffort(img, timeoutMs = 1500) {
  if (!img.decode) return;
  await Promise.race([img.decode(), wait(timeoutMs)]).catch(() => {});
}

async function waitForFontsReady(timeoutMs = 1500) {
  if (!document.fonts?.ready) return;
  await Promise.race([document.fonts.ready, wait(timeoutMs)]).catch(() => {});
}

/* ---- 3D 倾斜 + 镭射光随鼠标移动 ---- */
tilt.addEventListener('mousemove', (e) => {
  const r = cardEl.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  cardEl.style.transform = `rotateY(${(px - 0.5) * 22}deg) rotateX(${(0.5 - py) * 16}deg)`;
  cardEl.style.setProperty('--hx', `${px * 100}%`);
  cardEl.style.setProperty('--hy', `${py * 100}%`);
});
tilt.addEventListener('mouseleave', () => {
  cardEl.style.transform = '';
});

/* ---- 导出 PNG ----
 * html-to-image 通过 SVG foreignObject 走浏览器原生渲染，
 * 能完整保留 mix-blend-mode 镭射层与渐变卡框（html2canvas 不支持会发灰）。
 * 字体不用它自带的嵌入逻辑（会拉取 Noto Sans SC 的 200+ 个子集文件直至挂起），
 * 而是用 Google Fonts 的 text= 参数按卡面实际字符请求迷你子集，自行内联。 */
async function buildFontEmbedCSS() {
  const chars = [...new Set(cardEl.textContent + 'HP0123456789×-★ ')].join('');
  const text = encodeURIComponent(chars);
  const families = [
    'ZCOOL+QingKe+HuangYou',
    'Noto+Sans+SC:wght@400;500;700;900',
    'M+PLUS+Rounded+1c:wght@700;900',
  ];
  let css = '';
  for (const f of families) {
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${f}&text=${text}`);
    css += await r.text();
  }
  // 将每个字体文件下载并转成 data URI
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  await Promise.all(
    urls.map(async (u) => {
      const buf = await fetch(u).then((r) => r.arrayBuffer());
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      css = css.replaceAll(`url(${u})`, `url(data:font/woff2;base64,${btoa(bin)})`);
    })
  );
  return css;
}

// 把卡片矢量图合成到竖版分享图上：深色背景 + 背光 + 顶部标题 + 底部网址（参考 gitfut）
async function composeExport(cardImg) {
  const S = 3; // 输出倍率
  const CW = 366, CH = 512; // 卡片逻辑尺寸
  const PAD_X = 74, TOP = 42, TITLE_H = 126, GAP_TOP = 30, GAP_BOT = 40, FOOT_H = 122, BOT = 46;
  const W = CW + PAD_X * 2;
  const H = TOP + TITLE_H + GAP_TOP + CH + GAP_BOT + FOOT_H + BOT;
  const cardX = PAD_X, cardY = TOP + TITLE_H + GAP_TOP;
  const cx = W / 2, ccx = cardX + CW / 2, ccy = cardY + CH / 2;

  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = H * S;
  const ctx = cv.getContext('2d');
  ctx.scale(S, S);

  // 背景：与网站一致的深绿 + 上下柔光
  ctx.fillStyle = '#10241c';
  ctx.fillRect(0, 0, W, H);
  const fillRadial = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  fillRadial(cx, -H * 0.05, H * 0.62, [[0, 'rgba(27,58,45,0.95)'], [1, 'rgba(27,58,45,0)']]);
  fillRadial(W * 0.82, H * 1.05, H * 0.5, [[0, 'rgba(20,43,54,0.85)'], [1, 'rgba(20,43,54,0)']]);

  // 卡片背后的 mesh 背光（与页面 .card-tilt::before 同色）
  const glows = [
    [ccx - CW * 0.22, ccy - CH * 0.22, CW * 0.82, 'rgba(232,197,101,0.5)'],
    [ccx + CW * 0.24, ccy - CH * 0.1, CW * 0.82, 'rgba(69,184,172,0.46)'],
    [ccx - CW * 0.06, ccy + CH * 0.24, CW * 0.88, 'rgba(167,95,190,0.32)'],
    [ccx, ccy, CW * 1.15, 'rgba(245,240,220,0.14)'],
  ];
  for (const [gx, gy, gr, col] of glows) {
    fillRadial(gx, gy, gr, [[0, col], [1, col.replace(/[\d.]+\)$/, '0)')]]);
  }

  // 卡片本体（补一层投影，SVG 导出会裁掉外阴影）
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 22;
  ctx.drawImage(cardImg, cardX, cardY, CW, CH);
  ctx.restore();

  // 文本
  await waitForFontsReady();
  ctx.textAlign = 'center';
  const setLS = (v) => { if ('letterSpacing' in ctx) ctx.letterSpacing = v; };

  // 顶部标题「即可梦图鉴」（金色渐变 + 轻投影）
  ctx.font = '44px "ZCOOL QingKe HuangYou", sans-serif';
  setLS('6px');
  const tg = ctx.createLinearGradient(0, TOP + 22, 0, TOP + 72);
  tg.addColorStop(0, '#f6e79a');
  tg.addColorStop(1, '#dca93a');
  ctx.fillStyle = tg;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillText('即可梦图鉴', cx, TOP + 62);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 副标题
  ctx.font = '14px "Noto Sans SC", sans-serif';
  setLS('3px');
  ctx.fillStyle = '#9db8a7';
  ctx.fillText('JIKÉMON · 把你的即刻主页变成专属卡牌', cx, TOP + 100);

  // 底部：特质关键词 + 网址
  const footY = cardY + CH + GAP_BOT;
  ctx.font = '900 22px "Noto Sans SC", sans-serif';
  setLS('2px');
  ctx.fillStyle = '#c2cedd';
  ctx.fillText(`${currentCard.type.name}系 · ${currentCard.trait}`, cx, footY + 32);

  ctx.font = '12px "M PLUS Rounded 1c", "Noto Sans SC", sans-serif';
  setLS('0px');
  ctx.fillStyle = '#e8c565';
  ctx.fillText('web.jikemon.com', cx, footY + 82);

  setLS('0px');
  return cv;
}

$('download').addEventListener('click', async () => {
  const btn = $('download');
  btn.disabled = true;
  btn.textContent = '合成卡牌中…';
  const prevTransform = cardEl.style.transform;
  cardEl.style.transform = 'none';
  try {
    // 先确保头像本身完成加载；decode 在后台/隐藏页可能被暂停，所以只做带超时的最佳努力。
    const avatarImg = cardEl.querySelector('.card-art .avatar');
    if (avatarImg) {
      await waitForImageElement(avatarImg, { timeoutMs: 3000, label: '头像' });
      await decodeBestEffort(avatarImg);
    }

    const fontEmbedCSS = await buildFontEmbedCSS();
    // 只用 toSvg 拿矢量快照，光栅化自己做（库内置的 toPng 在部分环境下会挂起）。
    // 头像已预解码，单次调用即可；cacheBust 强制重新拉取，避免切换用户后复用上个用户的缓存图。
    const svgUrl = await htmlToImage.toSvg(cardEl, { fontEmbedCSS, cacheBust: true });

    // SVG decode() 在后台/隐藏页可能不会恢复；onload 对隐藏页更可靠。
    const img = await loadImage(svgUrl, { timeoutMs: 8000, label: 'SVG' });
    // 再等一小会，给 iOS 光栅化 foreignObject 内嵌图片的时间
    // （用 setTimeout 而非 rAF：后台/隐藏标签页 rAF 会被暂停导致卡死）
    await wait(120);

    const composed = await composeExport(img);
    const a = document.createElement('a');
    const no = (currentCardNo.match(/\d+/) || [])[0];
    a.download = no ? `jikemon-card-${no}.png` : 'jikemon-card.png';
    a.href = composed.toDataURL('image/png');
    a.click();
  } catch (err) {
    setStatus('导出失败：' + err.message);
  } finally {
    cardEl.style.transform = prevTransform;
    btn.disabled = false;
    btn.textContent = '导出卡牌';
  }
});
