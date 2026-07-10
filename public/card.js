// 即刻资料 → 宝可梦卡片属性 的转换规则
// 输入: { user, posts }（来自 m.okjike.com SSR 数据）
// 输出: 渲染卡片所需的全部字段

const TYPES = {
  grass:    { name: '草', icon: '🌿', color: '#4caf50', dark: '#2e7d32', bg: '#e3f3dc' },
  fire:     { name: '火', icon: '🔥', color: '#ef5b3a', dark: '#c62828', bg: '#fde4d5' },
  water:    { name: '水', icon: '💧', color: '#3d9be9', dark: '#1565c0', bg: '#dcefff' },
  electric: { name: '雷', icon: '⚡', color: '#f5c518', dark: '#b8860b', bg: '#fdf3cb' },
  wind:     { name: '风', icon: '🌀', color: '#45b8ac', dark: '#00695c', bg: '#d9f2ef' },
  psychic:  { name: '超', icon: '👁', color: '#a75fbe', dark: '#6a1b9a', bg: '#f0dff6' },
  fighting: { name: '斗', icon: '✊', color: '#b05f36', dark: '#7c3b16', bg: '#f2e0d0' },
  dark:     { name: '魔', icon: '🌙', color: '#6f5b9e', dark: '#453766', bg: '#e8e2f2' },
  metal:    { name: '钢', icon: '⚙', color: '#8ba0b5', dark: '#546e7a', bg: '#e4ebf1' },
  colorless:{ name: '无', icon: '★', color: '#9e9e9e', dark: '#616161', bg: '#eeeeee' },
};

// ---- 圈子 → 属性：第一层，知名圈子词典（预先类型匹配） ----
const TOPIC_TYPE_DICT = {
  一个想法不一定对: 'psychic',
  AI探索站: 'psychic',
  产品经理的日常: 'psychic',
  优质长文分享会: 'psychic',
  读书会: 'psychic',
  一起看世界杯: 'fire',
  此刻的天空: 'wind',
  即刻镇小报: 'wind',
  旅行漫游指南: 'wind',
  播客爱好者: 'wind',
  音乐现场: 'wind',
  手机摄影交流站: 'water',
  摄影集: 'water',
  电影爱好者: 'water',
  剧集观察团: 'water',
  今天吃什么: 'grass',
  饮料爱好者协会: 'grass',
  下厨房: 'grass',
  咖啡续命指南: 'grass',
  程序员的日常: 'electric',
  游戏人生: 'electric',
  数码产品交流: 'metal',
  苹果生态观察: 'metal',
  基金理财交流: 'metal',
  健身打卡: 'fighting',
  运动份子: 'fighting',
  今天走了多少步: 'fighting',
  深夜聊天室: 'dark',
  失眠者俱乐部: 'dark',
  玄学交流中心: 'dark',
};

// ---- 圈子 → 属性：第二层，关键词分类（圈名 + 简介通用） ----
const TYPE_KEYWORDS = {
  grass:    ['美食', '吃', '饮料', '咖啡', '烘焙', '做饭', '餐厅', '奶茶', '下厨'],
  fire:     ['世界杯', '足球', '篮球', '体育', '球迷', '比赛', '应援', '演唱会'],
  water:    ['摄影', '电影', '剧', '影像', '书影音', '画', '设计'],
  electric: ['程序', '开发', '代码', '游戏', '电竞', '效率', '工具'],
  wind:     ['旅行', '旅游', '徒步', '骑行', '露营', '飞盘', '播客', '音乐', '天空'],
  psychic:  ['想法', '产品', 'AI', '科技', '思考', '读书', '研究', '创业', 'HCI', 'UE', '心理', '长文'],
  fighting: ['健身', '运动', '跑步', '打卡', '职场', '打工', '吐槽'],
  dark:     ['深夜', 'emo', '失眠', '玄学', '星座', '塔罗', '梦', '抽象', '梗'],
  metal:    ['数码', '手机', '硬件', '装备', '评测', '理财', '股票', '基金', '搞钱', '苹果'],
};

// ---- 每个属性的技能池：圈名哈希从池中取，同一圈子永远同一技能 ----
const SKILL_POOL = {
  grass: [
    { name: '干饭光合', text: '在「{topic}」进行光合作用，回复自身 20 点 HP，香气使对手分心。' },
    { name: '快乐种草', text: '向「{topic}」的所有围观者种草。掷硬币 1 次，正面则对手也下单。' },
    { name: '奶茶治愈', text: '以「{topic}」的一杯续命饮品完成回复，解除自身所有异常状态。' },
  ],
  fire: [
    { name: '热血应援', text: '为「{topic}」摇旗呐喊，气氛值拉满。命中后对手进入「上头」状态。' },
    { name: '烈焰开麦', text: '在「{topic}」火力全开输出观点，本回合内对手无法反驳。' },
    { name: '连夜燃烧', text: '为「{topic}」熬到凌晨三点。伤害翻倍，但下回合自身陷入「困倦」。' },
  ],
  water: [
    { name: '波光定格', text: '在「{topic}」按下快门，将此刻封存。对手被画面吸引，无法移开视线。' },
    { name: '深潜观影', text: '潜入「{topic}」的深处二刷三刷，积蓄的情感化为伤害。' },
    { name: '潮汐转场', text: '于「{topic}」掀起讨论浪潮，将对手卷入评论区漩涡。' },
  ],
  electric: [
    { name: '闪电吐槽', text: '在「{topic}」以毫秒级手速抢下热评，麻痹对手 1 回合。' },
    { name: '静电刷屏', text: '向「{topic}」连续放电式发帖。每多 1 条动态，此技能伤害 +10。' },
    { name: '过载编译', text: '把「{topic}」的灵感即刻编译上线，暴击率提升但可能产生 bug。' },
  ],
  wind: [
    { name: '旋风漫游', text: '穿行于「{topic}」的大街小巷，行踪飘忽，本回合无法被锁定。' },
    { name: '顺风传声', text: '把「{topic}」听到的好东西随风安利给所有人，波及全场。' },
    { name: '气流托举', text: '借「{topic}」的热度气流起飞，速度提升，先制攻击。' },
  ],
  psychic: [
    { name: '脑洞风暴', text: '在「{topic}」抛出一个不一定对的想法，命中对手思维盲区。' },
    { name: '意念输出', text: '于「{topic}」持续深度思考。每有 1 条评论回复，此技能伤害 +15。' },
    { name: '灵感瞬移', text: '灵感在「{topic}」不预警地降临，无视对手的抵抗力直接命中。' },
  ],
  fighting: [
    { name: '打卡重拳', text: '在「{topic}」完成今日份坚持，自律气场对对手造成压制。' },
    { name: '硬核抬杠', text: '于「{topic}」正面硬刚，双方各承受 20 点伤害，绝不后退。' },
    { name: '搬砖肉搏', text: '带着「{topic}」的班味发起近身攻击，工伤转化为伤害。' },
  ],
  dark: [
    { name: '深夜施法', text: '凌晨在「{topic}」发动禁术，emo 情绪具象化为暗影缠绕对手。' },
    { name: '玄学一击', text: '借「{topic}」的水逆之力攻击。掷硬币 1 次，反面则伤害转移给自己。' },
    { name: '暗影潜水', text: '在「{topic}」隐身围观积蓄魔力，现身时伤害翻倍。' },
  ],
  metal: [
    { name: '参数碾压', text: '在「{topic}」甩出整页跑分截图，数据之重压得对手无法还手。' },
    { name: '装备精通', text: '亮出为「{topic}」置办的全套器材，钱包之痛化为攻击力。' },
    { name: '止损切割', text: '在「{topic}」果断割肉离场，将亏损伤害如数奉还给对手。' },
  ],
  colorless: [
    { name: '日常一击', text: '在「{topic}」记录平凡一天，平平无奇却意外扎心。' },
    { name: '碎碎念', text: '向「{topic}」倾倒今日份碎碎念，对手在絮叨中逐渐失神。' },
  ],
};

// ---- 属性克制表（弱点 / 抵抗） ----
const COUNTER = {
  grass:    { weak: 'fire',     resist: 'water' },
  fire:     { weak: 'water',    resist: 'grass' },
  water:    { weak: 'electric', resist: 'fire' },
  electric: { weak: 'fighting', resist: 'wind' },
  wind:     { weak: 'electric', resist: 'fighting' },
  psychic:  { weak: 'dark',     resist: 'fighting' },
  fighting: { weak: 'psychic',  resist: 'dark' },
  dark:     { weak: 'fighting', resist: 'psychic' },
  metal:    { weak: 'fire',     resist: 'psychic' },
  colorless:{ weak: 'fighting', resist: null },
};

const RARITIES = [
  { key: 'C',  min: 0,  label: '普通',     desc: 'Common' },
  { key: 'U',  min: 30, label: '非凡',     desc: 'Uncommon' },
  { key: 'R',  min: 45, label: '稀有',     desc: 'Rare' },
  { key: 'SR', min: 62, label: '超级稀有', desc: 'Super Rare' },
  { key: 'UR', min: 78, label: '究极稀有', desc: 'Ultra Rare' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const log10 = (v) => Math.log10(Math.max(1, v));
const roundTo10 = (v) => Math.round(v / 10) * 10;

// 250 在中文语境中容易产生不好的联想；只在最终展示值恰好为 250 时轻微让位一档。
// 根据未取整原始值决定偏向 240 或 260，避免所有 250 都机械地改向同一边。
function avoidAwkward250(displayValue, rawValue = displayValue) {
  return displayValue === 250 ? (rawValue < 250 ? 240 : 260) : displayValue;
}

// 稳定字符串哈希：同一圈子永远得到同一结果
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// 圈子 → 属性：词典 → 关键词 → 哈希兜底
function classifyTopic(name) {
  if (TOPIC_TYPE_DICT[name]) return TOPIC_TYPE_DICT[name];
  let best = null;
  let bestScore = 0;
  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    const score = words.reduce((s, w) => s + (name.includes(w) ? w.length : 0), 0);
    if (score > bestScore) { best = type; bestScore = score; }
  }
  if (best) return best;
  const pool = Object.keys(TYPES).filter((t) => t !== 'colorless');
  return pool[hashStr(name) % pool.length];
}

export function buildCard({ user, posts }) {
  const stats = user.statsCount || {};
  const followers = stats.followedCount || 0;
  const liked = stats.liked || 0;
  const following = stats.followingCount || 0;
  const respected = stats.respectedCount || 0;

  const createdAt = new Date(user.createdAt || Date.now());
  const years = (Date.now() - createdAt) / (365.25 * 24 * 3600 * 1000);

  // ---- 行为指标（基于最近的帖子） ----
  const n = posts.length;
  const originals = posts.filter((p) => p.type === 'ORIGINAL_POST');
  const withPics = posts.filter((p) => (p.pictures || []).length > 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likeCount || 0), 0);
  const avgLikes = n ? totalLikes / n : 0;
  const picRatio = n ? withPics.length / n : 0;
  const originalRatio = n ? originals.length / n : 0;

  // 发帖频率：最近动态中有效时间戳覆盖的天数；不依赖上游数组顺序
  let postsPerDay = 0;
  const postTimes = posts
    .map((p) => Date.parse(p?.actionTime))
    .filter(Number.isFinite);
  if (postTimes.length >= 2) {
    const latest = postTimes.reduce((max, time) => Math.max(max, time), -Infinity);
    const earliest = postTimes.reduce((min, time) => Math.min(min, time), Infinity);
    const spanDays = Math.max(
      0.5,
      (latest - earliest) / 86400000
    );
    postsPerDay = postTimes.length / spanDays;
  }

  // ---- 圈子聚合：每个圈子的发帖数与互动 ----
  const topicMap = new Map();
  for (const p of posts) {
    const t = p.topic?.content;
    if (!t) continue;
    const agg = topicMap.get(t) || { name: t, count: 0, likes: 0, comments: 0, reposts: 0 };
    agg.count += 1;
    agg.likes += p.likeCount || 0;
    agg.comments += p.commentCount || 0;
    agg.reposts += p.repostCount || 0;
    topicMap.set(t, agg);
  }
  const topics = [...topicMap.values()]
    .sort((a, b) => b.count - a.count || b.likes - a.likes)
    .map((t) => ({ ...t, typeKey: classifyTopic(t.name) }));

  // ---- 卡片属性：圈子投票（发帖数加权）+ 简介关键词 ----
  const bio = user.briefIntro || user.bio || '';
  const typeScores = {};
  for (const t of topics) typeScores[t.typeKey] = (typeScores[t.typeKey] || 0) + t.count * 2;
  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    const s = words.reduce((acc, w) => acc + (bio.split(w).length - 1), 0);
    if (s) typeScores[type] = (typeScores[type] || 0) + s;
  }
  const typeKey =
    Object.entries(typeScores).sort((a, b) => b[1] - a[1]).find(([, v]) => v > 0)?.[0] ||
    'colorless';
  const type = TYPES[typeKey];

  // ---- HP：粉丝 + 获赞 + 即龄，对数缩放，取整到 10 ----
  const fScore = clamp(log10(followers + 1) / 5, 0, 1); // 10 万粉丝 = 满分
  const lScore = clamp(log10(liked + 1) / 5.5, 0, 1);
  const aScore = clamp(years / 10, 0, 1);
  const hpRaw = 40 + 260 * (0.5 * fScore + 0.3 * lScore + 0.2 * aScore);
  const hp = avoidAwkward250(clamp(roundTo10(hpRaw), 40, 300), hpRaw);

  // ---- 进化阶段：即龄 × 影响力 综合分驱动分级；6 年+ 且 5000 粉+ 解锁「超进化」彩蛋 ----
  // evoScore = 即龄 0.3 + 粉丝 0.6 + 获赞 0.1：影响力主导、时间次之，
  // 让蹿升的新星靠数据直接进阶，纯熬年头的僵尸号顶不到二阶。
  const evoScore = aScore * 0.3 + fScore * 0.6 + lScore * 0.1;
  const isMega = years >= 6 && followers >= 5000;
  const stage =
    isMega           ? { label: '超进化', from: '二阶进化', mega: true } :
    evoScore >= 0.58 ? { label: '二阶进化', from: '一阶进化' } :
    evoScore >= 0.3  ? { label: '一阶进化', from: '基础' } :
                       { label: '基础', from: null };

  // ---- 稀有度综合评分 ----
  const engScore = clamp(log10(avgLikes + 1) / 3, 0, 1);
  const rarityScore =
    fScore * 30 + lScore * 25 + aScore * 20 + engScore * 15 +
    (user.isVerified ? 6 : 0) + (user.isSponsor ? 4 : 0);
  const rarity = [...RARITIES].reverse().find((r) => rarityScore >= r.min) || RARITIES[0];

  // ---- 夸夸加成：对数曲线 15·log10(n+1)，取整到 10，下限 +10 上限 +50 ----
  // 2 次 → +10，10 次 → +20，100 次 → +30，1000 次 → +50
  const respectBonus =
    respected > 0
      ? clamp(Math.round((15 * Math.log10(respected + 1)) / 10) * 10, 10, 50)
      : 0;

  // ---- 技能：优先由圈子生成（圈子属性 + 圈名哈希选技能），不足则用行为技能补位 ----
  const moves = [];
  if (topics.length >= 2) {
    moves.push(buildTopicMove(topics[0], respectBonus, followers));
    moves.push(buildTopicMove(topics[1], respectBonus, followers));
  } else if (topics.length === 1) {
    moves.push(buildBehaviorMove({ picRatio, originalRatio, avgLikes, postsPerDay, type, respectBonus }));
    moves.push(buildTopicMove(topics[0], respectBonus, followers));
  } else {
    moves.push(buildBehaviorMove({ picRatio, originalRatio, avgLikes, postsPerDay, type, respectBonus }));
    moves.push({
      name: '沉默潜水', cost: 2, type, origin: '行为特征',
      dmg: avoidAwkward250(
        clamp(roundTo10(log10(followers + 1) * 20) + respectBonus, 20, 250),
        log10(followers + 1) * 20 + respectBonus
      ),
      text: '长期潜水积蓄能量。使用后跳过一回合，但下回合伤害翻倍。',
    });
  }

  // ---- 弱点 / 抵抗 / 手速（与即友身份绑定）----
  const counter = COUNTER[typeKey];

  // 弱点 = 本命圈子（发帖最多）：你最容易上钩、一聊就上头的话题。无圈子数据时回退属性克制
  const topCircle = topics[0] || null;
  const weakness = topCircle ? TYPES[topCircle.typeKey] : counter.weak ? TYPES[counter.weak] : null;
  const weaknessTopic = topCircle ? topCircle.name : null;

  // 抵抗力 = 你几乎不碰的系别（免疫领域）；圈子已覆盖全部系别时回退属性克制
  const presentTypes = new Set(topics.map((t) => t.typeKey));
  const missingTypes = Object.keys(TYPES).filter(
    (t) => t !== 'colorless' && t !== typeKey && !presentTypes.has(t)
  );
  const resistKey = missingTypes.length
    ? missingTypes[hashStr(user.username || '') % missingTypes.length]
    : counter.resist;
  const resistance = resistKey ? TYPES[resistKey] : null;

  // 手速：发帖越频繁手速越高（日更狂魔 ★★★，潜水党 ★）。
  // postsPerDay 是最近动态覆盖窗口内的平均频率，阈值与文案统一为 1 / 3 条每天。
  const handSpeed = activityTier(postsPerDay);

  // ---- 突出特质：由最强维度决定（超进化直接封「魅力」），写进图鉴 ----
  const traitPool = [
    { name: '稳重', score: aScore, why: '即龄深厚' },              // 即龄
    { name: '号召力', score: fScore, why: '粉丝众多' },            // 粉丝影响力
    { name: '人气', score: lScore, why: '获赞满满' },              // 获赞
    { name: '活力', score: clamp(postsPerDay / 3, 0, 1), why: '高频发帖' }, // 发帖频率
    { name: '实力', score: respectBonus / 50, why: '夸夸加持' },   // 夸夸强化
  ];
  const topTrait = [...traitPool].sort((a, b) => b.score - a.score)[0];
  const trait = isMega ? '魅力' : topTrait.name;
  const traitWhy = isMega ? '超进化专属' : topTrait.why;

  // ---- 图鉴风味文本 ----
  const flavor = buildFlavor({
    createdAt, type, postsPerDay, handSpeed, picRatio, followers, respected, years, weaknessTopic, resistance, trait,
  });

  return {
    username: user.username || user.id || '',
    name: user.screenName || '神秘即友',
    bio,
    avatar: user.avatarImage?.picUrl || user.profileImageUrl || '',
    hp,
    type,
    typeKey,
    stage,
    rarity,
    rarityScore: Math.round(rarityScore),
    moves,
    weakness,
    weaknessTopic,
    resistance,
    handSpeed,
    flavor,
    trait,
    traitWhy,
    respected,
    respectBonus,
    cardNo: `No.${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`,
    infoLine: `宝可即连接 ｜ 关注 ${fmt(following)}　　被关注 ${fmt(followers)}　　获赞 ${fmt(liked)}`,
    isVerified: !!user.isVerified,
    isSponsor: !!user.isSponsor,
    metrics: { followers, liked, years: years.toFixed(1), postsPerDay: postsPerDay.toFixed(1), picRatio, avgLikes: avgLikes.toFixed(1), evoScore: Math.round(evoScore * 100) },
  };
}

export function buildDuel(left, right) {
  const attackLeft = movePower(left);
  const attackRight = movePower(right);
  const linkLeft = linkScore(left);
  const linkRight = linkScore(right);
  const speedLeft = speedScore(left);
  const speedRight = speedScore(right);

  const rows = [
    duelRow('hp', '生命', left.hp, right.hp, `${left.hp} HP`, `${right.hp} HP`, '粉丝、获赞、即龄折算出的卡面 HP'),
    duelRow('attack', '火力', attackLeft, attackRight, `${attackLeft}`, `${attackRight}`, '两项技能伤害合计'),
    duelRow('rarity', '稀有', left.rarityScore, right.rarityScore, `${left.rarityScore}`, `${right.rarityScore}`, '综合评分决定卡面稀有度'),
    duelRow(
      'evo',
      '进化',
      num(left.metrics.evoScore),
      num(right.metrics.evoScore),
      `${left.metrics.evoScore}`,
      `${right.metrics.evoScore}`,
      '即龄、粉丝、获赞共同决定的进化值'
    ),
    duelRow(
      'speed',
      '网感',
      speedLeft,
      speedRight,
      speedLabel(left),
      speedLabel(right),
      '最近动态推算出的发帖节奏'
    ),
    duelRow('link', '连接', linkLeft, linkRight, `${linkLeft}`, `${linkRight}`, '粉丝、获赞、夸夸综合成的连接力'),
  ];

  const score = rows.reduce(
    (acc, row) => {
      if (row.winner === 'left') acc.left += 1;
      if (row.winner === 'right') acc.right += 1;
      return acc;
    },
    { left: 0, right: 0 }
  );
  const winner = score.left === score.right ? null : score.left > score.right ? 'left' : 'right';
  const winnerCard = winner ? (winner === 'left' ? left : right) : null;
  const winnerRows = winner ? rows.filter((r) => r.winner === winner) : [];
  const decisive = winnerRows.sort((a, b) => b.delta - a.delta)[0] || rows[0];

  return {
    left,
    right,
    rows,
    score,
    winner,
    decisive,
    receipts: [
      receiptRow('粉丝连接', left.metrics.followers, right.metrics.followers),
      receiptRow('累计获赞', left.metrics.liked, right.metrics.liked),
      receiptRow('夸夸强化', left.respected, right.respected),
      receiptRow('即刻年资', `${left.metrics.years} 年`, `${right.metrics.years} 年`),
      receiptRow('发帖频率', `${left.metrics.postsPerDay}/天`, `${right.metrics.postsPerDay}/天`),
      receiptRow('技能火力', attackLeft, attackRight),
    ],
    verdict: winnerCard
      ? `${winnerCard.name} 以 ${score.left}:${score.right} 拿下决斗，关键优势来自「${decisive.label}」。`
      : `双方 ${score.left}:${score.right} 战平，这场决斗更适合继续加赛一轮。`,
  };
}

function duelRow(key, label, leftValue, rightValue, leftText, rightText, note) {
  const l = num(leftValue);
  const r = num(rightValue);
  const winner = l === r ? 'draw' : l > r ? 'left' : 'right';
  const total = l + r;
  const leftPct = total > 0 ? Math.round((l / total) * 100) : 50;
  const rightPct = total > 0 ? 100 - leftPct : 50;
  return {
    key,
    label,
    left: l,
    right: r,
    leftText,
    rightText,
    note,
    winner,
    delta: Math.abs(l - r),
    leftPct,
    rightPct,
  };
}

function receiptRow(label, left, right) {
  return { label, left, right };
}

function movePower(card) {
  return (card.moves || []).reduce((sum, move) => sum + num(move.dmg), 0);
}

function speedScore(card) {
  const postsPerDay = num(card.metrics?.postsPerDay);
  return Math.round(clamp(postsPerDay / 2, 0, 1) * 100);
}

function speedLabel(card) {
  const label = ['', '潜水党', '规律党', '日更狂魔'][card.handSpeed] || '潜水党';
  return `${'★'.repeat(card.handSpeed)} ${label}`;
}

function linkScore(card) {
  const followers = num(card.metrics?.followers);
  const liked = num(card.metrics?.liked);
  const respected = num(card.respected);
  return Math.round(
    clamp(log10(followers + 1) / 5, 0, 1) * 45 +
      clamp(log10(liked + 1) / 5.5, 0, 1) * 35 +
      clamp(log10(respected + 1) / 4, 0, 1) * 20
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 圈子技能：属性来自圈子分类，技能名由圈名哈希从该属性技能池中选取
function buildTopicMove(topic, respectBonus, followers) {
  const typeKey = topic.typeKey;
  const pool = SKILL_POOL[typeKey] || SKILL_POOL.colorless;
  const skill = pool[hashStr(topic.name) % pool.length];
  const base = topic.likes * 8 + topic.comments * 12 + topic.reposts * 15 + topic.count * 10 + log10(followers + 1) * 10;
  const dmg = avoidAwkward250(clamp(roundTo10(base), 10, 200) + respectBonus, base + respectBonus);
  return {
    name: skill.name,
    cost: clamp(Math.ceil(topic.count / 2), 1, 3),
    dmg,
    text: skill.text.replaceAll('{topic}', topic.name),
    type: TYPES[typeKey],
    origin: `圈子「${topic.name}」`,
  };
}

// 行为技能：由内容形态决定（无圈子数据时的补位）
function buildBehaviorMove({ picRatio, originalRatio, avgLikes, postsPerDay, type, respectBonus }) {
  const rawDmg = avgLikes * 10 + picRatio * 30;
  const dmg = avoidAwkward250(clamp(roundTo10(rawDmg), 10, 200) + respectBonus, rawDmg + respectBonus);
  const cost = clamp(Math.ceil(postsPerDay), 1, 3);
  const base = { cost, dmg, type, origin: '行为特征' };
  if (picRatio >= 0.4)
    return { ...base, name: '图文并茂', text: '附带精修配图的动态。对手被画面吸引，下回合无法移开视线。' };
  if (originalRatio >= 0.7)
    return { ...base, name: '原创冲击', text: '倾注真情实感的原创输出。掷硬币 1 次，若为正面则额外获得 10 个赞。' };
  return { ...base, name: '转发风暴', text: '一键转发引发的信息涟漪，波及在场所有关注者。' };
}

function buildFlavor({ createdAt, type, postsPerDay, handSpeed, picRatio, followers, respected, years, weaknessTopic, resistance, trait }) {
  const freq =
    handSpeed === 3 ? `以日均 ${postsPerDay.toFixed(1)} 条动态的惊人频率活动` :
    handSpeed === 2 ? '保持着规律的发帖节奏' :
                      '习惯安静地潜伏观察';
  // 弱点=本命圈子、抵抗力=免疫系别，写进图鉴，凸显即友身份
  const soft = weaknessTopic
    ? `面对本命圈子「${weaknessTopic}」毫无抵抗力${resistance ? `，却对${resistance.name}系内容自动免疫` : ''}。`
    : '';
  const praise = respected > 0 ? `曾被夸夸 ${respected} 次，攻击力因此强化。` : '';
  return `自 ${createdAt.getFullYear()} 年起栖息于即刻森林的${type.name}系宝可即。${freq}。${soft}${praise}其${trait || '魅力'}已吸引 ${fmt(followers)} 个宝可即慕名连接。`;
}

function activityTier(postsPerDay) {
  return postsPerDay >= 3 ? 3 : postsPerDay >= 1 ? 2 : 1;
}

function fmt(v) {
  return v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(v);
}

export { TYPES };
