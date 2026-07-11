const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

const serverModule = require('../server');
const { fetchUrl } = serverModule;

async function loadCardModule() {
  const source = fs.readFileSync(require.resolve('../public/card.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadExportSessionModule() {
  const source = fs.readFileSync(require.resolve('../public/export-session.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadCardBackModule() {
  const source = fs.readFileSync(require.resolve('../public/card-back.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function profileForPosts(posts) {
  return {
    user: {
      id: 'u',
      username: 'u',
      screenName: 'u',
      createdAt: '2020-01-01T00:00:00Z',
      statsCount: {},
    },
    posts,
  };
}

function startUpstream(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('fetchUrl rejects an upstream response that exceeds the byte limit', async (t) => {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('0123456789');
  });
  t.after(() => upstream.server.close());

  await assert.rejects(
    fetchUrl(upstream.url, {}, 0, null, { maxBytes: 5, timeoutMs: 200 }),
    /响应过大/
  );
});

test('server module exports a callable HTTP handler for serverless runtimes', () => {
  assert.equal(typeof serverModule, 'function');
  assert.equal(typeof serverModule.fetchUrl, 'function');
});

test('fetchUrl rejects an upstream response that never completes', async (t) => {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('still loading');
  });
  t.after(() => upstream.server.close());

  await assert.rejects(
    fetchUrl(upstream.url, {}, 0, null, { maxBytes: 1024, timeoutMs: 30 }),
    /超时/
  );
});

test('duel verdict names a decisive metric won by the final winner', async () => {
  const card = await loadCardModule();
  const left = {
    name: 'Left',
    hp: 110,
    moves: [{ dmg: 10 }, { dmg: 10 }],
    rarityScore: 51,
    metrics: { evoScore: 51, postsPerDay: '1.0', followers: 1000, liked: 1000, years: '1' },
    handSpeed: 2,
    respected: 0,
  };
  const right = {
    name: 'Right',
    hp: 100,
    moves: [{ dmg: 200 }, { dmg: 200 }],
    rarityScore: 50,
    metrics: { evoScore: 50, postsPerDay: '0.9', followers: 100, liked: 100, years: '1' },
    handSpeed: 1,
    respected: 0,
  };

  const duel = card.buildDuel(left, right);

  assert.equal(duel.winner, 'left');
  assert.equal(duel.decisive.winner, 'left');
  assert.match(duel.verdict, /生命|稀有|进化|网感|连接/);
});

test('post frequency is independent of the input post order', async () => {
  const card = await loadCardModule();
  const newest = '2026-07-10T00:00:00Z';
  const oldest = '2026-07-01T00:00:00Z';
  const newestFirst = card.buildCard(profileForPosts([{ actionTime: newest }, { actionTime: oldest }]));
  const oldestFirst = card.buildCard(profileForPosts([{ actionTime: oldest }, { actionTime: newest }]));

  assert.equal(newestFirst.metrics.postsPerDay, '0.2');
  assert.equal(oldestFirst.metrics.postsPerDay, '0.2');
});

test('frequency copy uses the shared 3-and-1 activity tiers', async () => {
  const card = await loadCardModule();
  const makeCard = (postsPerDay) => {
    const spanDays = Math.max(0.5, 2 / postsPerDay);
    const newest = Date.parse('2026-07-10T00:00:00Z');
    return card.buildCard(
      profileForPosts([
        { actionTime: new Date(newest).toISOString() },
        { actionTime: new Date(newest - spanDays * 86400000).toISOString() },
      ])
    );
  };

  assert.equal(makeCard(0.5).flavor.includes('规律的发帖节奏'), false);
  assert.equal(makeCard(1.5).flavor.includes('规律的发帖节奏'), true);
  assert.equal(makeCard(3).flavor.includes('惊人频率'), true);
});

test('export snapshot owns card data and tracks cancellation generations', async () => {
  const session = await loadExportSessionModule();
  const card = { name: '原卡', type: { name: '超' }, moves: [{ name: '技能' }] };
  const snapshot = session.createExportSnapshot({
    card,
    cardNo: 'No.0101',
    variant: 'full',
    cardRoot: { id: 'card-clone' },
    dossierRoot: { id: 'dossier-clone' },
  });

  card.name = '新卡';
  card.type.name = '火';

  assert.equal(snapshot.card.name, '原卡');
  assert.equal(snapshot.card.type.name, '超');
  assert.equal(snapshot.cardNo, 'No.0101');
  assert.equal(session.exportIsCurrent(4, 4), true);
  assert.equal(session.exportIsCurrent(4, 5), false);
});

test('card back turns a profile into a compact Pokéji dossier', async () => {
  const back = await loadCardBackModule();
  const dossier = back.createCardBackDossier({
    name: '小明',
    username: 'xiaoming',
    type: { name: '雷', icon: '⚡' },
    rarity: { key: 'SR', label: '超级稀有' },
    stage: { label: '一阶进化' },
    trait: '活力',
    hp: 180,
    cardNo: 'No.0711',
    metrics: { followers: 1234, liked: 5678, years: '3.2', postsPerDay: '1.6' },
    moves: [{ name: '闪电吐槽' }, { name: '静电刷屏' }],
  });

  assert.equal(dossier.identity, '@xiaoming');
  assert.equal(dossier.type, '⚡ 雷系');
  assert.equal(dossier.activity, '1.6 条 / 天');
  assert.deepEqual(dossier.skills, ['闪电吐槽', '静电刷屏']);
  assert.match(back.cardBackMarkup(dossier), /宝可即档案/);
  assert.match(back.cardBackMarkup(dossier), /POKÉJI/);
});
