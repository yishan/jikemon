# 即刻宝可梦图鉴 · Pokéji — 技术文档

把即刻（Jike）个人主页数据渲染成宝可梦 TCG 风格收藏卡牌的单页应用 + 零依赖 Node
服务端。灵感来自 [gitfut](https://github.com/Younesfdj/gitfut)（GitHub 资料 → FIFA
球员卡），卡面致敬 Pokémon TCG。

> 本文档从技术视角描述系统设计：架构、数据流、核心算法、安全边界与导出管线。
> 产品玩法（字段含义、分享话术）见页面与代码注释，此处不赘述。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 服务端 | Node.js ≥ 18 原生 `http`，**零第三方依赖** | 静态托管 + 数据/图片代理 + OG meta 注入 |
| 前端 | 原生 ES Modules（无框架、无构建） | `card.js` 为纯函数转换层，与 DOM 解耦 |
| 样式 | 手写 CSS（自定义属性驱动主题） | 响应式缩放靠 CSS 变量 `--m` |
| 运行时依赖 | 仅 2 个 CDN 库 | `html-to-image`（导出）、`canvas-confetti`（庆祝动画） |
| 测试 | `node:test`（Node 内置） | 零依赖，`node --test` 即可运行 |

## 架构总览

```
┌──────────────┐   /api/profile?  /api/duel?   /api/img?u=   ┌──────────────────┐
│   浏览器 SPA  │ ──────────────────────────────────────────▶ │     server.js     │
│  app.js 渲染  │                                             │  Node http 服务端  │
│  卡面 / 导出   │ ◀────────────────────────────────────────── │  代理层（无状态）  │
└──────────────┘   JSON / PNG（CORS）                          └────────┬─────────┘
      │                                                               │ fetchUrl
      │ card.js（纯函数转换）                                          │ (重定向跟随/限长/超时/域名守卫)
      ▼                                                               ▼
┌──────────────┐              ┌──────────────────┐        ┌──────────────────┐
│  卡面渲染层    │              │  m.okjike.com SSR  │        │  即刻图片 CDN     │
│ DOM + canvas  │              │   __NEXT_DATA__   │        │  ruguoapp.com    │
└──────────────┘              └──────────────────┘        └──────────────────┘
```

数据流端到端：

1. 用户粘贴即刻主页链接（支持 `okjk.co/<短码>`、`web.okjike.com/u/<id>`、
   `m.okjike.com/user(s)/<id>`、裸 `/u/<id>`、裸 UUID 共 5 种形态）。
2. `app.js` 请求 `/api/profile?id=…`，`server.js` 代理抓取 `m.okjike.com/users/<id>`
   的 SSR HTML，解析 `<script id="__NEXT_DATA__">` JSON 得到 `{ user, posts }`。
3. 浏览器端调用纯函数 `buildCard({ user, posts })`，得到结构化卡片对象
   （HP、属性、技能、稀有度、图鉴文本等全部字段）。
4. `render()` 把卡片对象渲染进 DOM；导出时再经 **SVG 快照 → canvas 合成**管线
   输出 3 倍分辨率 PNG。

## 数据获取层（`server.js`）

### 为什么抓 SSR 页面而不是官方 API

即刻 Web API 需要登录 token；移动端分享页 `m.okjike.com/users/<id>` 是公开 SSR
页面，`__NEXT_DATA__` 内嵌完整用户资料 + 最近动态（约 10 条）。因此服务端以
iPhone UA 抓取该页面并解析 JSON，天然绕开鉴权与 CORS（浏览器直连会被 CORS 拦截）。

### HTTP 接口

| 路由 | 参数 | 说明 | 防护 |
|---|---|---|---|
| `GET /api/profile` | `id`（任意形态） | 抓取单个用户 `{user, posts}` | 限流 |
| `GET /api/duel` | `left`、`right` | `Promise.all` 并发抓取两位用户 | 限流 |
| `GET /api/img` | `u`（URL） | 代理即刻 CDN 图片 + `Access-Control-Allow-Origin: *` | 域名白名单 |
| `/`、`/u/<id>`、`/vs`、`/u/<A>/vs/<B>` | — | 统一返回注入 OG meta 的 `index.html` | — |
| `/og.png`、`/og/default.png`、`/og/u/<id>.png` | — | 静态分享图（旧 URL 兼容重映射） | — |

`/api/img` 的 CORS 头是**硬需求**：卡面头像经 `<img crossorigin>` 载入，canvas
导出要求图片响应含 CORS 头，否则画布被污染、`toBlob` 抛 SecurityError。

### 上游抓取器 `fetchUrl`

统一的上游请求原语，四个硬性约束：

- **重定向跟随**（默认 3 跳，可配），短链 `okjk.co` 302 到 `http://` 的
  `m.okjike.com`，因此按响应协议选择 `http`/`https` 模块，不写死。
- **域名守卫 `hostGuard`**：初始 URL 与**每一跳重定向**的目标都校验域名，防 SSRF。
- **字节上限**：profile 4 MiB、图片 10 MiB，超限即销毁响应（流式计数，非事后检查）。
- **超时**：默认 10 s，`request.setTimeout` 兜底。

### 安全边界

- **SSRF 防护**：主页抓取只允许 `okjk.co` / `okjike.com` 及其子域；图片代理只允许
  `ruguoapp.com` / `okjike.com`（即刻图片 CDN）。拒绝非 HTTP(S) 协议。
- **限流**：`/api/profile` 与 `/api/duel` 共享同一按 IP 的内存滑动窗口，每分钟
  10 次，超限返回 429（前端文案「精灵球冷却中」）；Map 超 10 000 项时惰性清理
  过期 IP。
- **路径穿越**：静态文件服务校验 `path.join` 结果必须位于 `PUBLIC_DIR` 内。
- **OG 注入防注入**：meta 值经 `attr()` 做 HTML 实体转义。

### 部署形态

单文件同时支持两种运行方式：

```js
if (require.main === module) server.listen(PORT, HOST, …) // 本地/容器
module.exports = handler;                                 // serverless（Vercel）
```

`handler` 上还挂载 `fetchUrl` / `handleRequest` 供测试与外部复用。OG meta 的
`og:url` / `og:image` 基于 `x-forwarded-proto` / `x-forwarded-host` 重建公网地址，
适配反向代理与 Serverless 平台。

## 转换层（`public/card.js`）

**纯函数、零 DOM 依赖**：`buildCard({user, posts}) → Card` 与
`buildDuel(left, right) → Duel`。因此可被 Node 测试直接加载
（见 [测试](#测试)）。

### 确定性设计

同一用户永远生成同一张卡，靠三个机制保证：

1. **稳定哈希** `hashStr`（djb2 变体）：圈子名 → 技能池下标、用户名 → 抵抗系别。
   陌生圈子/用户不会因排序或随机数漂移。
2. **属性分类三层判定** `classifyTopic(name)`：
   - ① `TOPIC_TYPE_DICT` 知名圈子词典（约 30 个手工条目）；
   - ② `TYPE_KEYWORDS` 关键词加权分类器（圈名或简介命中关键词，按词长加权）；
   - ③ 兜底：圈名哈希映射到非无色系之一。
   刻意不做全量圈子枚举（即刻无公开接口且圈子动态新增），词典 + 分类器 + 哈希
   覆盖任意输入，扩充词典只需往 `TOPIC_TYPE_DICT` 加条目。
3. **数值避让** `avoidAwkward250`：展示值恰好为 250 时按未取整原始值让位到
   240/260，避开中文语境不吉利的数字联想，同时保留强弱趋势。

### 关键算法速查

| 字段 | 输入 | 算法 |
|---|---|---|
| 发帖频率 `postsPerDay` | 帖子 `actionTime` | 窗口内帖子数 ÷ 时间跨度（下限 0.5 天）；**只取 min/max 时间戳，与数组顺序无关** |
| HP | 粉丝 / 获赞 / 即龄 | `40 + 260·(0.5·f + 0.3·l + 0.2·a)`，各分量对数缩放（10 万粉满分），取整到 10，夹在 [40, 300] |
| 属性 | 圈子投票 ×2 + 简介关键词 | 各系累计分取最高；无分则无色系 |
| 进化阶段 | 即龄 / 粉丝 / 获赞 | `evoScore = 0.3a + 0.6f + 0.1l`；≥0.3 一阶、≥0.58 二阶；`年限≥6 && 粉丝≥5000` 触发「超进化」 |
| 稀有度 | 综合评分 | `30f + 25l + 20a + 15·互动率 + 6·认证 + 4·会员` → C/U/R/SR/UR 五档 |
| 技能 ×2 | 发帖最多两圈 | 属性由圈子分类；技能名/文案由 `hashStr(圈名)` 从该系技能池取；伤害 = `获赞·8 + 评论·12 + 转发·15 + 发帖·10 + 粉丝对数加成`，取整到 10；能量 = 发帖数 |
| 行为技能（补位） | 帖子形态 | 图文占比 ≥40% →「图文并茂」；原创率 ≥70% →「原创冲击」；否则「转发风暴」；无任何圈子时兜底「沉默潜水」 |
| 夸夸强化 | `respectedCount` | `15·log10(n+1)` 取整到 10，夹在 [10, 50]，叠加入技能伤害 |
| 弱点 / 抵抗 | 圈子分布 | 弱点 = 本命圈子（发帖最多）属性 ×2；抵抗 = 圈子完全未出现的系别（用户名哈希选一）-30；无圈子数据时回退 `COUNTER` 克制表 |
| 手速 | `postsPerDay` | ≥3 ★★★ / ≥1 ★★ / 否则 ★ |
| 突出特质 | 各维度分 | 取最高分维度（稳重/号召力/人气/活力/实力）；超进化固定「魅力」 |
| 卡片编号 | 注册月日 | `No.MMDD / JIKE` |
| 图鉴文本 | 多字段 | 模板拼接，含注册年份、频率、软肋/免疫、夸夸次数、连接数 |

### VS 对决 `buildDuel`

六项指标（生命/火力/稀有/进化/网感/连接）两两比较，输出：

- 每行的 `winner`（left/right/draw）、胜方**领先百分比**（用于进度条渲染）；
- 总分与胜者；`decisive` = 胜方领先幅度最大的一行（「关键优势来自…」）；
- `receipts`：六行原始数据清单，供页面展示「小票」。

## 渲染与交互层（`public/app.js`）

### 状态与缓存

- `currentCard` / `currentProfileData` / `currentDuel` 等全局状态驱动单页渲染；
- `profileCache`：**promise 化的请求去重**——同一 ID 的并发请求共享同一个 fetch
  promise，失败时删除条目允许重试；成功时按原始输入、username、id 三个 key 建档，
  保证短链与长链命中同一缓存；
- `duelPairCache`：对战双人组合级缓存，命中后同时回填两侧单人缓存。

### 路由

- `initRoute()` 解析路径：`/u/<A>/vs/<B>` 直达对决；`/u/<id>/vs`、`/vs` 进入对战
  搭建页（问号卡 + 挑战按钮）；`/u/<id>` 自动填入输入框并触发抓取（落地即出卡）；
- 抓取成功后 `history.replaceState('/u/<权威username>')` 同步地址栏为可分享直达
  链接（短链也能正确归一为完整 ID）；
- SPA 内跳转用 `pushState`，`popstate` 时整页 reload 重新走路由解析。

### 渲染细节

- 卡面以 **504×704 设计尺寸**（63:88，TCG 印刷规格）编写；显示时经 `fitCard()`
  计算缩放系数写入 CSS 变量 `--m`（桌面 366px，窄屏等比缩小），避免文字重排变形；
- 属性波纹背景用 `makeRippleDataUrl()` 在 **canvas 上预渲染成位图 data URL**，
  以 `<img>` 铺底——CSS 渐变在导出光栅化时不可靠，位图保证跨浏览器一致；
- SR/UR 卡叠加 `.holo` 镭射层（color-dodge 混合，随鼠标移动），`attachTilt` 提供
  3D 倾斜；抓取过程有 rAF 驱动的精灵球进度动画（失败时回退占位卡）。

### 导出管线（本项目最复杂的部分）

目标：从 DOM 卡面得到 **3 倍分辨率（1512×2112）PNG**，跨平台一致（重点兼容
iOS WebKit）。管线分五个阶段，每阶段间用代际 token 检查取消：

```
cloneNode 离屏渲染 → 资源预收集 → 字体内联 → toSvg 矢量快照 → canvas 合成 → PNG
```

1. **离屏快照**：`cardEl.cloneNode(true)` 挂到 `position:fixed; left:-100000px` 的
   host 节点，`createExportSnapshot` 深拷贝卡片数据 —— 导出期间用户再次操作（如
   切换用户）不影响进行中的导出。
2. **取消机制**（`export-session.js`）：全局 `exportGeneration` 代际计数；每个导出
   任务持有自己的 token，各阶段之间 `assertExportCurrent(token)` 校验，失效即抛
   「导出已取消」。同时导出期间禁用全部操作控件。
3. **字体内联**（`buildFontEmbedCSS`）：对卡面实际出现的字符（`text=` 参数）向
   Google Fonts 请求**迷你子集**，再把每个 woff2 下载转成 data URI —— 避免拉取
   Noto Sans SC 的 200+ 个 unicode-range 分片，且保证 SVG 快照内文字不依赖网络。
4. **矢量快照**：用 `html-to-image.toSvg`（**而非 html2canvas** —— 后者不支持
   color-dodge 混合模式，镭射会导出发灰）。库内置 `toPng` 在部分环境挂起，故只取
   SVG 再自行光栅化；`cacheBust: true` 防止切换用户后复用上个用户的缓存头像。
5. **canvas 合成**（`composeExport`）：按逻辑尺寸 504×704、倍率 `S=3` 绘制——
   深绿渐变背景 + 卡后 mesh 背光 + 圆角投影 → `drawImage` 卡片快照 → **补绘
   波纹与头像**（iOS WebKit 会丢弃 foreignObject 内的 `<img>`，故按 DOM 布局把
   两图直接画到 canvas 兜底）→ 可选档案面板 → canvas 文本（标题渐变、页脚、
   `web.pokeji.com`）。整个合成流程保持与网页视觉一致。

另有两个导出变体：`plain`（纯卡牌 + 底部 POKÉJI 字标）与 `full`（图鉴版：卡牌 +
右侧档案面板 + 标题页眉）；卡背 `composeCardBackPngBlob` 复用同一套 SVG 快照管线
输出通用 POKÉJI 卡背（无个人数据）。移动端导出先弹内联预览（锁滚动/双指缩放），
确认后才触发下载或复制到剪贴板。

## 测试（`test/review.test.js`）

`node --test` 即可运行（Node 18+ 内置测试器，零依赖）。测试手法上有两个值得
注意的点：

- **浏览器 ESM 模块在 Node 中加载**：项目无 `package.json`、`card.js` 等用 ESM
  语法，测试通过 `import('data:text/javascript;base64,…')` 的方式把源码直接喂给
  V8，绕开扩展名与 module type 限制，无需构建。
- **测试内起真上游服务器**：`startUpstream` 在随机端口起 `http.createServer`，
  直接打 `fetchUrl` 验证字节限制与超时行为，不 mock 网络。

覆盖范围：`fetchUrl` 超限/超时、serverless handler 导出、VS 胜负与决定性指标一致
性、发帖频率与帖子顺序无关、活动分档文案、导出快照深拷贝与代际比较、卡背不含
个人数据。

## 运行与部署

```bash
node server.js                 # http://localhost:4399
PORT=8080 node server.js       # 自定义端口
node --test                    # 运行测试
```

- 环境变量：`PORT`（默认 4399）、`HOST`。
- 生产部署：`server.js` 导出标准 `(req, res)` handler，可直接部署到 Vercel 等
  Serverless 平台；OG 图片缓存头含 `s-maxage` 便于 CDN 层缓存。
- 域名规划：路由与即刻同构，`web.okjike.com/u/<id>` 换成 `web.pokeji.com/u/<id>`
  即直达出卡，分享传播零成本。

## 目录结构

```
server.js           零依赖 Node 服务器（静态托管 + 代理 + OG meta 注入 + 限流）
public/
  index.html        页面骨架（含 OG meta 注入点、CDN 依赖、导出菜单）
  app.js            渲染 / 路由 / 抓取动画 / 3D 倾斜 / 导出管线（~1900 行）
  card.js           纯函数转换层：即刻数据 → 卡片对象（含全部算法与词典）
  card-back.js      通用卡背纹理生成（无个人数据）
  export-session.js 导出快照 + 代际取消原语
  style.css         收藏家桌面 + 卡面样式（--m 缩放、holo 镭射、响应式）
  og.svg / og.png   静态社交分享图（源文件 / 成品 1200×630）
test/
  review.test.js    node:test 测试
```

## 已知取舍与扩展点

- **圈子覆盖**：属性判定依赖词典 + 关键词 + 哈希，未做全量圈子抓取；扩充词典是
  提升分类质量的唯一手动手段（`TOPIC_TYPE_DICT`）。
- **数据时效**：`__NEXT_DATA__` 只含最近约 10 条动态，发帖频率与圈子聚合均为
  小窗口样本；算法已做下限保护（如时间跨度下限 0.5 天）避免极端值。
- **导出平台差异**：iOS WebKit 的 foreignObject 图片丢失已用 canvas 补绘兜底，
  但如需彻底消除快照差异，可考虑完全放弃 DOM 快照、改用声明式 canvas 绘制。
- **限流为内存态**：单实例有效；多副本部署时需外置（如边缘 KV）才能全局生效。
