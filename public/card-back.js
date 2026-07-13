// 通用卡牌背面：不带个人资料。中央宝可球式徽章（「即」字核心）+ 同心环呼应正面波纹，
// 四周细织纹与角饰，上下 POKÉJI 字标，构成经典 TCG 卡背式的对称构图。
export function cardBackMarkup() {
  return `
    <div class="card-back__inner">
      <div class="card-back__field" aria-hidden="true">
        <div class="card-back__hatch"></div>
        <div class="card-back__corners">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="card-back__topline"><span>POKÉJI</span><span>COLLECTION CARD</span></div>

      <div class="card-back__center" aria-hidden="true">
        <div class="card-back__rings">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="card-back__emblem">
          <span class="card-back__emblem-band"></span>
          <span class="card-back__emblem-core">即</span>
          <span class="card-back__emblem-gloss"></span>
        </div>
      </div>

      <p class="card-back__wordmark">POKÉJI</p>
      <p class="card-back__submark">宝可即档案库 · SOCIAL CARD ARCHIVE</p>

      <div class="card-back__foot"><span>WEB.POKEJI.COM</span><span>2026</span></div>
    </div>
    <div class="card-back__foil" aria-hidden="true"></div>
  `;
}
