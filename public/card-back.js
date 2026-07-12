// 通用卡牌背面：不带个人资料，以 POKEJY 字母与纹理装饰为主视觉
export function cardBackMarkup() {
  return `
    <div class="card-back__inner">
      <div class="card-back__topline"><span>POKÉJI</span><span>COLLECTION CARD</span></div>

      <div class="card-back__field" aria-hidden="true">
        <div class="card-back__rings">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="card-back__grid"></div>
        <div class="card-back__corners">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="card-back__mark">
        <span class="card-back__mark-letter">P</span>
        <span class="card-back__mark-letter">O</span>
        <span class="card-back__mark-letter">K</span>
        <span class="card-back__mark-letter">E</span>
        <span class="card-back__mark-letter">J</span>
        <span class="card-back__mark-letter">Y</span>
      </div>

      <p class="card-back__submark">宝可即档案库 · SOCIAL CARD ARCHIVE</p>

      <div class="card-back__seal" aria-hidden="true">
        <span class="card-back__seal-core">即</span>
      </div>

      <div class="card-back__foot"><span>WEB.POKEJI.COM</span><span>2026</span></div>
    </div>
    <div class="card-back__foil" aria-hidden="true"></div>
  `;
}
