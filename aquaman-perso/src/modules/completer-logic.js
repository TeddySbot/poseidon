// Compléter ma collection : calculs purs (sans réseau ni chrome.*), testables avec Node.
//
// Règles :
//  - De chaque carte, je garde TOUJOURS l'exemplaire au plus petit #serial : seuls les autres sont échangeables,
//    en commençant par les plus gros serials.
//  - Jamais d'exemplaire bloqué (locked), lié (bound) ou protégé (protected).
//  - Équilibre imposé par le site : max(a, b) <= 3 * min(a, b) + 30 ; 10 cartes au plus de chaque côté.
//  - Mon offre vise la valeur de ce que je demande, jusqu'à +20 % (sans jamais dépasser la règle du site).

export const RARITY_ORDER = ['N', 'R', 'SR', 'SSR', 'UR', 'SEC'];
export const RARITY_NAMES = { N: 'Commune', R: 'Rare', SR: 'Épique', SSR: 'Légendaire', UR: 'Mythique', SEC: 'Secrète' };
export const MAX_SIDE = 10;
export const DEFAULTS = { overpay: 0.2, underpay: 0.1, maxOver: 0.5, maxTakePerTrade: 4 };

export const isBalanced = (a, b) => Math.max(a, b) <= 3 * Math.min(a, b) + 30;
export const rank = (r) => RARITY_ORDER.indexOf(r);
const free = (c) => !c.locked && !c.bound && !c.protected;

// Regroupe des exemplaires par carte : { cardId: [copies triées par serial croissant] }
export function byCard(copies) {
  const m = new Map();
  for (const c of copies ?? []) {
    if (!c?.card?.id) continue;
    if (!m.has(c.card.id)) m.set(c.card.id, []);
    m.get(c.card.id).push(c);
  }
  for (const list of m.values()) list.sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity));
  return m;
}

// Mes doubles échangeables : tout sauf le plus petit serial de chaque carte, et seulement les exemplaires libres.
// `reserved` : copyIds déjà engagés dans un échange en cours (ou une proposition en attente).
export function tradeableDoubles(copies, reserved = new Set()) {
  const out = [];
  for (const list of byCard(copies).values()) {
    if (list.length < 2) continue;
    for (const c of list.slice(1)) if (free(c) && !reserved.has(c.copyId)) out.push(c);
  }
  // plus gros serial d'abord (à valeur égale)
  return out.sort((a, b) => (b.serial ?? 0) - (a.serial ?? 0));
}

// Ce qu'un autre joueur peut me céder sans perdre la carte : ses exemplaires libres d'une carte qu'il a en 2+.
// On lui laisse aussi son plus petit serial ; on demande son exemplaire au plus gros serial.
export function spareCopiesOf(copies, wantedCardIds) {
  const out = new Map(); // cardId -> copy
  for (const [cardId, list] of byCard(copies)) {
    if (!wantedCardIds.has(cardId) || list.length < 2) continue;
    const spare = list.slice(1).filter(free);
    if (spare.length) out.set(cardId, spare[spare.length - 1]);
  }
  return out;
}

// Choisit dans `pool` des exemplaires dont la valeur totale approche `target`.
// Préférence : cartes que le joueur recherche (prefer), puis cartes qu'il n'a pas (notOwned), puis le reste.
// Renvoie { give, sum, fit } ou null. fit = 'ok' (cible à +20 %), 'over' (jusqu'à +50 %) ou 'under' (jusqu'à −10 %).
export function buildOffer(target, pool, { maxCards = MAX_SIDE, overpay = DEFAULTS.overpay, underpay = DEFAULTS.underpay, maxOver = DEFAULTS.maxOver, prefer = new Set(), notOwned = null } = {}) {
  if (!(target > 0) || !pool?.length) return null;
  const hi = Math.max(Math.round(target * (1 + overpay)), target + 5);
  const lo = Math.round(target * (1 - underpay));
  const score = (c) => (prefer.has(c.card.id) ? 2 : 0) + (notOwned && !notOwned.has(c.card.id) ? 0 : notOwned ? 1 : 0);
  const top = Math.round(target * (1 + maxOver)); // au-delà, je perdrais trop : pas d'offre
  const cands = pool
    .filter((c) => c.value > 0 && c.value <= hi)
    .sort((a, b) => score(b) - score(a) || b.value - a.value);
  if (!cands.length) return null;

  let best = null;
  const consider = (give) => {
    const sum = give.reduce((s, c) => s + c.value, 0);
    if (!give.length || !isBalanced(sum, target)) return;
    const fit = sum >= target && sum <= hi ? 'ok' : sum > hi && sum <= top ? 'over' : sum < target && sum >= lo ? 'under' : null;
    if (!fit) return;
    const pref = give.reduce((s, c) => s + score(c), 0);
    // classement : dans la cible > un peu en dessous > au-dessus ; puis le plus proche ; puis préférences ; puis moins de cartes
    const order = { ok: 0, under: 1, over: 2 }[fit];
    const key = [order, Math.abs(sum - target), -pref, give.length];
    if (!best || cmp(key, best.key) < 0) best = { give, sum, fit, key };
  };
  // plusieurs départs gloutons : chaque candidat comme première carte, puis on complète par valeurs décroissantes
  const starts = cands.slice(0, 60);
  for (const first of starts) {
    const give = [first];
    let sum = first.value;
    for (const c of cands) {
      if (give.length >= maxCards || sum >= target) break;
      if (c === first || sum + c.value > hi) continue;
      give.push(c);
      sum += c.value;
    }
    consider(give);
  }
  // au cas où rien ne tombe dans la cible : la plus petite carte seule au-dessus de la cible (si équilibrée)
  const above = pool.filter((c) => c.value >= target).sort((a, b) => a.value - b.value)[0];
  if (above) consider([above]);
  return best && { give: best.give, sum: best.sum, fit: best.fit };
}
const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// Construit les propositions pour un joueur : il me cède ce qu'il a en double et qui me manque,
// je donne mes doubles. Plusieurs cartes demandées au même joueur = un seul échange (si l'offre suit).
// takeCopies : [copy] (ses exemplaires que je veux), pool : mes doubles libres (modifié : les cartes utilisées sont retirées).
export function proposalsForPlayer(player, takeCopies, pool, { prefer, notOwned, maxTake = DEFAULTS.maxTakePerTrade, ...opts } = {}) {
  const out = [];
  // les plus chères d'abord, pour que les grosses cartes aient la priorité sur mes doubles
  const queue = [...takeCopies].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  while (queue.length) {
    let take = queue.slice(0, maxTake);
    let offer = null;
    while (take.length) {
      offer = buildOffer(take.reduce((s, c) => s + c.value, 0), pool, { prefer, notOwned, ...opts });
      if (offer) break;
      take = take.slice(0, -1); // trop cher en un bloc : on retire la moins chère (elle reste dans la file)
    }
    if (!offer) {
      queue.shift(); // même seule, la plus chère est hors de portée de mes doubles
      continue;
    }
    for (const c of take) queue.splice(queue.indexOf(c), 1);
    const used = new Set(offer.give.map((c) => c.copyId));
    for (let i = pool.length - 1; i >= 0; i--) if (used.has(pool[i].copyId)) pool.splice(i, 1);
    out.push({ player, take, give: offer.give, takeValue: take.reduce((s, c) => s + c.value, 0), giveValue: offer.sum, fit: offer.fit });
  }
  return out;
}

// Petites aides d'affichage, partagées avec la page.
export const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('fr-FR'));
export const cardImageUrl = (image) =>
  !image ? '' : image.startsWith('content/') ? `https://poseidon-scans.net/api-game/v1/content/${image.slice(8)}` : `https://poseidon-scans.net/api-media/file/${image.replace(/^media-library\//, '')}`;
