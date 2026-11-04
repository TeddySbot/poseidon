// Poseidon – Vente auto : règles de choix et de prix (sans réseau, testables)

const RARITY_NAMES = { N: "Commune", R: "Rare", SR: "Épique", SSR: "Légendaire", UR: "Mythique", SEC: "Secrète" };
const SELL_RARITIES = ["N", "R", "SR"];
// Communes et Rares d'abord, Épiques seulement s'il reste de la place
const RARITY_GROUP = { N: 0, R: 0, SR: 1 };

// Exemplaire à vendre pour une carte, ou null.
// - au moins 2 exemplaires possédés (on en garde toujours 1)
// - aucun exemplaire déjà en vente / aux enchères (une seule vente par carte)
// - jamais un exemplaire protégé ou lié
// - on vend le serial le plus haut
function sellableCopy(card) {
  const copies = card?.copies || [];
  if (copies.length < 2) return null;
  if (copies.some(c => c.locked)) return null;
  const free = copies.filter(c => !c.protected && !c.bound && !c.locked);
  if (!free.length) return null;
  return [...free].sort((a, b) => b.serial - a.serial)[0];
}

// Liste ordonnée des cartes à mettre en vente.
// opts.listedCardIds : cartes déjà en vente (fixe ou enchères)
// opts.skip : {cardId: timestamp jusqu'auquel ignorer la carte}
function pickCandidates(cards, opts = {}) {
  const listed = opts.listedCardIds || new Set();
  const skip = opts.skip || {};
  const now = opts.now || Date.now();
  const out = [];
  for (const card of Object.values(cards || {})) {
    if (!SELL_RARITIES.includes(card.rarity)) continue;
    if (opts.rarities && !opts.rarities[card.rarity]) continue;   // rareté décochée
    if (!(card.wants > 0)) continue;                // seulement les cartes recherchées
    if (listed.has(card.id)) continue;
    if (skip[card.id] && skip[card.id] > now) continue;
    const copy = sellableCopy(card);
    if (!copy) continue;
    out.push({ card, copy });
  }
  out.sort((a, b) =>
    RARITY_GROUP[a.card.rarity] - RARITY_GROUP[b.card.rarity] ||
    b.card.wants - a.card.wants ||
    (b.card.value || 0) - (a.card.value || 0));
  return out;
}

// Prix de vente : la vente la moins chère − 1, jamais sous le plancher,
// jamais sous une offre d'achat existante, toujours dans les limites du site.
function computePrice(market, rarity, floors) {
  const floor = Number(floors?.[rarity]);
  if (!floor) return { price: null, reason: "pas de plancher pour cette rareté" };
  let base = market?.bestAsk != null ? market.bestAsk - 1
    : (market?.estimate ?? market?.value ?? market?.last ?? null);
  let source = market?.bestAsk != null ? `moins chère ${market.bestAsk} − 1` : (base != null ? "estimation du site" : "plancher");
  if (base == null) base = floor;
  let price = Math.max(Math.floor(base), floor);
  if (price > Math.floor(base)) source += " → plancher";
  if (market?.bestBid != null && market.bestBid > price) { price = market.bestBid; source = `offre d'achat ${market.bestBid}`; }
  const lim = market?.limits?.market;
  if (lim) {
    if (lim.min != null && price < lim.min) { price = lim.min; source += " → min du site"; }
    if (lim.max != null && price > lim.max) { price = lim.max; source += " → max du site"; }
  }
  if (price < floor) return { price: null, reason: `le max du site (${lim?.max}) est sous ton plancher (${floor})` };
  return { price, source };
}

export { RARITY_NAMES, SELL_RARITIES, sellableCopy, pickCandidates, computePrice };
