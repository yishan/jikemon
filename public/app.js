import { buildCard } from './card.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const input = $('input');
const go = $('go');
const status = $('status');
const arena = $('arena');
const cardEl = $('card');
const tilt = $('tilt');
const dossier = $('dossier');
const actions = $('actions');

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = input.value.trim();
  if (!id) return;
  setStatus('掷出精灵球，正在捕捉…');
  go.disabled = true;
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
    arena.hidden = true;
    actions.hidden = true;
  } finally {
    go.disabled = false;
  }
});

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

function render(c) {
  cardEl.dataset.rarity = c.rarity.key;
  cardEl.style.setProperty('--type-color', c.type.color);
  cardEl.style.setProperty('--type-bg', c.type.bg);

  const badges = [];
  if (c.isVerified) badges.push('<span>✔ 认证</span>');
  if (c.isSponsor) badges.push('<span>♦ 会员</span>');

  cardEl.innerHTML = `
    <div class="card-inner">
      <div class="card-top">
        <span class="stage-chip">${c.stage.label}</span>
        <h2 class="card-name">${esc(c.name)}</h2>
        <span class="card-hp"><small>HP</small>${c.hp}</span>
        <span class="type-orb" style="--type-color:${c.type.color}">${c.type.icon}</span>
      </div>
      <div class="card-art">
        ${c.avatar ? `<img src="${proxied(c.avatar)}" crossorigin="anonymous" alt="${esc(c.name)}" />` : ''}
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
            ? `<span class="cb-val"><span class="energy" style="--e-color:${c.weakness.color}">${c.weakness.icon}</span>×2</span>`
            : '—'
        }</div>
        <div class="cb-cell"><b>抵抗力</b>${
          c.resistance
            ? `<span class="cb-val"><span class="energy" style="--e-color:${c.resistance.color}">${c.resistance.icon}</span>-30</span>`
            : '—'
        }</div>
        <div class="cb-cell"><b>撤退</b><span class="cb-val">${energyDots(
          { color: '#9e9e9e', icon: '★' },
          c.retreat
        )}</span></div>
      </div>
      <p class="card-flavor">${esc(c.flavor)}</p>
      <div class="card-foot">
        <span>${esc(c.cardNo)}</span>
        <span>illus. okjike</span>
        <span class="rarity-mark">${c.rarity.key} · ${c.rarity.label}</span>
      </div>
    </div>
    <div class="holo"></div>
  `;

  const moveLines = c.moves
    .map((m) => {
      const t = m.type || c.type;
      return `${esc(m.origin || '行为特征')} → ${t.icon} ${t.name}系「${esc(m.name)}」`;
    })
    .join('<br/>');
  dossier.innerHTML = `
    <h2>训练师档案</h2>
    <dl>
      <dt>稀有度评分</dt><dd>${c.rarityScore} / 100 → <b>${c.rarity.key}（${c.rarity.label}）</b></dd>
      <dt>属性判定</dt><dd>${c.type.icon} ${c.type.name}系（圈子投票 + 简介关键词）</dd>
      <dt>技能匹配</dt><dd>${moveLines}</dd>
      ${
        c.respected > 0
          ? `<dt>夸夸强化</dt><dd>被夸 ${c.respected} 次 → 技能攻击 +${c.respectBonus}</dd>`
          : ''
      }
      <dt>入坑年限</dt><dd>${c.metrics.years} 年 → ${c.stage.label}</dd>
      <dt>粉丝 / 获赞</dt><dd>${c.metrics.followers} / ${c.metrics.liked} → HP ${c.hp}</dd>
      <dt>发帖频率</dt><dd>约 ${c.metrics.postsPerDay} 条 / 天 → 撤退 ×${c.retreat}</dd>
    </dl>
    <p class="verdict">${esc(c.bio || '这位即友很神秘，什么都没写。')}</p>
  `;

  arena.hidden = false;
  actions.hidden = false;
  cardEl.classList.remove('reveal');
  void cardEl.offsetWidth; // 重新触发入场动画
  cardEl.classList.add('reveal');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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

$('download').addEventListener('click', async () => {
  const btn = $('download');
  btn.disabled = true;
  btn.textContent = '冲洗照片中…';
  const prevTransform = cardEl.style.transform;
  cardEl.style.transform = 'none';
  try {
    // 先确保头像本身完成加载与解码，否则 iOS 上 toSvg 可能在图片内联前跑完，导致导出头像缺失
    const avatarImg = cardEl.querySelector('.card-art img');
    if (avatarImg) {
      if (!avatarImg.complete)
        await new Promise((r) => {
          avatarImg.onload = r;
          avatarImg.onerror = r;
        });
      if (avatarImg.decode) await avatarImg.decode().catch(() => {});
    }

    const fontEmbedCSS = await buildFontEmbedCSS();
    // 只用 toSvg 拿矢量快照，光栅化自己做（库内置的 toPng 在部分环境下会挂起）。
    // Safari 首次调用常在图片内联完成前返回，故预热一次再取最终结果。
    await htmlToImage.toSvg(cardEl, { fontEmbedCSS });
    const svgUrl = await htmlToImage.toSvg(cardEl, { fontEmbedCSS });

    const img = new Image();
    img.src = svgUrl;
    // decode() 比 onload 更可靠地保证嵌套图片已就绪；不支持时回退到 onload
    try {
      await img.decode();
    } catch {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('SVG 渲染失败'));
      });
    }
    // 再等两帧，给 iOS 光栅化 foreignObject 内嵌图片的时间
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = cardEl.offsetWidth * scale;
    canvas.height = cardEl.offsetHeight * scale;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.download = 'jikemon-card.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (err) {
    setStatus('导出失败：' + err.message);
  } finally {
    cardEl.style.transform = prevTransform;
    btn.disabled = false;
    btn.textContent = '导出卡片 PNG';
  }
});
