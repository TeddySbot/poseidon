// Vente auto (ex-extension « Poseidon – Vente auto » v1.5.1, intégrée à Aquaman perso)
//
// Ce que fait l'extension :
//  1. Inventaire (tous les jours, lentement) : trouve tes Communes / Rares / Épiques
//     en 2 exemplaires ou plus, avec leurs serials et le nombre de joueurs qui les recherchent.
//  2. Toutes les 2 min : regarde tes ventes. Si une carte est vendue, met le double suivant.
//  3. À chaque rotation (toutes les heures par défaut) : relit le prix de chacune de SES ventes et ne
//     remet en vente que celles qui doivent baisser (doublée par un autre joueur, ou baisse progressive).
//     Tes ventes manuelles ne sont jamais touchées.
//  Limites : 50 emplacements, 25 actions (ventes + retraits) par tranche de 35 s.
//  Mode simulation : ne vend et ne retire rien, affiche seulement ce qu'il ferait.

import { RARITY_NAMES, SELL_RARITIES, DEFAULT_PRICING, sellableCopy, pickCandidates, computePrice } from "./vente-logic.js";
import { nsStore } from "../lib/store.js";
import { setBadge, COLORS } from "../lib/badge.js";
export const store = nsStore("vente:");

const SITE = "https://poseidon-scans.net";
const API = SITE + "/api-game/v1";
const ALARM = "vente-keepalive";

const DEFAULT_SETTINGS = {
  enabled: false,
  dryRun: true,
  maxSlots: 50,
  floors: { N: 6, R: 13, SR: 51 },   // Commune > 5, Rare > 12, Épique > 50
  rarities: { N: true, R: true, SR: true },  // raretés autorisées à la vente
  pricing: { ...DEFAULT_PRICING },           // départ +15 %, −8 % par rotation sans vente, plancher carte 70 % de la réf.
  rotateMin: 60,
  checkMin: 2,
  scanHours: 24,
  writeMax: 25,                      // ventes + retraits max par fenêtre (réglable, 29 max)
  writeWindowSec: 31,                // fenêtre de 30 s + 1 s de marge
  readDelayMs: 1200,                 // pause entre deux lectures (réglable : 0,2 à 5 s)
  countAuctions: true                // les enchères en cours comptent dans les 50 emplacements
};

// ---------- état ----------
let S = null;          // {settings, inv, run, log, status}
let dirty = false, lastSave = 0;

async function load() {
  if (S) return S;
  const d = await store.get({ settings: {}, inv: null, run: null, log: [], status: {}, stats: null, sales: [] });
  S = {
    settings: { ...DEFAULT_SETTINGS, ...d.settings, floors: { ...DEFAULT_SETTINGS.floors, ...(d.settings.floors || {}) },
      rarities: { ...DEFAULT_SETTINGS.rarities, ...(d.settings.rarities || {}) },
      pricing: { ...DEFAULT_PRICING, ...(d.settings.pricing || {}) } },
    inv: d.inv || { cards: {}, scan: null, scannedAt: 0 },
    run: d.run || {},
    log: d.log || [],
    status: d.status || {},
    stats: d.stats || { baseline: null, counts: null, perles: null },   // photo de départ, comptage actuel, solde
    sales: d.sales || []                                                   // ventes faites par le script uniquement
  };
  S.run = { lastRotate: 0, lastCheck: 0, lastRefresh: 0, tracked: {}, skip: {}, plan: null, writes: [], botCopies: {}, ...S.run };
  S.run.botCopies = S.run.botCopies || {};
  S.run.priceAge = S.run.priceAge || {};   // {cardId: date de la 1re mise en vente sans vente depuis} → baisse progressive
  if (S.run.ver !== 2) { S.run.skip = {}; S.run.ver = 2; }   // efface les blocages des essais refusés de la v1.0
  return S;
}

async function save(force = false) {
  if (!S) return;
  const now = Date.now();
  const base = { run: S.run, log: S.log, status: S.status, stats: S.stats, sales: S.sales };
  if (force || now - lastSave > 15_000) { base.inv = S.inv; lastSave = now; }
  await store.set(base);
  dirty = false;
}

function log(kind, text) {
  S.log.unshift({ t: Date.now(), kind, text });
  if (S.log.length > 300) S.log.length = 300;
  dirty = true;
}
const sim = () => S.settings.dryRun;

// ---------- vitesse (réglable dans la fenêtre) ----------
const readDelay = () => Math.min(5000, Math.max(200, Number(S.settings.readDelayMs) || 1200));
const writeMax = () => Math.min(29, Math.max(1, Math.floor(Number(S.settings.writeMax) || 25)));
const WRITE_DELAY = 150;   // petite pause avant une vente/un retrait : le vrai frein est la limite par 30 s

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
  try { setPerles((await api("/me", { delay: readDelay() })).perles); } catch (e) { if (e.code === "stopped") throw e; }
  const series = ((await api("/series", { delay: readDelay() })).series || []).filter(x => x.owned > 0);
  S.status.counting.total = series.length;
  const counts = emptyCounts();
  for (const se of series) {
    const list = (await api(`/cards?owned=1&manga=${encodeURIComponent(se.id)}`, { delay: readDelay() })).cards || [];
    for (const c of list) addCount(counts, c);
    S.status.counting.done++;
    if (S.status.counting.done % 20 === 0) await save();
  }
  saveCounts(counts);
  S.status.counting = null;
  log("info", "Comptage de la collection terminé.");
}
const rn = r => RARITY_NAMES[r] || r;

// Nombre de rotations passées sans vente pour une carte (0 = première mise en vente)
function ageOf(cardId, now = Date.now()) {
  const t = S.run.priceAge[cardId];
  return t ? Math.max(0, Math.floor((now - t) / (S.settings.rotateMin * 60_000))) : 0;
}
const priceOpts = (cardId, extra = {}) => ({ pricing: S.settings.pricing, age: ageOf(cardId), ...extra });

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
  await store.set({ settings: S.settings });
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
        const r = await fetch(url, { method: m, credentials: "include", headers: b ? { "Content-Type": "application/json" } : undefined, body: b || undefined, aqmVente: true });
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
  await waitUntil(Math.max(lastReq + (delay ?? (method === "GET" ? readDelay() : WRITE_DELAY)), backoffUntil));
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
    if (S.run.writes.length < writeMax()) { S.run.writes.push(now); return; }
    S.status.phase = `Pause (limite ${writeMax()} actions / 30 s)`;
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
  const sc = S.inv.scan, end = Date.now() + budgetMs, cards = S.inv.cards, d = readDelay();

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
      wants: j.wants || 0, copies: (j.copies || []).map(mapCopy), checkedAt: Date.now(), copiesAt: Date.now() };
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
        delete S.run.priceAge[t.cardId];   // vendue : la prochaine repart du prix de départ
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
  for (const cand of cands) {
    const card = cand.card;
    if (placed >= free || looked >= free * 3 + 10) break;   // évite de lire des centaines de prix
    looked++;
    S.status.phase = `Prix de ${card.name}…`;
    const m = await api(`/market/cards/${card.id}`);
    card.wants = m.wants || 0; card.value = m.value ?? card.value; card.checkedAt = Date.now();
    if (!card.wants) continue;                                   // plus recherchée
    if ((m.mine || []).length) { listedCardIds.add(card.id); continue; }  // déjà en vente
    const p = computePrice(m, card.rarity, S.settings.floors, priceOpts(card.id));
    if (!p.price) { S.run.skip[card.id] = Date.now() + 3600_000; log("skip", `${card.name} ignorée : ${p.reason}`); continue; }

    // Exemplaires relus depuis plus de 15 min (tu as pu vendre, recycler, échanger…) : on relit avant de vendre
    if (!sim() && Date.now() - (card.copiesAt || 0) > 15 * 60_000) await refreshCard(card.id);
    let copy = sellableCopy(S.inv.cards[card.id]);
    if (!copy) continue;                                         // plus en double

    const line = { cardId: card.id, name: card.name, rarity: card.rarity, serial: copy.serial, price: p.price, source: p.source, wants: card.wants };
    if (sim()) { plan.list.push(line); placed++; listedCardIds.add(card.id); continue; }

    for (let attempt = 0; attempt < 2; attempt++) {
      await writeSlot();
      try {
        const res = await api("/market/orders", { method: "POST", body: { cardId: card.id, side: "sell", price: p.price, copyId: copy.id } });
        const c = S.inv.cards[card.id];
        listedCardIds.add(card.id); placed++;
        if (res?.filled) {
          log("sold", `Vendue tout de suite : ${card.name} #${copy.serial} à ${res.filled.price ?? p.price} Perles`);
          recordSale({ cardId: card.id, name: card.name, rarity: card.rarity, serial: copy.serial }, res.filled.price ?? p.price);
          if (c) c.copies = c.copies.filter(x => x.id !== copy.id);
          delete S.run.priceAge[card.id];
        } else {
          copy.locked = true;
          if (!S.run.priceAge[card.id]) S.run.priceAge[card.id] = Date.now();
          S.run.botCopies[copy.id] = { at: Date.now(), price: p.price, cardId: card.id };
          log("list", `En vente : ${card.name} (${rn(card.rarity)} #${copy.serial}) à ${p.price} Perles — ${p.source}`);
        }
        setPerles(res?.perles);
        S.run.errStreak = 0;
        break;
      } catch (e) {
        if (["slow_down", "auth", "no_tab", "origin", "stopped"].includes(e.code)) throw e;
        // L'exemplaire n'est plus à toi (vendu, recyclé, échangé…) : on relit la carte et on réessaie une fois
        if (attempt === 0 && /appartien|plus à toi|own|introuvable|not.?found/i.test(e.code + " " + e.message)) {
          await refreshCard(card.id);
          copy = sellableCopy(S.inv.cards[card.id]);
          if (copy) continue;
          log("skip", `${card.name} : plus en double, ignorée.`);
          break;
        }
        S.run.skip[card.id] = Date.now() + 3600_000;
        log("error", `Vente refusée pour ${card.name} : ${e.message}`);
        // Un refus propre à une carte (400/404/409/422) ne déclenche pas l'arrêt automatique : on passe à la suivante
        if (![400, 404, 409, 422].includes(e.status)) await countError();
        if (/limit|max|trop|slot|emplacement/i.test(e.code + " " + e.message)) return placed;  // plus de place côté site
        break;
      }
    }
    await save();
  }
  return placed;
}

// ---------- retrait ----------
const FATAL = ["slow_down", "auth", "no_tab", "origin", "stopped"];

// Retire une vente à prix fixe. true si elle est bien retirée.
async function withdrawOne(l) {
  await writeSlot();
  try {
    await api(`/market/orders/${l.id}`, { method: "DELETE" });
    S.run.errStreak = 0; delete S.run.botCopies[l.copyId];
    const c = S.inv.cards[l.card.id]?.copies.find(c => c.id === l.copyId); if (c) c.locked = false;
    delete S.run.tracked[l.id];
    return true;
  } catch (e) {
    if (FATAL.includes(e.code)) throw e;
    log("error", `Retrait impossible pour ${l.card.name} : ${e.message}`);
    if (![400, 404, 409, 422].includes(e.status)) await countError();
    return false;
  }
}

async function withdrawAll(mine, plan) {
  let n = 0;
  for (const l of mine) {
    if (sim()) { plan.removed.push({ name: l.card.name, rarity: l.card.rarity, serial: l.serial, price: l.price }); continue; }
    S.status.phase = `Retrait ${n + 1}/${mine.length}…`;
    if (await withdrawOne(l)) n++;
  }
  if (!sim() && n) log("info", `${n} ventes retirées.`);
  return n;
}

// ---------- rotation fine ----------
// Relit le prix d'une vente du script. Elle n'est remise en vente que si son prix doit baisser :
// un autre joueur vend moins cher (ou au même prix), ou la baisse progressive est arrivée.
// Renvoie "kept", "repriced" ou "dropped" (place libérée).
async function reprice(l, plan) {
  const id = l.card.id, name = l.card.name;
  S.status.phase = `Prix de ${name}…`;
  const m = await api(`/market/cards/${id}`);
  const card = S.inv.cards[id];
  if (card) { card.wants = m.wants || 0; card.value = m.value ?? card.value; card.checkedAt = Date.now(); }
  if (!S.run.priceAge[id]) S.run.priceAge[id] = S.run.botCopies[l.copyId]?.at || Date.now();
  const info = { cardId: id, name, rarity: l.card.rarity, serial: l.serial };

  if (!(m.wants > 0)) {   // plus recherchée : on libère la place pour un double recherché
    if (sim()) { plan.removed.push({ ...info, price: l.price }); return "dropped"; }
    if (!(await withdrawOne(l))) return "kept";
    delete S.run.priceAge[id];
    log("info", `Retirée (plus recherchée) : ${name} (${rn(l.card.rarity)} #${l.serial})`);
    return "dropped";
  }

  const myOrders = (m.mine || []).filter(o => (o.side || "sell") === "sell");
  const p = computePrice(m, l.card.rarity, S.settings.floors, priceOpts(id, { mine: myOrders }));
  if (!p.price || p.price >= l.price) return "kept";            // déjà le moins cher au bon prix : on ne touche à rien

  const line = { ...info, price: p.price, from: l.price, source: p.source, wants: m.wants };
  if (sim()) { plan.list.push(line); return "repriced"; }
  if (!(await withdrawOne(l))) return "kept";
  await writeSlot();
  try {
    const res = await api("/market/orders", { method: "POST", body: { cardId: id, side: "sell", price: p.price, copyId: l.copyId } });
    S.run.errStreak = 0; setPerles(res?.perles);
    if (res?.filled) {
      const price = res.filled.price ?? p.price;
      log("sold", `Vendue tout de suite : ${name} #${l.serial} à ${price} Perles`);
      recordSale(info, price);
      if (card) card.copies = card.copies.filter(x => x.id !== l.copyId);
      delete S.run.priceAge[id];
    } else {
      const c = card?.copies.find(x => x.id === l.copyId); if (c) c.locked = true;
      S.run.botCopies[l.copyId] = { at: Date.now(), price: p.price, cardId: id };
      log("list", `Prix baissé : ${name} (${rn(l.card.rarity)} #${l.serial}) ${l.price} → ${p.price} Perles — ${p.source}`);
    }
    return "repriced";
  } catch (e) {
    if (FATAL.includes(e.code)) throw e;
    log("error", `Remise en vente refusée pour ${name} : ${e.message}`);
    if (![400, 404, 409, 422].includes(e.status)) await countError();
    return "dropped";   // la place est libre : le remplissage la reprendra
  }
}

// ---------- cycles ----------
async function rotate() {
  S.status.phase = "Rotation : lecture des ventes…";
  try { setPerles((await api("/me")).perles); } catch (e) { if (e.code === "stopped") throw e; }
  const plan = { at: Date.now(), kind: "rotation", removed: [], list: [] };
  const { mine, auctions, listedCardIds } = await refreshOpen();
  const n = { kept: 0, repriced: 0, dropped: 0, manual: 0 };
  for (const l of mine) {
    if (!S.run.botCopies[l.copyId]) { n.manual++; continue; }   // vente manuelle : on n'y touche pas
    const r = await reprice(l, plan);
    n[r]++;
    if (r === "dropped") listedCardIds.delete(l.card.id);
    await save();
  }
  const free = S.settings.maxSlots - auctions.length - (mine.length - n.dropped);
  const placed = await fill(free, listedCardIds, plan);
  // la baisse progressive ne concerne que les cartes encore en vente
  for (const id of Object.keys(S.run.priceAge)) if (!listedCardIds.has(id)) delete S.run.priceAge[id];
  S.run.lastRotate = Date.now(); S.run.lastCheck = Date.now();
  const sum = `${n.repriced} prix baissés, ${n.kept} inchangées, ${n.dropped} retirées, ${placed} nouvelles` + (n.manual ? ` (${n.manual} ventes manuelles ignorées)` : "");
  if (sim()) { S.run.plan = plan; log("sim", `[Simulation] Rotation : ${sum}.`); }
  else log("info", `Rotation terminée : ${sum}.`);
  S.status.idle = free > 0 && !placed && !n.kept && !n.repriced ? "Aucun double recherché à vendre pour l'instant : j'attends." : null;
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
  await refreshCard(stale.id, readDelay());
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
      setBadge("vente", !S.settings.enabled ? null
        : S.status.error ? { text: "!", color: COLORS.error, error: true }
        : { text: S.settings.dryRun ? "SIM" : String(S.status.open ?? ""), color: S.settings.dryRun ? COLORS.sim : COLORS.real });
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
  chrome.notifications.create("vente-auth", { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title: title.replace("Poseidon Vente", "Aquaman · Vente auto"), message, priority: 1 });
}

export function start() { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); ensureLoop(); }
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) ensureLoop(); });

// Réglages modifiés depuis la fenêtre
store.onChanged(async (ch) => {
  if (!ch.settings || !S) return;
  const nv = ch.settings.newValue || {};
  const before = S.settings, after = { ...DEFAULT_SETTINGS, ...nv,
    floors: { ...DEFAULT_SETTINGS.floors, ...(nv.floors || {}) }, rarities: { ...DEFAULT_SETTINGS.rarities, ...(nv.rarities || {}) },
    pricing: { ...DEFAULT_PRICING, ...(nv.pricing || {}) } };
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

export async function handleMessage(type) {
  const msg = { type };
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
      await store.set({ settings: S.settings });
      ensureLoop(true);
    }
      return true;
}
