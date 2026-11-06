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

// ---------- prix ----------
// Réglages par défaut de la baisse progressive et du plancher par carte (en %)
const DEFAULT_PRICING = { startPct: 15, stepPct: 8, floorPct: 70 };
const DAY = 86400e3;

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Prix de référence d'une carte : médiane de ses dernières ventes réelles (14 derniers jours, 10 max),
// sinon l'estimation du site.
function refPrice(market, now = Date.now()) {
  const recent = (market?.sales || [])
    .filter(s => s?.price > 0 && (!s.soldAt || now - Date.parse(s.soldAt) <= 14 * DAY))
    .slice(0, 10).map(s => s.price);
  if (recent.length >= 2) return { ref: median(recent), src: `médiane de ${recent.length} ventes` };
  const v = market?.estimate ?? market?.value ?? market?.last ?? null;
  return v ? { ref: v, src: "estimation du site" } : { ref: null, src: null };
}

// Plancher d'une carte : le plus haut entre le plancher de la rareté et floorPct % du prix de référence.
function cardFloor(market, rarity, floors, pricing = DEFAULT_PRICING, now = Date.now()) {
  const base = Number(floors?.[rarity]) || 0;
  const { ref, src } = refPrice(market, now);
  const pct = Number(pricing?.floorPct ?? DEFAULT_PRICING.floorPct);
  const own = ref && pct > 0 ? Math.ceil(ref * pct / 100) : 0;
  return { floor: Math.max(base, own), base, ref, refSrc: src, byCard: own > base };
}

// Vente la moins chère des AUTRES joueurs (le carnet « asks » du site contient aussi tes propres ventes).
function competitorAsk(market, myOrders = []) {
  const mineAt = {};
  for (const o of myOrders) if ((o.side || "sell") === "sell") mineAt[o.price] = (mineAt[o.price] || 0) + 1;
  if (Array.isArray(market?.asks)) {
    for (const a of [...market.asks].sort((x, y) => x.price - y.price))
      if ((a.orders || 0) - (mineAt[a.price] || 0) > 0) return a.price;
    return null;
  }
  return myOrders.length ? null : (market?.bestAsk ?? null);
}

// Prix de vente.
//  - départ : prix de référence + startPct %, puis − stepPct % par rotation sans vente (opts.age)
//  - jamais au-dessus de la vente la moins chère des autres − 1
//  - jamais sous le plancher de la carte, ni sous une offre d'achat, toujours dans les limites du site
function computePrice(market, rarity, floors, opts = {}) {
  const pricing = { ...DEFAULT_PRICING, ...(opts.pricing || {}) };
  const now = opts.now || Date.now(), age = Math.max(0, opts.age || 0);
  const cf = cardFloor(market, rarity, floors, pricing, now);
  if (!cf.base) return { price: null, reason: "pas de plancher pour cette rareté" };
  const floor = cf.floor;
  const comp = competitorAsk(market, opts.mine || []);
  const decayed = cf.ref ? Math.round(cf.ref * (1 + pricing.startPct / 100) * Math.pow(1 - pricing.stepPct / 100, age)) : null;

  let price, source;
  if (comp != null && (decayed == null || comp - 1 <= decayed)) { price = comp - 1; source = `moins chère ${comp} − 1`; }
  else if (decayed != null) { price = decayed; source = `réf. ${cf.ref} (${cf.refSrc}) +${pricing.startPct} %` + (age ? `, −${pricing.stepPct} % ×${age}` : ""); }
  else { price = floor; source = "plancher"; }
  if (price < floor) { price = floor; source += ` → plancher ${cf.byCard ? "de la carte" : "de la rareté"} ${floor}`; }
  if (market?.bestBid != null && market.bestBid > price) { price = market.bestBid; source = `offre d'achat ${market.bestBid}`; }
  const lim = market?.limits?.market;
  if (lim) {
    if (lim.min != null && price < lim.min) { price = lim.min; source += " → min du site"; }
    if (lim.max != null && price > lim.max) { price = lim.max; source += " → max du site"; }
  }
  if (price < floor) return { price: null, reason: `le max du site (${lim?.max}) est sous ton plancher (${floor})` };
  return { price, source, floor, ref: cf.ref };
}

export { RARITY_NAMES, SELL_RARITIES, DEFAULT_PRICING, sellableCopy, pickCandidates, refPrice, cardFloor, competitorAsk, computePrice };
