// Poseidon – Vente auto : service worker
//
// Ce que fait l'extension :
//  1. Inventaire (tous les jours, lentement) : trouve tes Communes / Rares / Épiques
//     en 2 exemplaires ou plus, avec leurs serials et le nombre de joueurs qui les recherchent.
//  2. Toutes les 2 min : regarde tes ventes. Si une carte est vendue, met le double suivant.
//  3. Toutes les heures : retire TOUTES tes ventes à prix fixe et remet en vente.
//  Limites : 50 emplacements, 25 actions (ventes + retraits) par tranche de 35 s.
//  Mode simulation : ne vend et ne retire rien, affiche seulement ce qu'il ferait.

importScripts("logic.js");

const SITE = "https://poseidon-scans.net";
const API = SITE + "/api-game/v1";
const ALARM = "vente-keepalive";

const DEFAULT_SETTINGS = {
  enabled: false,
  dryRun: true,
  maxSlots: 50,
  floors: { N: 6, R: 13, SR: 51 },   // Commune > 5, Rare > 12, Épique > 50
  rarities: { N: true, R: true, SR: true },  // raretés autorisées à la vente
  rotateMin: 60,
  checkMin: 2,
  scanHours: 24,
  writeMax: 25,
  writeWindowSec: 35,
  getDelayMs: 1500,                  // pause entre deux lectures pendant un cycle
  scanDelayMs: 3000,                 // pause entre deux lectures pendant l'inventaire
  countAuctions: true                // les enchères en cours comptent dans les 50 emplacements
};

// ---------- état ----------
let S = null;          // {settings, inv, run, log, status}
let dirty = false, lastSave = 0;

async function load() {
  if (S) return S;
  const d = await chrome.storage.local.get({ settings: {}, inv: null, run: null, log: [], status: {}, stats: null, sales: [] });
  S = {
    settings: { ...DEFAULT_SETTINGS, ...d.settings, floors: { ...DEFAULT_SETTINGS.floors, ...(d.settings.floors || {}) },
      rarities: { ...DEFAULT_SETTINGS.rarities, ...(d.settings.rarities || {}) } },
    inv: d.inv || { cards: {}, scan: null, scannedAt: 0 },
    run: d.run || {},
    log: d.log || [],
    status: d.status || {},
    stats: d.stats || { baseline: null, counts: null, perles: null },   // photo de départ, comptage actuel, solde
    sales: d.sales || []                                                   // ventes faites par le script uniquement
  };
  S.run = { lastRotate: 0, lastCheck: 0, lastRefresh: 0, tracked: {}, skip: {}, plan: null, writes: [], botCopies: {}, ...S.run };
  S.run.botCopies = S.run.botCopies || {};
  if (S.run.ver !== 2) { S.run.skip = {}; S.run.ver = 2; }   // efface les blocages des essais refusés de la v1.0
  return S;
}

async function save(force = false) {
  if (!S) return;
  const now = Date.now();
  const base = { run: S.run, log: S.log, status: S.status, stats: S.stats, sales: S.sales };
  if (force || now - lastSave > 15_000) { base.inv = S.inv; lastSave = now; }
  await chrome.storage.local.set(base);
  dirty = false;
}

function log(kind, text) {
  S.log.unshift({ t: Date.now(), kind, text });
  if (S.log.length > 300) S.log.length = 300;
  dirty = true;
}
const sim = () => S.settings.dryRun;

// ---------- statistiques ----------
const COMMISSION = 0.05;   // commission du marché (affichée par le site)
const netOf = price => Math.round(price * (1 - COMMISSION) * 100) / 100;

function recordSale(info, price) {
  S.sales.unshift({ t: Date.now(), cardId: info.cardId, name: info.name, rarity: info.rarity, serial: info.serial, price, net: netOf(price) });
  if (S.sales.length > 20000) S.sales.length = 20000;
}
function setPerles(v) {
  if (v == null) return;
  S.stats.perles = { at: Date.now(), value: v };
  if (S.stats.baseline && S.stats.baseline.perles == null) S.stats.baseline.perles = v;
}
function emptyCounts() { const o = {}; for (const r of ["N", "R", "SR", "SSR", "UR", "SEC"]) o[r] = { cartes: 0, exemplaires: 0, double: 0, enTrop: 0 }; return o; }
function addCount(counts, c) {
  const a = counts[c.rarity] || (counts[c.rarity] = { cartes: 0, exemplaires: 0, double: 0, enTrop: 0 });
  const n = c.owned || 0; if (!n) return;
  a.cartes++; a.exemplaires += n; if (n >= 2) { a.double++; a.enTrop += n - 1; }
}
function saveCounts(counts) {
  S.stats.counts = { at: Date.now(), byRarity: counts };
  if (!S.stats.baseline || S.stats.baseline.pending) {
    S.stats.baseline = { at: Date.now(), byRarity: counts, perles: S.stats.perles?.value ?? null };
    log("info", "Photo de départ des statistiques enregistrée.");
  }
}

// Comptage rapide de toute la collection (série par série, une lecture toutes les 0,6 s)
async function countAll() {
  S.status.counting = { done: 0, total: 0 };
  try { setPerles((await api("/me", { delay: 600 })).perles); } catch (e) { if (e.code === "stopped") throw e; }
  const series = ((await api("/series", { delay: 600 })).series || []).filter(x => x.owned > 0);
  S.status.counting.total = series.length;
  const counts = emptyCounts();
  for (const se of series) {
    const list = (await api(`/cards?owned=1&manga=${encodeURIComponent(se.id)}`, { delay: 600 })).cards || [];
    for (const c of list) addCount(counts, c);
    S.status.counting.done++;
    if (S.status.counting.done % 20 === 0) await save();
  }
  saveCounts(counts);
  S.status.counting = null;
  log("info", "Comptage de la collection terminé.");
}
const rn = r => RARITY_NAMES[r] || r;

// ---------- attente qui garde le service worker éveillé ----------
// ---------- arrêt immédiat ----------
let stopFlag = false;
const MAX_ERR_STREAK = 5;
async function stopAll(reason) {
  stopFlag = true;
  S.settings.enabled = false;
  S.run.pendingWithdraw = false;
  S.status.phase = "Arrêtée";
  log("info", reason);
  await chrome.storage.local.set({ settings: S.settings });
  await save();
}
// compte les erreurs de suite ; arrêt automatique au bout de 5
async function countError() {
  S.run.errStreak = (S.run.errStreak || 0) + 1;
  if (S.run.errStreak >= MAX_ERR_STREAK && S.settings.enabled) {
    await stopAll(`Arrêt automatique : ${MAX_ERR_STREAK} erreurs de suite. Corrige le problème puis réactive.`);
    throw new ApiError(0, "stopped", "Arrêtée");
  }
}

async function waitUntil(t) {
  for (;;) {
    if (stopFlag) throw new ApiError(0, "stopped", "Arrêtée");
    const left = t - Date.now();
    if (left <= 0) return;
    await new Promise(r => setTimeout(r, Math.min(left, 8000)));
    await chrome.runtime.getPlatformInfo();   // appel d'API Chrome = pas d'endormissement
  }
}

// ---------- réseau ----------
class ApiError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }
let lastReq = 0, backoffUntil = 0, backoffSec = 0;

async function rawFetch(path, method, body) {
  const r = await fetch(API + path, {
    method, credentials: "include", cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
}

// Ventes et retraits : le site refuse ceux qui viennent directement de l'extension
// ("Origine de la requête refusée"). On les envoie donc depuis un onglet poseidon-scans.net,
// exactement comme le fait la page du marché. S'il n'y en a pas, on en ouvre un en arrière-plan.
let siteTabId = null;

async function getSiteTab() {
  if (siteTabId != null) {
    const t = await chrome.tabs.get(siteTabId).catch(() => null);
    if (t && (t.url || t.pendingUrl || "").startsWith(SITE)) return waitLoaded(t.id);
    siteTabId = null;
  }
  const tabs = await chrome.tabs.query({ url: SITE + "/*" });
  let t = tabs.find(x => x.status === "complete" && !x.discarded) || tabs[0];
  if (!t) {
    t = await chrome.tabs.create({ url: SITE + "/jeu/marche", active: false, pinned: true });
    log("info", "Onglet poseidon-scans.net ouvert en arrière-plan (épinglé) pour envoyer les ventes. Laisse-le ouvert.");
  }
  siteTabId = t.id;
  return waitLoaded(t.id);
}

async function waitLoaded(id) {
  for (let i = 0; i < 30; i++) {   // max 30 s
    const cur = await chrome.tabs.get(id).catch(() => null);
    if (!cur) { siteTabId = null; throw new ApiError(0, "no_tab", "L'onglet poseidon-scans.net a été fermé."); }
    if (cur.discarded) await chrome.tabs.reload(id);
    else if (cur.status === "complete") return cur;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new ApiError(0, "no_tab", "L'onglet poseidon-scans.net ne finit pas de charger.");
}

async function tabFetch(path, method, body) {
  const run = async () => {
    const tab = await getSiteTab();
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN",
      args: [API + path, method, body === undefined ? null : JSON.stringify(body)],
      func: async (url, m, b) => {
        const r = await fetch(url, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : undefined, body: b || undefined });
        return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
      }
    });
    if (!res?.result) throw new Error("pas de réponse de l'onglet");
    return res.result;
  };
  try { return await run(); }
  catch (e) {
    // onglet endormi ou en cours de navigation : on le recharge et on réessaie une fois
    if (siteTabId != null) { await chrome.tabs.reload(siteTabId).catch(() => {}); await new Promise(r => setTimeout(r, 3000)); }
    try { return await run(); }
    catch (e2) { throw new ApiError(0, "no_tab", "Impossible d'utiliser l'onglet poseidon-scans.net : " + (e2.message || e2)); }
  }
}

async function api(path, { method = "GET", body, delay } = {}) {
  if (stopFlag) throw new ApiError(0, "stopped", "Arrêtée");
  await waitUntil(Math.max(lastReq + (delay ?? S.settings.getDelayMs), backoffUntil));
  lastReq = Date.now();
  let r;
  try {
    r = method === "GET" ? await rawFetch(path, method, body) : await tabFetch(path, method, body);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "network", "Connexion impossible : " + (e.message || e));
  }
  if (r.status === 429 || r.status >= 500) {
    backoffSec = Math.min(300, backoffSec ? backoffSec * 2 : 20);
    backoffUntil = Date.now() + backoffSec * 1000;
    throw new ApiError(r.status, "slow_down", `Le site freine (${r.status}) : pause de ${backoffSec} s`);
  }
  backoffSec = 0;
  if (r.status === 401) throw new ApiError(401, "auth", "Non connecté : connecte-toi sur poseidon-scans.net dans Chrome.");
  if (!r.ok) {
    const msg = r.json?.error?.message || `Erreur ${r.status}`;
    // refus global (origine, session) : on arrête le cycle au lieu de bloquer chaque carte
    if (/origin/i.test(msg + " " + (r.json?.error?.code || ""))) throw new ApiError(r.status, "origin", msg);
    throw new ApiError(r.status, r.json?.error?.code || "error", msg);
  }
  return r.json;
}

// Une action d'écriture (vente / retrait) : 25 maximum par tranche de 35 s
async function writeSlot() {
  const W = S.settings.writeWindowSec * 1000;
  for (;;) {
    const now = Date.now();
    S.run.writes = (S.run.writes || []).filter(t => now - t < W);
    if (S.run.writes.length < S.settings.writeMax) { S.run.writes.push(now); return; }
    S.status.phase = "Pause (limite 30 actions / 30 s)";
    await save();
    await waitUntil(S.run.writes[0] + W + 300);
  }
}

// ---------- inventaire ----------
const mapCopy = c => ({ id: c.copyId || c.id, serial: c.serial, protected: !!c.protected, locked: !!c.locked, bound: !!c.bound });

function startScan() {
  S.inv.scan = { phase: "copies", startedAt: Date.now(), seriesQueue: [], detailQueue: [], covered: [], seriesTotal: 0, detailTotal: 0 };
  log("info", "Inventaire de la collection lancé.");
}

// Avance l'inventaire pendant ~budgetMs, puis rend la main.
async function scanStep(budgetMs = 20_000) {
  const sc = S.inv.scan, end = Date.now() + budgetMs, cards = S.inv.cards, d = S.settings.scanDelayMs;

  if (sc.phase === "copies") {
    // /copies : les 2000 premiers exemplaires (triés de la plus rare à la plus commune)
    const copies = (await api("/copies", { delay: d })).copies || [];
    const groups = new Map();
    for (const c of copies) { if (!groups.has(c.card.id)) groups.set(c.card.id, []); groups.get(c.card.id).push(c); }
    const lastId = copies.length >= 2000 ? copies[copies.length - 1].card.id : null;  // carte coupée en fin de liste
    for (const [id, list] of groups) {
      const c0 = list[0];
      if (!SELL_RARITIES.includes(c0.card.rarity) || id === lastId) continue;
      cards[id] = { id, name: c0.card.name, rarity: c0.card.rarity, series: c0.card.series?.title,
        wants: c0.wants || 0, value: c0.value || 0, copies: list.map(mapCopy), checkedAt: Date.now(), seenAt: sc.startedAt };
      sc.covered.push(id);
    }
    sc.phase = "series";
  }

  if (sc.phase === "series") {
    const series = (await api("/series", { delay: d })).series || [];
    sc.seriesQueue = series.filter(s => s.owned > 0).map(s => s.id);
    sc.seriesTotal = sc.seriesQueue.length;
    sc.counts = emptyCounts();
    sc.phase = "cards";
  }

  const covered = new Set(sc.covered);
  while (sc.phase === "cards" && Date.now() < end) {
    const sid = sc.seriesQueue[0];
    if (!sid) { sc.phase = "detail"; sc.detailTotal = sc.detailQueue.length; if (sc.counts) saveCounts(sc.counts); break; }
    const list = (await api(`/cards?owned=1&manga=${encodeURIComponent(sid)}`, { delay: d })).cards || [];
    for (const c of list) {
      if (sc.counts) addCount(sc.counts, c);
      if (!SELL_RARITIES.includes(c.rarity) || (c.owned || 0) < 2 || covered.has(c.id)) continue;
      sc.detailQueue.push(c.id);
      cards[c.id] = { ...(cards[c.id] || { copies: [], wants: 0 }), id: c.id, name: c.name, rarity: c.rarity, series: c.series?.title };
    }
    sc.seriesQueue.shift();
  }

  while (sc.phase === "detail" && Date.now() < end) {
    const id = sc.detailQueue[0];
    if (!id) { sc.phase = "done"; break; }
    await refreshCard(id, d);
    if (cards[id]) cards[id].seenAt = sc.startedAt;
    sc.detailQueue.shift();
  }

  if (sc.phase === "done") {
    for (const [id, c] of Object.entries(cards)) if ((c.seenAt || 0) < sc.startedAt) delete cards[id];  // plus possédée en double
    S.inv.scannedAt = Date.now();
    S.inv.scan = null;
    const n = Object.values(cards).filter(c => c.copies.length >= 2).length;
    const w = Object.values(cards).filter(c => c.copies.length >= 2 && c.wants > 0).length;
    log("info", `Inventaire terminé : ${n} cartes en double, dont ${w} recherchées.`);
    await save(true);
  }
}

// Relit une carte (exemplaires + nombre de joueurs qui la recherchent)
async function refreshCard(id, delay) {
  try {
    const j = await api(`/cards/${id}`, { delay });
    const prev = S.inv.cards[id] || {};
    S.inv.cards[id] = { ...prev, id, name: j.name, rarity: j.rarity, series: j.series?.title,
      wants: j.wants || 0, copies: (j.copies || []).map(mapCopy), checkedAt: Date.now() };
  } catch (e) {
    if (e.status === 404) delete S.inv.cards[id]; else throw e;
  }
}

// ---------- ventes en cours ----------
async function refreshOpen() {
  const mine = (await api("/market/listings?mine=1")).listings || [];
  let auctions = [];
  if (S.settings.countAuctions) auctions = ((await api("/auctions?mine=selling&sort=new")).auctions || []).filter(a => a.status === "open");

  // ventes disparues depuis la dernière fois : vendues ou retirées ?
  const openIds = new Set(mine.map(l => l.id));
  const gone = Object.keys(S.run.tracked).filter(id => !openIds.has(id));
  if (gone.length) {
    const orders = (await api("/market/orders")).orders || [];
    for (const id of gone) {
      const t = S.run.tracked[id], o = orders.find(x => x.id === id), card = S.inv.cards[t.cardId];
      const byBot = !!S.run.botCopies[t.copyId];
      delete S.run.botCopies[t.copyId];
      if (o?.status === "filled") {
        log("sold", `Vendue : ${t.name} (${rn(t.rarity)} #${t.serial}) à ${o.price} Perles${byBot ? "" : " (vente manuelle)"}`);
        if (byBot) recordSale(t, o.price);
        if (card) card.copies = card.copies.filter(c => c.id !== t.copyId);
      } else if (card) {
        const c = card.copies.find(c => c.id === t.copyId); if (c) c.locked = false;
      }
      delete S.run.tracked[id];
    }
  }
  for (const l of mine) {
    if (!S.run.tracked[l.id]) S.run.tracked[l.id] = { cardId: l.card.id, copyId: l.copyId, name: l.card.name, rarity: l.card.rarity, serial: l.serial, price: l.price };
    const c = S.inv.cards[l.card.id]?.copies.find(c => c.id === l.copyId); if (c) c.locked = true;
  }
  const listedCardIds = new Set([...mine.map(l => l.card.id), ...auctions.map(a => a.card?.id)]);
  S.status.open = mine.length; S.status.auctions = auctions.length;
  return { mine, auctions, listedCardIds, used: mine.length + auctions.length };
}

// ---------- mise en vente ----------
async function fill(free, listedCardIds, plan) {
  if (free <= 0) return 0;
  const cands = pickCandidates(S.inv.cards, { listedCardIds, skip: S.run.skip, rarities: S.settings.rarities });
  let placed = 0, looked = 0;
  for (const { card, copy } of cands) {
    if (placed >= free || looked >= free * 3 + 10) break;   // évite de lire des centaines de prix
    looked++;
    S.status.phase = `Prix de ${card.name}…`;
    const m = await api(`/market/cards/${card.id}`);
    card.wants = m.wants || 0; card.value = m.value ?? card.value; card.checkedAt = Date.now();
    if (!card.wants) continue;                                   // plus recherchée
    if ((m.mine || []).length) { listedCardIds.add(card.id); continue; }  // déjà en vente
    const p = computePrice(m, card.rarity, S.settings.floors);
    if (!p.price) { S.run.skip[card.id] = Date.now() + 3600_000; log("skip", `${card.name} ignorée : ${p.reason}`); continue; }

    const line = { cardId: card.id, name: card.name, rarity: card.rarity, serial: copy.serial, price: p.price, source: p.source, wants: card.wants };
    if (sim()) { plan.list.push(line); placed++; listedCardIds.add(card.id); continue; }

    await writeSlot();
    try {
      const res = await api("/market/orders", { method: "POST", body: { cardId: card.id, side: "sell", price: p.price, copyId: copy.id } });
      listedCardIds.add(card.id); placed++;
      if (res?.filled) {
        log("sold", `Vendue tout de suite : ${card.name} #${copy.serial} à ${res.filled.price ?? p.price} Perles`);
        recordSale({ cardId: card.id, name: card.name, rarity: card.rarity, serial: copy.serial }, res.filled.price ?? p.price);
        card.copies = card.copies.filter(c => c.id !== copy.id);
      } else {
        copy.locked = true;
        S.run.botCopies[copy.id] = { at: Date.now(), price: p.price, cardId: card.id };
        log("list", `En vente : ${card.name} (${rn(card.rarity)} #${copy.serial}) à ${p.price} Perles — ${p.source}`);
      }
      setPerles(res?.perles);
      S.run.errStreak = 0;
    } catch (e) {
      if (["slow_down", "auth", "no_tab", "origin", "stopped"].includes(e.code)) throw e;
      S.run.skip[card.id] = Date.now() + 3600_000;
      log("error", `Vente refusée pour ${card.name} : ${e.message}`);
      await countError();
      if (/limit|max|trop|slot|emplacement/i.test(e.code + " " + e.message)) break;  // plus de place côté site
    }
    await save();
  }
  return placed;
}

// ---------- retrait ----------
async function withdrawAll(mine, plan) {
  let n = 0;
  for (const l of mine) {
    if (sim()) { plan.removed.push({ name: l.card.name, rarity: l.card.rarity, serial: l.serial, price: l.price }); continue; }
    await writeSlot();
    S.status.phase = `Retrait ${n + 1}/${mine.length}…`;
    try {
      await api(`/market/orders/${l.id}`, { method: "DELETE" });
      n++; S.run.errStreak = 0; delete S.run.botCopies[l.copyId];
      const c = S.inv.cards[l.card.id]?.copies.find(c => c.id === l.copyId); if (c) c.locked = false;
      delete S.run.tracked[l.id];
    } catch (e) {
      if (["slow_down", "auth", "no_tab", "origin", "stopped"].includes(e.code)) throw e;
      log("error", `Retrait impossible pour ${l.card.name} : ${e.message}`);
      await countError();
    }
  }
  if (!sim() && n) log("info", `${n} ventes retirées.`);
  return n;
}

// ---------- cycles ----------
async function rotate() {
  S.status.phase = "Rotation : lecture des ventes…";
  try { setPerles((await api("/me")).perles); } catch (e) { if (e.code === "stopped") throw e; }
  const plan = { at: Date.now(), kind: "rotation", removed: [], list: [] };
  const { mine, auctions, listedCardIds } = await refreshOpen();
  await withdrawAll(mine, plan);
  for (const l of mine) listedCardIds.delete(l.card.id);
  const placed = await fill(S.settings.maxSlots - auctions.length, listedCardIds, plan);
  S.run.lastRotate = Date.now(); S.run.lastCheck = Date.now();
  if (sim()) { S.run.plan = plan; log("sim", `[Simulation] Retirerait ${plan.removed.length} ventes et en mettrait ${plan.list.length}.`); }
  else log("info", `Rotation terminée : ${placed} cartes mises en vente.`);
  if (!placed) S.status.idle = "Aucun double recherché à vendre pour l'instant : j'attends.";
  else S.status.idle = null;
}

async function check() {
  S.status.phase = "Vérification des ventes…";
  const plan = { at: Date.now(), kind: "remplissage", removed: [], list: [] };
  const { listedCardIds, used } = await refreshOpen();
  const free = S.settings.maxSlots - used;
  const placed = await fill(free, listedCardIds, plan);
  S.run.lastCheck = Date.now();
  if (sim() && plan.list.length) {
    const key = plan.list.map(l => l.cardId + ":" + l.price).join(",");
    if (key !== S.run.lastSimKey) log("sim", `[Simulation] Mettrait ${plan.list.length} cartes dans les ${free} emplacements libres.`);
    S.run.lastSimKey = key; S.run.plan = plan;
  }
  S.status.free = free - placed;
  S.status.idle = free > 0 && !placed ? "Aucun double recherché à vendre pour l'instant : j'attends." : null;
}

// En attente : relit doucement les doubles non recherchés pour voir s'ils le deviennent
async function refreshWants() {
  const stale = Object.values(S.inv.cards)
    .filter(c => SELL_RARITIES.includes(c.rarity) && !(c.wants > 0) && sellableCopy(c) && Date.now() - (c.checkedAt || 0) > 30 * 60_000)
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0))[0];
  if (!stale) return;
  await refreshCard(stale.id, S.settings.scanDelayMs);
  if (S.inv.cards[stale.id]?.wants > 0) { log("info", `${stale.name} est maintenant recherchée.`); S.run.lastCheck = 0; }
}

// ---------- boucle ----------
let busy = false, timer = null, wake = false;

async function tick() {
  timer = null;
  if (busy) return;
  busy = true;
  let next = 15;
  try {
    await load();
    const st = S.settings, now = Date.now();
    if (S.run.pendingWithdraw) {
      S.run.pendingWithdraw = false;
      stopFlag = false;
      const plan = { at: now, kind: "retrait", removed: [], list: [] };
      const { mine } = await refreshOpen();
      await withdrawAll(mine, plan);
      if (sim()) { S.run.plan = plan; log("sim", `[Simulation] Retirerait ${plan.removed.length} ventes.`); }
      return;
    }
    if (S.run.pendingCount) {
      S.run.pendingCount = false;
      stopFlag = false;
      S.status.phase = "Comptage de la collection…";
      await countAll();
      return;
    }
    if (!st.enabled) { S.status.phase = "Arrêtée"; return; }
    stopFlag = false;
    S.status.error = null;
    const scanned = (S.inv.scannedAt || 0) > 0;   // pas de rotation (retrait) avant le premier inventaire complet
    if (!S.inv.scan && !scanned) startScan();
    if (scanned && now - S.run.lastRotate >= st.rotateMin * 60_000) await rotate();
    else if (now - S.run.lastCheck >= st.checkMin * 60_000) await check();
    else if (!S.inv.scan && now - (S.inv.scannedAt || 0) >= st.scanHours * 3600_000) startScan();
    else if (S.inv.scan) { S.status.phase = "Inventaire de la collection…"; await scanStep(); next = 2; }
    else if (S.status.idle && now - (S.run.lastRefresh || 0) > 30_000) { S.run.lastRefresh = now; S.status.phase = "En attente de cartes recherchées"; await refreshWants(); }
    else S.status.phase = S.status.idle ? "En attente de cartes recherchées" : "En veille";
  } catch (e) {
    if (e.code === "stopped") { S.status.phase = "Arrêtée"; return; }
    S.status.error = e.message || String(e);
    try { await countError(); } catch { S.status.phase = "Arrêtée"; }
    if (e.code === "auth") notify("Poseidon Vente : connexion nécessaire", "Connecte-toi sur poseidon-scans.net dans Chrome.");
    log("error", S.status.error);
    next = 30;
  } finally {
    if (S) {
      const sc = S.inv.scan;
      S.status.scan = sc ? { phase: sc.phase, series: sc.seriesTotal - sc.seriesQueue.length, seriesTotal: sc.seriesTotal, detail: sc.detailTotal - sc.detailQueue.length, detailTotal: sc.detailTotal } : null;
      S.status.scannedAt = S.inv.scannedAt;
      const all = Object.values(S.inv.cards);
      S.status.cards = all.filter(c => (c.copies || []).length >= 2).length;                       // vrais doubles
      S.status.wanted = all.filter(c => c.wants > 0 && (c.copies || []).length >= 2).length;     // dont recherchés
      S.status.nextRotate = S.run.lastRotate + S.settings.rotateMin * 60_000;
      S.status.lastTick = Date.now();
      S.status.mode = S.settings.dryRun ? "simulation" : "réel";
      await save();
      chrome.action.setBadgeText({ text: !S.settings.enabled ? "" : S.status.error ? "!" : S.settings.dryRun ? "SIM" : String(S.status.open ?? "") });
      chrome.action.setBadgeBackgroundColor({ color: S.status.error ? "#dc2626" : S.settings.dryRun ? "#a16207" : "#16a34a" });
    }
    busy = false;
    if (wake) { wake = false; next = 0.3; }
    timer = setTimeout(tick, next * 1000);
  }
}

function ensureLoop(now = false) {
  if (busy) { if (now) wake = true; return; }
  if (now && timer) { clearTimeout(timer); timer = null; }
  if (!timer) tick();
}

function notify(title, message) {
  chrome.notifications.create("vente-auth", { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 1 });
}

function setup() { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); ensureLoop(); }
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) ensureLoop(); });

// Réglages modifiés depuis la fenêtre
chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area !== "local" || !ch.settings || !S) return;
  const nv = ch.settings.newValue || {};
  const before = S.settings, after = { ...DEFAULT_SETTINGS, ...nv,
    floors: { ...DEFAULT_SETTINGS.floors, ...(nv.floors || {}) }, rarities: { ...DEFAULT_SETTINGS.rarities, ...(nv.rarities || {}) } };
  S.settings = after;
  if (JSON.stringify(before.rarities) !== JSON.stringify(after.rarities)) {
    S.run.lastCheck = 0;   // rareté (dé)cochée : on remplit tout de suite les places libres
    log("info", "Raretés vendues : " + (["N", "R", "SR"].filter(r => after.rarities[r]).map(rn).join(", ") || "aucune"));
  }
  if ((after.enabled && !before.enabled) || (after.dryRun !== before.dryRun)) {
    S.run.lastRotate = 0;   // démarrage ou changement de mode : cycle complet tout de suite
    S.run.skip = {};
    log("info", `${after.enabled ? "Démarrée" : "Arrêtée"} en mode ${after.dryRun ? "simulation" : "RÉEL"}.`);
  }
  if (!after.enabled && before.enabled) { stopFlag = true; if (!S.run.pendingWithdraw) log("info", "Arrêtée."); }
  if (after.enabled && !before.enabled) { stopFlag = false; S.run.errStreak = 0; S.status.error = null; }
  ensureLoop(true);
});

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    await load();
    if (msg.type === "stopAll") { await stopAll("Arrêt demandé : tout est stoppé (les ventes en cours restent en place)."); }
    if (msg.type === "count") { S.run.pendingCount = true; await save(); ensureLoop(true); }
    if (msg.type === "resetBaseline") {
      S.stats.baseline = { pending: true, at: Date.now() };
      S.run.pendingCount = true;     // la photo de départ = le prochain comptage
      log("info", "Statistiques remises à zéro : nouveau comptage de départ en cours.");
      await save(); ensureLoop(true);
    }
    if (msg.type === "rotateNow") { S.run.lastRotate = 0; ensureLoop(true); }
    if (msg.type === "rescan") { startScan(); await save(true); ensureLoop(true); }
    if (msg.type === "clearLog") { S.log = []; await save(); }
    if (msg.type === "withdrawAll") {
      // arrête l'automatisation puis retire toutes les ventes à prix fixe
      stopFlag = true;
      S.run.pendingWithdraw = true;
      S.settings.enabled = false;
      await chrome.storage.local.set({ settings: S.settings });
      ensureLoop(true);
    }
    reply(true);
  })();
  return true;
});

ensureLoop();
