function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fmt(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('zh-CN').format(number);
}

export function createCardBackDossier(card) {
  const username = String(card?.username || '').replace(/^@/, '');
  return {
    identity: username ? `@${username}` : '即刻训练家',
    name: card?.name || '神秘即友',
    type: `${card?.type?.icon || '★'} ${card?.type?.name || '无'}系`,
    rarity: `${card?.rarity?.key || 'C'} · ${card?.rarity?.label || '普通'}`,
    stage: card?.stage?.label || '基础',
    trait: card?.trait || '连接',
    hp: card?.hp || 0,
    followers: fmt(card?.metrics?.followers),
    likes: fmt(card?.metrics?.liked),
    archive: `${card?.metrics?.years || '0.0'} 年`,
    activity: `${card?.metrics?.postsPerDay || '0.0'} 条 / 天`,
    skills: (card?.moves || []).slice(0, 2).map((move) => move?.name || '未命名技能'),
    cardNo: card?.cardNo || 'No.0000',
  };
}

export function createBrandCardBackDossier() {
  return {
    identity: 'POKÉJI.COM',
    name: '宝可即档案库',
    type: '✦ 即刻森林',
    rarity: 'ARCHIVE · 收藏版',
    stage: '连接已建立',
    trait: '好奇',
    hp: '∞',
    followers: '每一位即友',
    likes: '每一次共鸣',
    archive: '2026 年启用',
    activity: '持续收录中',
    skills: ['把主页变成卡牌', '在兴趣里相遇'],
    cardNo: 'No.PJ01',
  };
}

export function cardBackMarkup(dossier) {
  const skills = (dossier.skills || []).map((skill) => `<li>${esc(skill)}</li>`).join('');
  return `
    <div class="card-back__inner">
      <div class="card-back__topline"><span>宝可即档案</span><span>PROFILE ARCHIVE</span></div>
      <div class="card-back__seal" aria-hidden="true"><span>即</span></div>
      <p class="card-back__wordmark">POKÉJI</p>
      <p class="card-back__identity">${esc(dossier.identity)}</p>

      <section class="card-back__identity-block">
        <div><b>${esc(dossier.name)}</b><span>${esc(dossier.type)}</span></div>
        <strong><small>HP</small>${esc(dossier.hp)}</strong>
      </section>

      <dl class="card-back__traits">
        <div><dt>稀有度</dt><dd>${esc(dossier.rarity)}</dd></div>
        <div><dt>进化</dt><dd>${esc(dossier.stage)}</dd></div>
        <div><dt>特质</dt><dd>${esc(dossier.trait)}</dd></div>
      </dl>

      <dl class="card-back__numbers">
        <div><dt>被关注</dt><dd>${esc(dossier.followers)}</dd></div>
        <div><dt>获赞</dt><dd>${esc(dossier.likes)}</dd></div>
        <div><dt>即龄</dt><dd>${esc(dossier.archive)}</dd></div>
        <div><dt>活跃</dt><dd>${esc(dossier.activity)}</dd></div>
      </dl>

      <div class="card-back__skills"><span>已登记技能</span><ul>${skills}</ul></div>
      <div class="card-back__foot"><span>${esc(dossier.cardNo)}</span><span>WEB.POKEJI.COM</span></div>
    </div>
    <div class="card-back__foil" aria-hidden="true"></div>
  `;
}
