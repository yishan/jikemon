import { buildCard, buildDuel } from './card.js';
import { createExportSnapshot, exportIsCurrent } from './export-session.js';

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
const exportGroup = $('exportGroup');
const duelEntryBtn = $('duelEntryBtn');

let currentCardNo = ''; // 当前卡片编号（如 No.1228），用于导出文件名
let currentCard = null; // 当前卡片对象，供导出合成读取属性/特质
let currentProfileData = null; // 当前卡片的原始接口数据，进入对战页时带入左侧
let currentDuel = null; // 当前 VS 对战对象
let currentMode = 'card';
let inlineExportPreview = null;
let exportPreviewViewportContent = null;
let catchProgressFrame = 0;
let duelRevealTimers = [];
let duelLoadSeq = 0;
let duelLoading = false;
let exportGeneration = 0;
let exportBusy = false;
let exportControlStates = null;
const duelSides = { left: null, right: null }; // 对战双方的原始接口数据，空位为 null
const duelSideDraft = { left: '', right: '' }; // 空位输入框草稿，重渲染时保留用户已输入的链接
const profileCache = new Map();
const duelPairCache = new Map();

function invalidateExport() {
  exportGeneration += 1;
}

function setExportControlsDisabled(disabled) {
  if (disabled) {
    if (exportControlStates) return;
    const controls = [
      input,
      openBtn,
      duelEntryBtn,
      $('download'),
      $('exportMenuBtn'),
      ...document.querySelectorAll('.duel-seeker input, .duel-challenge-btn, .duel-swap-btn'),
    ].filter(Boolean);
    exportControlStates = [...new Set(controls)].map((el) => ({ el, disabled: el.disabled }));
    exportControlStates.forEach(({ el }) => {
      el.disabled = true;
    });
    return;
  }
  if (!exportControlStates) return;
  exportControlStates.forEach(({ el, disabled }) => {
    if (el.isConnected) el.disabled = disabled;
  });
  exportControlStates = null;
}

function assertExportCurrent(token) {
  if (!exportIsCurrent(token, exportGeneration)) throw new Error('导出已取消');
}

// 从输入中提取用户 ID：支持 /u/ /user/ /users/ 路径或裸 ID（仅用作地址栏回退，权威 ID 用响应里的 username）
function extractId(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/\/u(?:sers?)?\/([\w-]+)/);
  return m ? m[1] : text;
}

function profileCacheKey(raw) {
  return extractId(raw).toLowerCase();
}

function rememberProfile(raw, data) {
  if (!data?.user) return data;
  const cached = Promise.resolve(data);
  const keys = [raw, data.user.username, data.user.id].map(profileCacheKey).filter(Boolean);
  keys.forEach((key) => profileCache.set(key, cached));
  return data;
}

async function fetchProfileCached(raw) {
  const key = profileCacheKey(raw);
  if (!key) throw new Error('请输入即刻主页链接');

  const hit = profileCache.get(key);
  if (hit) return hit;

  const request = fetch(`/api/profile?id=${encodeURIComponent(raw)}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '捕捉失败');
      return rememberProfile(raw, data);
    })
    .catch((err) => {
      profileCache.delete(key);
      throw err;
    });

  profileCache.set(key, request);
  return request;
}

async function fetchDuelCached(leftRaw, rightRaw) {
  const leftKey = profileCacheKey(leftRaw);
  const rightKey = profileCacheKey(rightRaw);
  if (!leftKey || !rightKey) throw new Error('请分别输入两位即友的主页链接');

  if (leftKey === rightKey) {
    const data = await fetchProfileCached(leftRaw);
    return { left: data, right: data };
  }

  const leftHit = profileCache.get(leftKey);
  const rightHit = profileCache.get(rightKey);
  if (leftHit || rightHit) {
    const [left, right] = await Promise.all([fetchProfileCached(leftRaw), fetchProfileCached(rightRaw)]);
    return { left, right };
  }

  const pairKey = `${leftKey}::${rightKey}`;
  const pairHit = duelPairCache.get(pairKey);
  if (pairHit) return pairHit;

  const request = fetch(`/api/duel?left=${encodeURIComponent(leftRaw)}&right=${encodeURIComponent(rightRaw)}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '对战加载失败');
      rememberProfile(leftRaw, data.left);
      rememberProfile(rightRaw, data.right);
      return data;
    })
    .catch((err) => {
      duelPairCache.delete(pairKey);
      profileCache.delete(leftKey);
      profileCache.delete(rightKey);
      throw err;
    });

  duelPairCache.set(pairKey, request);
  const leftProfileRequest = request.then((data) => data.left);
  const rightProfileRequest = request.then((data) => data.right);
  leftProfileRequest.catch(() => {});
  rightProfileRequest.catch(() => {});
  profileCache.set(leftKey, leftProfileRequest);
  profileCache.set(rightKey, rightProfileRequest);
  return request;
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
  if (exportBusy) return;
  const id = input.value.trim();
  if (!id) {
    setStatus('先在上方粘贴你的即刻主页链接～');
    input.focus();
    return;
  }
  startCatchProgress();
  openBtn.disabled = true;
  openBtn.textContent = '捕捉中…';
  try {
    const data = await fetchProfileCached(id);
    const card = buildCard(data);
    await finishCatchProgress();
    currentProfileData = data;
    render(card);
    setStatus('');
    // 地址栏同步为可分享的直达链接：用响应里的权威 username（okjk.co 短链等也能正确归一）
    const canonicalId = data.user?.username || extractId(id);
    history.replaceState(null, '', `/u/${canonicalId}`);
  } catch (err) {
    stopCatchProgress();
    setStatus('💨 它逃走了：' + err.message);
    // 回到占位卡，让用户可重试
    renderPlaceholder();
    openBtn.hidden = false;
    dossier.hidden = true;
    currentCard = null;
    currentProfileData = null;
    updateHomeActions();
  } finally {
    stopCatchProgress();
    openBtn.disabled = false;
    openBtn.textContent = '捕捉';
  }
});

initRoute();

// 首页动作条（对战入口 + 导出组）：仅在捕捉到卡牌后展示
function updateHomeActions() {
  actions.hidden = !currentCard;
  if (exportGroup) exportGroup.hidden = !currentCard;
}

// 首页「宝可即对战」入口：带着当前卡牌（若有）进入对战页左侧，右侧留空等待挑战者
duelEntryBtn?.addEventListener('click', () => {
  if (exportBusy || currentMode === 'duel') return;
  duelSides.left = currentProfileData || null;
  duelSides.right = null;
  duelSideDraft.left = '';
  duelSideDraft.right = '';
  const leftId = currentProfileData?.user?.username;
  history.pushState(null, '', leftId ? `/u/${leftId}/vs` : '/vs');
  setupDuelChrome();
  renderDuelLayout();
});

// 站内用 pushState 进入对战页后，浏览器返回时按新地址重新初始化
window.addEventListener('popstate', () => location.reload());

function initRoute() {
  const duelPath = location.pathname.match(/^\/u\/([\w-]+)\/vs\/([\w-]+)$/);
  if (duelPath) {
    loadDuelRoute(duelPath[1], duelPath[2]);
    return;
  }

  // 对战入口页：/u/<id>/vs 带入左侧，/vs 双方待定（均为问号卡 + 「挑战」按钮）
  const duelSetupPath = location.pathname.match(/^\/u\/([\w-]+)\/vs\/?$/);
  if (duelSetupPath) {
    enterDuelSetup(duelSetupPath[1]);
    return;
  }
  if (/^\/vs\/?$/.test(location.pathname)) {
    enterDuelSetup(null);
    return;
  }

  // 初始：先渲染神秘占位卡（全「?」+ 中央抓取按钮）
  renderPlaceholder();
  updateHomeActions();

  // 直达链接：访问 /u/<id> 时自动填入并生成。
  // 即刻推广场景：把 web.okjike.com/u/xxx 的域名换成本站域名，落地即出卡。
  const pathId = location.pathname.match(/^\/u\/([\w-]+)$/);
  if (pathId) {
    // 输入框始终展示即刻原始链接的样子，让用户明白粘贴什么
    input.value = `https://web.okjike.com/u/${pathId[1]}`;
    form.requestSubmit();
  }
}

function setStatus(msg) {
  status.textContent = msg;
  status.hidden = !msg;
}

function setCatchProgress(value) {
  form.style.setProperty('--catch-progress', Math.max(0, Math.min(1, value)).toFixed(4));
}

function startCatchProgress() {
  cancelAnimationFrame(catchProgressFrame);
  setStatus('');
  setCatchProgress(0.02);
  form.classList.add('is-catching');
  form.setAttribute('aria-busy', 'true');
  input.disabled = true;
  const startedAt = performance.now();
  const estimatedMs = 7200;
  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / estimatedMs);
    const eased = 1 - Math.pow(1 - t, 3);
    setCatchProgress(0.02 + eased * 0.84);
    if (t < 1 && form.classList.contains('is-catching')) catchProgressFrame = requestAnimationFrame(tick);
  };
  catchProgressFrame = requestAnimationFrame(tick);
}

function finishCatchProgress() {
  cancelAnimationFrame(catchProgressFrame);
  setCatchProgress(1);
  return wait(280);
}

function stopCatchProgress() {
  cancelAnimationFrame(catchProgressFrame);
  form.classList.remove('is-catching');
  form.removeAttribute('aria-busy');
  input.disabled = false;
  setCatchProgress(0);
}

function startInlineCatchProgress(formEl) {
  const inputEl = formEl?.querySelector('input');
  if (!formEl || !inputEl) return null;
  const state = { formEl, inputEl, frame: 0 };
  formEl.style.setProperty('--catch-progress', '0.0200');
  formEl.classList.add('is-catching');
  formEl.setAttribute('aria-busy', 'true');
  inputEl.disabled = true;
  const startedAt = performance.now();
  const estimatedMs = 7200;
  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / estimatedMs);
    const eased = 1 - Math.pow(1 - t, 3);
    formEl.style.setProperty('--catch-progress', (0.02 + eased * 0.84).toFixed(4));
    if (t < 1 && formEl.classList.contains('is-catching')) state.frame = requestAnimationFrame(tick);
  };
  state.frame = requestAnimationFrame(tick);
  return state;
}

function finishInlineCatchProgress(state) {
  if (!state) return Promise.resolve();
  cancelAnimationFrame(state.frame);
  state.formEl.style.setProperty('--catch-progress', '1');
  return wait(280);
}

function stopInlineCatchProgress(state) {
  if (!state) return;
  cancelAnimationFrame(state.frame);
  state.formEl.classList.remove('is-catching');
  state.formEl.removeAttribute('aria-busy');
  state.formEl.style.setProperty('--catch-progress', '0');
  state.inputEl.disabled = false;
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

// 神秘占位卡：各字段用「?」。首页与对战空位共用，hint 为卡底提示文案
function renderMysteryCardInto(el, hint) {
  el.dataset.rarity = 'C'; // 中性银灰卡框
  el.classList.add('is-mystery');
  el.classList.remove('reveal');
  el.style.setProperty('--type-color', '#b7b1a1');
  el.style.setProperty('--type-bg', '#efece2');
  el.style.setProperty('--ripple-strong', '#e2ded1');
  el.style.setProperty('--ripple-weak', '#f5f2ea');
  const q = '？？？？？？？？？？？？？？？？？？';
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-top">
        <span class="stage-chip">？？</span>
        <h2 class="card-name">? ? ?</h2>
        <span class="card-hp"><small>HP</small>??</span>
        <span class="type-orb" style="--type-color:#b7b1a1">?</span>
      </div>
      <div class="card-art"><div class="mystery-q">?</div></div>
      <div class="card-info">宝可即连接 ｜ 关注 ??　　被关注 ??　　获赞 ??</div>
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
      <p class="card-flavor mystery-hint">${hint}</p>
      <div class="card-foot"><span>No.????</span><span>illus. POKÉJI</span><span class="rarity-mark">?</span></div>
    </div>
  `;
}

// 抓取前的首页神秘占位卡：中央浮着抓取按钮，吸引用户开卡
function renderPlaceholder() {
  renderMysteryCardInto(cardEl, '在上方粘贴你的即刻主页链接，点击中央「捕捉」，开启属于你的专属宝可即。');
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

function cardMarkup(c) {
  const badges = [];
  if (c.isVerified) badges.push('<span>✔ 认证</span>');
  if (c.isSponsor) badges.push('<span>♦ 会员</span>');

  return `
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
        <span>illus. POKÉJI</span>
        <span class="rarity-mark">${c.rarity.key} · ${c.rarity.label}</span>
      </div>
    </div>
    <div class="holo"></div>
  `;
}

function renderCardElement(el, c, { reveal = false } = {}) {
  el.classList.remove('is-mystery');
  el.dataset.rarity = c.rarity.key;
  el.style.setProperty('--type-color', c.type.color);
  el.style.setProperty('--type-bg', c.type.bg);
  el.innerHTML = cardMarkup(c);

  // 波纹两档色：strong 为属性色浅调，weak 近白，交替形成清晰同心环
  const rippleStrong = mixWhite(c.type.color, 0.4);
  const rippleWeak = mixWhite(c.type.color, 0.1);

  // 用预渲染的波纹位图作 card-art 背景（导出可靠光栅化，替代 CSS 渐变）
  const artEl = el.querySelector('.card-art');
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

  if (reveal) {
    el.classList.remove('reveal');
    void el.offsetWidth; // 重新触发入场动画
    el.classList.add('reveal');
  }
}

function renderDossier(c) {
  const moveLines = c.moves
    .map((m) => {
      const t = m.type || c.type;
      return `${t.icon} ${t.name}系「${esc(m.name)}」`;
    })
    .join('<br/>');
  dossier.innerHTML = `
    <h2>宝可即档案<span class="dossier-en">INFO</span></h2>
    <dl>
      <dt>名称</dt><dd><b>${esc(c.name)}</b>${
        c.username && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(c.username) ? `（@${esc(c.username)}）` : ''
      }</dd>
      <dt>稀有度</dt><dd><b>${c.rarity.key} · ${c.rarity.label}</b></dd>
      <dt>突出特质</dt><dd><b>${c.trait}</b></dd>
      <dt>属性判定</dt><dd>${c.type.icon} ${c.type.name}系</dd>
      <dt>技能匹配</dt><dd>${moveLines}</dd>
      ${c.respected > 0 ? `<dt>夸夸强化</dt><dd>技能攻击 +${c.respectBonus}</dd>` : ''}
      <dt>进化阶段</dt><dd>${c.stage.label} ← 即龄 × 影响力${
        c.stage.mega ? '（6 年+ 且 5000 粉+ 解锁）' : ''
      }</dd>
      <dt>HP 值</dt><dd><b>${c.hp}</b> ← 粉丝 ${c.metrics.followers} / 获赞 ${c.metrics.liked}</dd>
      <dt>网感</dt><dd>${'★'.repeat(c.handSpeed)} ← 约 ${c.metrics.postsPerDay} 条 / 天</dd>
      ${c.weaknessTopic ? '<dt>弱点软肋</dt><dd>本命圈子一聊就上头</dd>' : ''}
      ${
        c.resistance
          ? `<dt>免疫领域</dt><dd>几乎不碰 ${c.resistance.icon} ${c.resistance.name}系内容</dd>`
          : ''
      }
    </dl>
    <p class="verdict">${esc(c.bio || '这位即友很神秘，什么都没写。')}</p>
  `;
}

function render(c) {
  invalidateExport();
  currentMode = 'card';
  currentCardNo = c.cardNo;
  currentCard = c;
  currentDuel = null;
  openBtn.hidden = true; // 揭晓后收起中央按钮
  renderCardElement(cardEl, c, { reveal: true });
  renderDossier(c);

  arena.hidden = false;
  updateHomeActions();
  dossier.hidden = false;
  setTimeout(celebrate, 140); // 与卡片弹出同步爆开礼花
}

// 切换到对战页的页面骨架：标题、隐藏首页表单/动作条/档案
function setupDuelChrome() {
  invalidateExport();
  currentMode = 'duel';
  currentCard = null;
  currentCardNo = '';
  document.body.classList.add('is-duel-page');
  const titleEl = document.querySelector('.masthead h1');
  const subEl = document.querySelector('.masthead .sub');
  if (titleEl) titleEl.textContent = '宝可即决斗';
  if (subEl) subEl.textContent = 'POKÉJI DUEL';
  document.title = '宝可即决斗 · Pokéji DUEL';
  form.hidden = true;
  actions.hidden = true;
  dossier.hidden = true;
  openBtn.hidden = true;
  arena.hidden = false;
  arena.className = 'arena duel-arena';
  setStatus('');
}

// 对战设置态入口：leftId 存在时带入左侧并自动捕捉，否则双方均为问号卡
function enterDuelSetup(leftId) {
  duelSides.left = null;
  duelSides.right = null;
  setupDuelChrome();
  if (leftId) duelSideDraft.left = `https://web.okjike.com/u/${leftId}`;
  renderDuelPending();
  if (leftId) $('duelLeftForm')?.requestSubmit();
}

// 按当前双方状态渲染：双方齐全进入对决，否则渲染带问号空位的设置态
function renderDuelLayout({ syncUrl = false } = {}) {
  if (duelSides.left && duelSides.right) {
    renderDuelData({ left: duelSides.left, right: duelSides.right });
    return;
  }
  renderDuelPending();
  if (syncUrl) updateDuelSetupUrl();
}

// 设置态地址栏：仅左侧可表达为 /u/<id>/vs，其余情况回落到 /vs
function updateDuelSetupUrl() {
  const leftId = duelSides.left?.user?.username;
  history.replaceState(null, '', leftId ? `/u/${leftId}/vs` : '/vs');
}

// 重渲染前把空位输入框里的草稿收起来，避免用户已粘贴的链接被丢掉
function captureDuelDrafts() {
  const leftInput = $('duelLeftInput');
  const rightInput = $('duelRightInput');
  if (leftInput) duelSideDraft.left = leftInput.value;
  if (rightInput) duelSideDraft.right = rightInput.value;
}

async function loadDuelRoute(leftId, rightId) {
  const loadToken = ++duelLoadSeq;
  setupDuelChrome();
  arena.innerHTML = `
    <section class="duel-loading" role="status" aria-live="polite">
      <span class="catch-ball" aria-hidden="true"></span>
      <strong>正在捕捉双方宝可即</strong>
    </section>
  `;

  try {
    const data = await fetchDuelCached(leftId, rightId);
    if (loadToken !== duelLoadSeq) return;
    renderDuelData(data, leftId, rightId);
  } catch (err) {
    if (loadToken !== duelLoadSeq) return;
    arena.innerHTML = `
      <section class="duel-loading duel-loading--error" role="status">
        <strong>对战加载失败</strong>
        <span>${esc(err.message)}</span>
      </section>
    `;
  }
}

function renderDuelData(data, leftFallback, rightFallback) {
  duelSides.left = data.left;
  duelSides.right = data.right;
  const left = buildCard(data.left);
  const right = buildCard(data.right);
  const duel = buildDuel(left, right);
  currentDuel = duel;
  currentCard = null;
  currentCardNo = '';

  const canonicalLeft = data.left?.user?.username || left.username || extractId(leftFallback);
  const canonicalRight = data.right?.user?.username || right.username || extractId(rightFallback);
  history.replaceState(null, '', `/u/${canonicalLeft}/vs/${canonicalRight}`);
  document.title = `${left.name} vs ${right.name} · 宝可即决斗`;
  renderDuel(duel);
}

function duelProfileUrl(card) {
  return card.username ? `https://web.okjike.com/u/${card.username}` : '';
}

// 对战单侧：card 为空时渲染问号空位（卡上浮「挑战」按钮 + 常显链接输入框），
// 有卡时渲染真卡 + 「更换宝可即」按钮（点击重置回问号空位）+ 隐藏的输入框
function duelSideMarkup(side, card) {
  const name = side === 'left' ? 'Left' : 'Right';
  const label = side === 'left' ? '左侧宝可即主页链接' : '右侧宝可即主页链接';
  const metaHtml = card
    ? `<strong>${esc(card.name)}</strong><span>${card.type.icon} ${card.type.name}系 · ${card.rarity.key}</span>`
    : '<strong>神秘挑战者</strong><span>？？系 · ?</span>';
  const inputValue = card ? duelProfileUrl(card) : duelSideDraft[side] || '';
  return `
    <div class="duel-card-side duel-card-side--${side}">
      ${
        card
          ? `<button class="duel-swap-btn" id="duel${name}SwapBtn" data-duel-side="${side}" type="button">↻ 更换宝可即</button>`
          : ''
      }
      <form class="seeker duel-seeker${card ? ' is-hidden' : ''}" id="duel${name}Form" data-duel-side="${side}" aria-label="${label}">
        <input
          id="duel${name}Input"
          type="text"
          value="${esc(inputValue)}"
          placeholder="请输入即刻主页链接..."
          spellcheck="false"
        />
        <div class="seeker-loading" role="status" aria-live="polite">
          <span class="seeker-loading__bar" aria-hidden="true"></span>
          <span class="catch-ball" aria-hidden="true"></span>
          <span class="seeker-loading__text">精灵球正在捕捉中</span>
        </div>
      </form>
      <div class="card-tilt duel-tilt" id="duel${name}Tilt">
        <article class="card duel-card" id="duel${name}Card"></article>
        ${
          card
            ? ''
            : `<button type="button" class="open-btn duel-challenge-btn" id="duel${name}ChallengeBtn" data-duel-side="${side}">挑战</button>`
        }
      </div>
      <div class="duel-card-meta${card ? '' : ' duel-card-meta--mystery'}">${metaHtml}</div>
    </div>
  `;
}

// 单侧挂载：渲染真卡或问号卡，并绑定倾斜/表单/挑战/更换事件
function mountDuelSide(side, card) {
  const name = side === 'left' ? 'Left' : 'Right';
  const cardHost = $(`duel${name}Card`);
  if (!cardHost) return;
  if (card) renderCardElement(cardHost, card, { reveal: true });
  else renderMysteryCardInto(cardHost, '在下方粘贴即刻主页链接，点击「挑战」召唤这只宝可即。');
  attachTilt($(`duel${name}Tilt`), cardHost);
  $(`duel${name}Form`)?.addEventListener('submit', handleDuelSideSubmit);
  $(`duel${name}ChallengeBtn`)?.addEventListener('click', () => $(`duel${name}Form`)?.requestSubmit());
  $(`duel${name}SwapBtn`)?.addEventListener('click', () => resetDuelSide(side));
}

// 「更换宝可即」：该侧重置为问号空位（原链接留在输入框里方便改），对决面板回到待命态
function resetDuelSide(side) {
  if (duelLoading) return;
  duelLoadSeq++;
  clearDuelRevealTimers();
  duelSides[side] = null;
  renderDuelLayout({ syncUrl: true });
  const name = side === 'left' ? 'Left' : 'Right';
  const inputEl = $(`duel${name}Input`);
  inputEl?.focus();
  inputEl?.select();
}

// 设置态布局：已就位的一侧显示真卡，空位显示问号卡 + 「挑战」，中间是待命面板
function renderDuelPending() {
  clearDuelRevealTimers();
  captureDuelDrafts();
  currentDuel = null;
  const left = duelSides.left ? buildCard(duelSides.left) : null;
  const right = duelSides.right ? buildCard(duelSides.right) : null;
  const hint =
    !left && !right
      ? '两侧各粘贴一位即友的即刻主页链接，点击「挑战」开始对决。'
      : `在${left ? '右' : '左'}侧粘贴对手的即刻主页链接，点击「挑战」开始对决。`;
  document.title = '宝可即决斗 · Pokéji DUEL';
  arena.className = 'arena duel-arena';
  arena.innerHTML = `
    <section class="duel-shell">
      ${duelSideMarkup('left', left)}
      <section class="duel-board duel-board--pending" aria-label="宝可即决斗设置">
        <p class="duel-kicker">Final Result</p>
        <div class="duel-score"><span>?</span><b>V.S.</b><span>?</span></div>
        <h2 id="duelWinnerTitle">等待挑战者</h2>
        <p class="duel-verdict" id="duelVerdict">${hint}</p>
      </section>
      ${duelSideMarkup('right', right)}
    </section>
  `;
  mountDuelSide('left', left);
  mountDuelSide('right', right);
}

function renderDuel(duel) {
  clearDuelRevealTimers();
  captureDuelDrafts();
  const winnerClass = duel.winner ? `duel-board--${duel.winner}` : 'duel-board--draw';
  arena.className = 'arena duel-arena';
  arena.innerHTML = `
    <section class="duel-shell">
      ${duelSideMarkup('left', duel.left)}

      <section class="duel-board ${winnerClass}" aria-label="宝可即决斗结果">
        <p class="duel-kicker">Final Result</p>
        <div class="duel-score">
          <span id="duelScoreLeft">0</span>
          <b>V.S.</b>
          <span id="duelScoreRight">0</span>
        </div>
        <h2 id="duelWinnerTitle">逐项判定中</h2>
        <p class="duel-verdict" id="duelVerdict">逐项揭晓双方优势。</p>
        <div class="duel-rows">
          ${duel.rows.map((row, i) => duelRowMarkup(row, i)).join('')}
        </div>
        <dl class="duel-receipts">
          ${duel.receipts
            .map(
              (r) => `
            <div class="duel-receipt-row">
              <dd class="duel-receipt-value duel-receipt-value--left">${esc(r.left)}</dd>
              <dt>${esc(r.label)}</dt>
              <dd class="duel-receipt-value duel-receipt-value--right">${esc(r.right)}</dd>
            </div>`
            )
            .join('')}
        </dl>
      </section>

      ${duelSideMarkup('right', duel.right)}
    </section>
  `;

  mountDuelSide('left', duel.left);
  mountDuelSide('right', duel.right);
  playDuelReveal(duel);
}

function setDuelInputsDisabled(disabled) {
  document.querySelectorAll('.duel-seeker input').forEach((field) => {
    field.disabled = disabled;
  });
}

function setDuelFeedback(message) {
  const verdictEl = $('duelVerdict');
  if (verdictEl) verdictEl.textContent = message;
}

// 单侧「挑战」/输入框回车：只捕捉该侧；若另一侧已就位则直接进入对决
async function handleDuelSideSubmit(e) {
  e.preventDefault();
  if (duelLoading) return;

  const formEl = e.currentTarget;
  const side = formEl.dataset.duelSide;
  const inputEl = formEl.querySelector('input');
  const raw = inputEl?.value.trim();
  if (!raw) {
    setDuelFeedback(`先在${side === 'left' ? '左' : '右'}侧粘贴挑战者的即刻主页链接。`);
    inputEl?.focus();
    return;
  }

  duelLoading = true;
  clearDuelRevealTimers();
  const loadToken = ++duelLoadSeq;
  const progressState = startInlineCatchProgress(formEl);
  const challengeBtn = arena.querySelector(`.duel-challenge-btn[data-duel-side="${side}"]`);
  if (challengeBtn) {
    challengeBtn.disabled = true;
    challengeBtn.textContent = '捕捉中…';
  }
  setDuelInputsDisabled(true);
  setDuelFeedback('精灵球正在捕捉挑战者。');

  try {
    const data = await fetchProfileCached(raw);
    await finishInlineCatchProgress(progressState);
    if (loadToken !== duelLoadSeq) return;
    duelSides[side] = data;
    renderDuelLayout({ syncUrl: true });
  } catch (err) {
    if (loadToken === duelLoadSeq) setDuelFeedback('它逃走了：' + err.message);
  } finally {
    stopInlineCatchProgress(progressState);
    duelLoading = false;
    setDuelInputsDisabled(false);
    if (challengeBtn?.isConnected) {
      challengeBtn.disabled = false;
      challengeBtn.textContent = '挑战';
    }
  }
}

function duelRowMarkup(row, index) {
  return `
    <div class="duel-row" data-winner="${row.winner}" data-row-index="${index}">
      <div class="duel-row-head">
        <span>${esc(row.leftText)}</span>
        <strong>${esc(row.label)}</strong>
        <span>${esc(row.rightText)}</span>
      </div>
      <div class="duel-share" style="--left-share:${row.leftPct}%; --right-share:${row.rightPct}%;" aria-hidden="true">
        <i class="duel-share__left"></i>
        <i class="duel-share__right"></i>
      </div>
    </div>
  `;
}

function clearDuelRevealTimers() {
  duelRevealTimers.forEach((timer) => clearTimeout(timer));
  duelRevealTimers = [];
}

function playDuelReveal(duel) {
  const rows = [...document.querySelectorAll('.duel-row')];
  const leftScoreEl = $('duelScoreLeft');
  const rightScoreEl = $('duelScoreRight');
  const titleEl = $('duelWinnerTitle');
  const verdictEl = $('duelVerdict');
  if (!rows.length || !leftScoreEl || !rightScoreEl) return;

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    rows.forEach((row) => row.classList.add('is-resolved'));
    leftScoreEl.textContent = duel.score.left;
    rightScoreEl.textContent = duel.score.right;
    if (titleEl) titleEl.textContent = '';
    if (verdictEl) verdictEl.textContent = duel.verdict;
    return;
  }

  let leftScore = 0;
  let rightScore = 0;
  const stepMs = 760;

  duel.rows.forEach((row, index) => {
    const timer = setTimeout(() => {
      rows.forEach((el) => el.classList.remove('is-current'));
      const el = rows[index];
      if (!el) return;

      if (row.winner === 'left') leftScore += 1;
      if (row.winner === 'right') rightScore += 1;
      leftScoreEl.textContent = leftScore;
      rightScoreEl.textContent = rightScore;
      if (row.winner === 'left') bumpScore(leftScoreEl);
      if (row.winner === 'right') bumpScore(rightScoreEl);
      el.classList.add('is-current', 'is-resolved');

      if (titleEl) {
        if (row.winner === 'draw') titleEl.textContent = `${row.label} 打平`;
        else titleEl.textContent = `${row.winner === 'left' ? duel.left.name : duel.right.name} 拿下${row.label}`;
      }
      if (verdictEl) {
        verdictEl.textContent =
          row.winner === 'draw'
            ? `双方在「${row.label}」打平。`
            : `${row.winner === 'left' ? duel.left.name : duel.right.name} 在「${row.label}」取得优势。`;
      }
    }, stepMs * index + 240);
    duelRevealTimers.push(timer);
  });

  const doneTimer = setTimeout(() => {
    rows.forEach((el) => el.classList.remove('is-current'));
    leftScoreEl.textContent = duel.score.left;
    rightScoreEl.textContent = duel.score.right;
    if (titleEl) titleEl.textContent = '';
    if (verdictEl) verdictEl.textContent = duel.verdict;
  }, stepMs * duel.rows.length + 420);
  duelRevealTimers.push(doneTimer);
}

function bumpScore(el) {
  el.classList.remove('is-bumped');
  void el.offsetWidth;
  el.classList.add('is-bumped');
  const timer = setTimeout(() => el.classList.remove('is-bumped'), 260);
  duelRevealTimers.push(timer);
}

function attachTilt(tiltEl, targetCardEl) {
  if (!tiltEl || !targetCardEl) return;
  tiltEl.addEventListener('mousemove', (e) => {
    const r = targetCardEl.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    targetCardEl.style.transform = `rotateY(${(px - 0.5) * 22}deg) rotateX(${(0.5 - py) * 16}deg)`;
    targetCardEl.style.setProperty('--hx', `${px * 100}%`);
    targetCardEl.style.setProperty('--hy', `${py * 100}%`);
  });
  tiltEl.addEventListener('mouseleave', () => {
    targetCardEl.style.transform = '';
  });
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
    if (!/^(data|blob):/i.test(src)) img.crossOrigin = 'anonymous';
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

function waitForPaint(timeoutMs = 120) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, timeoutMs);
  });
}

function shouldUseMobileExportPreview() {
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isCoarseNarrow = matchMedia('(pointer: coarse)').matches && innerWidth <= 900;
  return isMobileUA || isIPadOS || isCoarseNarrow;
}

function exportFileName() {
  const no = (currentCardNo.match(/\d+/) || [])[0];
  return no ? `pokeji-card-${no}.png` : 'pokeji-card.png';
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG 生成失败'));
      }, 'image/png');
      return;
    }

    try {
      const [, data] = canvas.toDataURL('image/png').split(',');
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: 'image/png' }));
    } catch (err) {
      reject(err);
    }
  });
}

function closeInlineExportPreview() {
  if (!inlineExportPreview) return;
  inlineExportPreview.el.remove();
  URL.revokeObjectURL(inlineExportPreview.url);
  document.body.classList.remove('is-export-preview-open');
  unlockExportPreviewViewport();
  inlineExportPreview = null;
}

function lockExportPreviewViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  if (exportPreviewViewportContent === null) exportPreviewViewportContent = meta.getAttribute('content') || '';
  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
  );
}

function unlockExportPreviewViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta || exportPreviewViewportContent === null) return;
  meta.setAttribute('content', exportPreviewViewportContent);
  exportPreviewViewportContent = null;
}

function blockPreviewZoomGesture(e) {
  e.preventDefault();
}

function blockPreviewMultiTouch(e) {
  if (e.touches?.length > 1) e.preventDefault();
}

function blockPreviewWheelZoom(e) {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}

function lockPreviewGestures(el) {
  const active = { passive: false };
  el.addEventListener('touchmove', blockPreviewMultiTouch, active);
  el.addEventListener('gesturestart', blockPreviewZoomGesture, active);
  el.addEventListener('gesturechange', blockPreviewZoomGesture, active);
  el.addEventListener('gestureend', blockPreviewZoomGesture, active);
  el.addEventListener('wheel', blockPreviewWheelZoom, active);
  el.addEventListener('dblclick', blockPreviewZoomGesture);
}

function showInlineExportPreview(blob) {
  closeInlineExportPreview();
  const url = URL.createObjectURL(blob);
  const el = document.createElement('div');
  el.className = 'mobile-export-preview';

  const hint = document.createElement('p');
  hint.className = 'mobile-export-preview__hint';
  hint.textContent = '长按图片保存';

  const close = document.createElement('button');
  close.className = 'mobile-export-preview__close';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭预览');
  close.textContent = '×';
  close.addEventListener('click', closeInlineExportPreview);

  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;

  el.append(hint, close, img);
  lockPreviewGestures(el);
  document.body.append(el);
  document.body.classList.add('is-export-preview-open');
  lockExportPreviewViewport();
  inlineExportPreview = { el, url };
}

function downloadPngBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---- 3D 倾斜 + 镭射光随鼠标移动 ---- */
attachTilt(tilt, cardEl);

/* ---- 导出 PNG ----
 * html-to-image 通过 SVG foreignObject 走浏览器原生渲染，
 * 能完整保留 mix-blend-mode 镭射层与渐变卡框（html2canvas 不支持会发灰）。
 * 字体不用它自带的嵌入逻辑（会拉取 Noto Sans SC 的 200+ 个子集文件直至挂起），
 * 而是用 Google Fonts 的 text= 参数按卡面实际字符请求迷你子集，自行内联。 */
async function buildFontEmbedCSS(cardRoot, extraText = '') {
  const chars = [...new Set(cardRoot.textContent + extraText + 'HP0123456789×-★ ')].join('');
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

async function imageAssetFromElement(el, { timeoutMs = 5000, label = '图片', required = false } = {}) {
  if (!el) return null;
  const src = el.currentSrc || el.src;
  try {
    await waitForImageElement(el, { timeoutMs, label, required: true });
    await decodeBestEffort(el);
    if (el.naturalWidth > 0) return el;
  } catch (err) {
    if (!src) {
      if (required) throw err;
      return null;
    }
  }

  try {
    const fresh = await loadImage(src, { timeoutMs, label });
    await decodeBestEffort(fresh);
    return fresh;
  } catch (err) {
    if (required) throw err;
    return null;
  }
}

async function collectExportArtAssets(cardRoot) {
  const artEl = cardRoot.querySelector('.card-art');
  if (!artEl) return {};
  const rippleEl = artEl.querySelector('.art-ripple');
  const avatarEl = artEl.querySelector('.avatar');
  const [ripple, avatar] = await Promise.all([
    imageAssetFromElement(rippleEl, { timeoutMs: 5000, label: '波纹背景', required: true }),
    avatarEl
      ? imageAssetFromElement(avatarEl, { timeoutMs: 6000, label: '头像', required: true })
      : Promise.resolve(null),
  ]);
  return { ripple, avatar };
}

function imageSize(img) {
  return {
    w: img?.naturalWidth || img?.videoWidth || img?.width || 0,
    h: img?.naturalHeight || img?.videoHeight || img?.height || 0,
  };
}

function rectInExport(el, cardX, cardY, sourceCardEl) {
  const cardRect = sourceCardEl.getBoundingClientRect();
  if (!cardRect.width) return null;
  const r = el.getBoundingClientRect();
  const k = 366 / cardRect.width;
  return {
    x: cardX + (r.left - cardRect.left) * k,
    y: cardY + (r.top - cardRect.top) * k,
    w: r.width * k,
    h: r.height * k,
  };
}

function cssColor(style, name, fallback) {
  return style.getPropertyValue(name).trim() || fallback;
}

function drawCardUnderlay(ctx, cardX, cardY, cw, ch, sourceCardEl) {
  const cardStyle = getComputedStyle(sourceCardEl);
  const frame = cssColor(cardStyle, '--frame', '#7fa8d9');
  const frameDeep = cssColor(cardStyle, '--frame-deep', '#40679e');

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cw, ch, 16);
  const frameGradient = ctx.createLinearGradient(cardX, cardY, cardX + cw, cardY + ch);
  if (cardEl.dataset.rarity === 'UR') {
    frameGradient.addColorStop(0, '#f7c3d0');
    frameGradient.addColorStop(0.22, '#f9e79b');
    frameGradient.addColorStop(0.44, '#b9f0c3');
    frameGradient.addColorStop(0.66, '#a9d8f5');
    frameGradient.addColorStop(0.84, '#d5b8f2');
    frameGradient.addColorStop(1, '#f7c3d0');
  } else {
    frameGradient.addColorStop(0, frame);
    frameGradient.addColorStop(0.5, frameDeep);
    frameGradient.addColorStop(1, frame);
  }
  ctx.fillStyle = frameGradient;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.stroke();
  ctx.restore();

  const innerEl = sourceCardEl.querySelector('.card-inner');
  const inner = innerEl && rectInExport(innerEl, cardX, cardY, sourceCardEl);
  if (!inner) return;

  const innerStyle = getComputedStyle(innerEl);
  const bodyBg = cssColor(cardStyle, '--body-bg', innerStyle.backgroundColor || '#fdf7e3');
  ctx.save();
  roundRectPath(ctx, inner.x, inner.y, inner.w, inner.h, parseFloat(innerStyle.borderRadius) || 8);
  ctx.fillStyle = bodyBg;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();
  ctx.restore();
}

// 把卡片画面区的波纹与头像直接绘制到导出 canvas，绕开 iOS 丢弃 foreignObject 内 <img> 的问题。
// 用真实 DOM 的 getBoundingClientRect 定位（导出时卡片 transform:none，实际尺寸=设计尺寸）。
function drawCardArt(ctx, cardX, cardY, assets = {}, sourceCardEl) {
  const artEl = sourceCardEl.querySelector('.card-art');
  if (!artEl) return;
  const cardRect = sourceCardEl.getBoundingClientRect();
  const k = cardRect.width ? 366 / cardRect.width : 1; // 逻辑像素 / 实际像素（k≈1）
  const a = rectInExport(artEl, cardX, cardY, sourceCardEl);
  if (!a) return;
  const artStyle = getComputedStyle(artEl);
  const border = {
    l: parseFloat(artStyle.borderLeftWidth) * k || 0,
    t: parseFloat(artStyle.borderTopWidth) * k || 0,
    r: parseFloat(artStyle.borderRightWidth) * k || 0,
    b: parseFloat(artStyle.borderBottomWidth) * k || 0,
  };
  const content = {
    x: a.x + border.l,
    y: a.y + border.t,
    w: Math.max(0, a.w - border.l - border.r),
    h: Math.max(0, a.h - border.t - border.b),
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(content.x, content.y, content.w, content.h); // 只补画内容区，保留卡面原本的画框边缘
  ctx.clip();

  // 波纹背景（铺满画面窗口）
  const ripple = assets.ripple || artEl.querySelector('.art-ripple');
  if (imageSize(ripple).w) {
    ctx.drawImage(ripple, content.x, content.y, content.w, content.h);
  }

  // 头像：白环 + 投影 + 圆形裁剪（cover）
  const avatarEl = artEl.querySelector('.avatar');
  const avatar = assets.avatar || avatarEl;
  const avatarNatural = imageSize(avatar);
  if (avatarEl && avatarNatural.w) {
    const v = rectInExport(avatarEl, cardX, cardY, sourceCardEl);
    if (!v) return;
    const cx0 = v.x + v.w / 2;
    const cy0 = v.y + v.h / 2;
    const rad = Math.min(v.w, v.h) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx0, cy0, rad + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx0, cy0, rad, 0, Math.PI * 2);
    ctx.clip();
    const nw = avatarNatural.w;
    const nh = avatarNatural.h;
    const s = Math.max((rad * 2) / nw, (rad * 2) / nh);
    ctx.drawImage(avatar, cx0 - (nw * s) / 2, cy0 - (nh * s) / 2, nw * s, nh * s);
    ctx.restore();
  }

  // 角标（会员/认证）：波纹盖住了 SVG 里的角标，这里在最上层重绘（dark 胶囊 + 白字）
  const badges = artEl.querySelectorAll('.art-badges span');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 9px "Noto Sans SC", sans-serif';
  badges.forEach((b) => {
    const r = rectInExport(b, cardX, cardY, sourceCardEl);
    if (!r) return;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.min(r.h, r.w) / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.textContent, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
  });
  ctx.textBaseline = 'alphabetic'; // 复位，避免影响后续标题/正文定位

  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 把卡片矢量图合成到竖版分享图上。
// variant = 'full'：图鉴海报（深色背景 + 背光 + 顶部标题 + 卡牌与右侧档案 + 底部特质/网址）
// variant = 'plain'：纯卡牌（小边距，仅卡牌本体 + 下方金色 POKÉJI）
async function composeExport(cardImg, artAssets = {}, variant = 'full', dossierImg = null, snapshot) {
  const S = 3; // 输出倍率
  const CW = 366, CH = 512; // 卡片逻辑尺寸
  const full = variant === 'full';
  const PAD_X = full ? 74 : 30;
  const TOP = full ? 42 : 34;
  const TITLE_H = full ? 126 : 0;
  const GAP_TOP = full ? 30 : 0;
  const GAP_BOT = full ? 40 : 26;
  const FOOT_H = full ? 122 : 18;
  const BOT = full ? 46 : 30;

  // 图鉴版右侧档案面板：与卡牌顶部对齐，高于卡牌时等比缩小到同高
  const hasDossier = full && dossierImg?.naturalWidth > 0;
  const D_GAP = 36;
  let DW = 0, DH = 0;
  if (hasDossier) {
    const dScale = Math.min(1, CH / dossierImg.naturalHeight);
    DW = dossierImg.naturalWidth * dScale;
    DH = dossierImg.naturalHeight * dScale;
  }

  const W = CW + PAD_X * 2 + (hasDossier ? D_GAP + DW : 0);
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
  roundRectPath(ctx, cardX, cardY, CW, CH, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  ctx.restore();

  drawCardUnderlay(ctx, cardX, cardY, CW, CH, snapshot.cardRoot);

  ctx.save();
  roundRectPath(ctx, cardX, cardY, CW, CH, 16);
  ctx.clip();
  ctx.drawImage(cardImg, cardX, cardY, CW, CH);
  ctx.restore();

  // iOS WebKit 会丢弃 foreignObject 内的 <img>（波纹+头像），SVG 里画面区是空的；
  // 按真实 DOM 布局把波纹与头像直接画到 canvas，跨平台一致（桌面是对齐叠加，结果不变）。
  drawCardArt(ctx, cardX, cardY, artAssets, snapshot.cardRoot);

  // 档案面板：卡牌右侧，顶部与卡牌对齐；先铺桌面色圆角底（带投影），半透明面板叠上观感与网页一致
  if (hasDossier) {
    const dX = cardX + CW + D_GAP;
    const dY = cardY;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 14;
    roundRectPath(ctx, dX, dY, DW, DH, 14);
    ctx.fillStyle = '#10241c';
    ctx.fill();
    ctx.restore();
    ctx.drawImage(dossierImg, dX, dY, DW, DH);
  }

  // 文本
  await waitForFontsReady();
  ctx.textAlign = 'center';
  const setLS = (v) => { if ('letterSpacing' in ctx) ctx.letterSpacing = v; };
  const footY = cardY + CH + GAP_BOT;

  if (!full) {
    // 纯卡牌版：仅在卡下方居中一个金色 POKÉJI
    ctx.font = '900 15px "M PLUS Rounded 1c", "Noto Sans SC", sans-serif';
    setLS('4px');
    ctx.fillStyle = '#e8c565';
    ctx.fillText('POKÉJI', cx, footY + 14);
    setLS('0px');
    return cv;
  }

  // 顶部标题「宝可即图鉴」（金色渐变 + 轻投影）
  ctx.font = '44px "ZCOOL QingKe HuangYou", sans-serif';
  setLS('6px');
  const tg = ctx.createLinearGradient(0, TOP + 22, 0, TOP + 72);
  tg.addColorStop(0, '#f6e79a');
  tg.addColorStop(1, '#dca93a');
  ctx.fillStyle = tg;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillText('宝可即图鉴', cx, TOP + 62);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 副标题
  ctx.font = '14px "Noto Sans SC", sans-serif';
  setLS('3px');
  ctx.fillStyle = '#9db8a7';
  ctx.fillText('POKÉJI · 把你的即刻主页变成专属卡牌', cx, TOP + 100);

  // 底部：特质关键词 + 网址
  ctx.font = '900 22px "Noto Sans SC", sans-serif';
  setLS('2px');
  ctx.fillStyle = '#c2cedd';
  ctx.fillText(`${snapshot.card.type.name}系 · ${snapshot.card.trait}`, cx, footY + 32);

  ctx.font = '12px "M PLUS Rounded 1c", "Noto Sans SC", sans-serif';
  setLS('0px');
  ctx.fillStyle = '#e8c565';
  ctx.fillText('web.pokeji.com', cx, footY + 82);

  setLS('0px');
  return cv;
}

// 合成当前卡片的分享图 PNG blob（导出 / 复制图片共用）
async function composeCardPngBlob(variant = 'plain') {
  if (exportBusy) throw new Error('已有导出任务进行中');
  if (!currentCard) throw new Error('当前没有可导出的卡片');

  const token = ++exportGeneration;
  exportBusy = true;
  setExportControlsDisabled(true);

  const withDossier = variant === 'full' && !dossier.hidden;
  const cardRoot = cardEl.cloneNode(true);
  cardRoot.classList.add('is-exporting');
  cardRoot.style.transform = 'none';
  const dossierRoot = withDossier ? dossier.cloneNode(true) : null;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = '366px';
  host.style.pointerEvents = 'none';
  host.append(cardRoot);
  if (dossierRoot) host.append(dossierRoot);
  document.body.append(host);

  const snapshot = createExportSnapshot({
    card: currentCard,
    cardNo: currentCardNo,
    variant,
    cardRoot,
    dossierRoot,
  });

  try {
    assertExportCurrent(token);
    await waitForPaint();
    assertExportCurrent(token);
    const artAssets = await collectExportArtAssets(snapshot.cardRoot);
    assertExportCurrent(token);

    const fontEmbedCSS = await buildFontEmbedCSS(
      snapshot.cardRoot,
      snapshot.dossierRoot?.textContent || ''
    );
    assertExportCurrent(token);
    // 只用 toSvg 拿矢量快照，光栅化自己做（库内置的 toPng 在部分环境下会挂起）。
    // 头像已预解码，单次调用即可；cacheBust 强制重新拉取，避免切换用户后复用上个用户的缓存图。
    const svgUrl = await htmlToImage.toSvg(snapshot.cardRoot, { fontEmbedCSS, cacheBust: true });

    // SVG decode() 在后台/隐藏页可能不会恢复；onload 对隐藏页更可靠。
    const img = await loadImage(svgUrl, { timeoutMs: 8000, label: 'SVG' });
    assertExportCurrent(token);

    // 图鉴版：档案面板一起快照，画在卡牌右侧（纯文字，无 foreignObject 图片兼容问题）
    let dossierImg = null;
    if (withDossier) {
      const dossierSvg = await htmlToImage.toSvg(snapshot.dossierRoot, { fontEmbedCSS, cacheBust: true });
      dossierImg = await loadImage(dossierSvg, { timeoutMs: 8000, label: '档案' });
      assertExportCurrent(token);
    }

    // 再等一小会，给 iOS 光栅化 foreignObject 内嵌图片的时间
    // （用 setTimeout 而非 rAF：后台/隐藏标签页 rAF 会被暂停导致卡死）
    await wait(120);
    assertExportCurrent(token);

    const composed = await composeExport(img, artAssets, variant, dossierImg, snapshot);
    return await canvasToPngBlob(composed);
  } finally {
    host.remove();
    exportBusy = false;
    setExportControlsDisabled(false);
  }
}

async function exportCardImage(btn, idleText, variant = 'plain') {
  const useMobilePreview = shouldUseMobileExportPreview();
  btn.disabled = true;
  btn.textContent = '合成卡牌中…';
  try {
    const blob = await composeCardPngBlob(variant);
    if (useMobilePreview) {
      showInlineExportPreview(blob);
    } else {
      downloadPngBlob(blob, exportFileName());
    }
  } catch (err) {
    setStatus('导出失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = idleText;
  }
}

// 导出卡牌：纯卡牌版（小边距 + 金色 POKÉJI）
$('download').addEventListener('click', () => exportCardImage($('download'), '导出卡牌', 'plain'));

/* ---- 导出下拉菜单：复制卡牌 / 复制链接 / 导出图鉴 ---- */
const exportMenuBtn = $('exportMenuBtn');
const exportMenu = $('exportMenu');
let statusResetTimer = 0;

function flashStatus(msg) {
  clearTimeout(statusResetTimer);
  setStatus(msg);
  statusResetTimer = setTimeout(() => {
    // 只清除自己写入的提示，避免误清后续出现的其它状态信息
    if (status.textContent === msg) setStatus('');
  }, 2400);
}

function toggleExportMenu(open) {
  const next = open ?? exportMenu.hidden;
  exportMenu.hidden = !next;
  exportMenuBtn.setAttribute('aria-expanded', String(next));
}

exportMenuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleExportMenu();
});

document.addEventListener('click', (e) => {
  if (!exportMenu || exportMenu.hidden) return;
  if (!exportMenu.contains(e.target) && e.target !== exportMenuBtn) toggleExportMenu(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && exportMenu && !exportMenu.hidden) toggleExportMenu(false);
});

// 复制图片：优先把 blob Promise 直接交给 ClipboardItem（Safari 需在用户手势内同步调用），
// 不支持 Promise 入参的浏览器回退为先合成再写入。
async function copyCardImage() {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片，请使用「导出卡牌」');
  }
  const blobPromise = composeCardPngBlob();
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
  } catch {
    const blob = await blobPromise;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
}

async function copyPageLink() {
  const url = location.href;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  // 旧浏览器回退：临时 textarea + execCommand
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('复制失败，请手动复制地址栏链接');
}

exportMenu?.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-export-action]');
  if (!item) return;
  const action = item.dataset.exportAction;
  toggleExportMenu(false);

  if (action === 'export-image') {
    // 导出图鉴：完整海报版（标题 + 特质 + 网址）
    exportCardImage($('download'), '导出卡牌', 'full');
    return;
  }

  if (action === 'copy-link') {
    try {
      await copyPageLink();
      flashStatus('🔗 链接已复制到剪贴板');
    } catch (err) {
      flashStatus('复制链接失败：' + err.message);
    }
    return;
  }

  if (action === 'copy-image') {
    exportMenuBtn.disabled = true;
    try {
      await copyCardImage();
      flashStatus('🖼️ 卡牌图片已复制到剪贴板');
    } catch (err) {
      flashStatus('复制图片失败：' + err.message);
    } finally {
      exportMenuBtn.disabled = false;
    }
  }
});
