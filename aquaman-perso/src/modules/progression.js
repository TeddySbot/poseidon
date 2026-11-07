// Ma progression (Aquaman perso) : catalogue complet du jeu, série par série, et photos quotidiennes.
//
// - Lit /series, puis /cards?manga=<id> pour chaque série. Une série n'est relue que si mon nombre de cartes
//   y a changé, ou au bout de 24 h (nouvelles cartes ajoutées par le jeu).
// - Première lecture : ~348 séries × 0,9 s ≈ 5 min. Ensuite quelques secondes.
// - Toutes les 3 h (si le catalogue existe) : mise à jour légère et photo du jour pour la courbe.
// - Le catalogue sert aussi à « Compléter ma collection » (pas de double lecture du site).

import { nsStore } from '../lib/store.js';
import { get } from '../lib/gameapi.js';

export const store = nsStore('progression:');
const ALARM = 'progression-refresh';
const SERIES_TTL = 24 * 3600e3;
export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR', 'SEC'];

let running = null; // promesse de la lecture en cours
let stopFlag = false;

const miniCard = (c) => ({
  id: c.id,
  name: c.name,
  rarity: c.rarity,
  image: c.image,
  variant: c.variant ?? null,
  event: !!(c.seasonId || c.types?.some((t) => t === 'halloween' || t === 'event' || t === 'noel' || t === 'paques')),
  owned: c.owned ?? 0
});

const setStatus = (status) => store.set({ status: { ...status, at: Date.now() } });

// Met à jour le catalogue. Renvoie { series:[...], cards:{seriesId:[card]} }.
// `onlyIncomplete` : ne lit que les séries incomplètes (assez pour trouver les manquantes).
export function refresh({ onlyIncomplete = false, force = false } = {}) {
  if (running) return running;
  stopFlag = false;
  running = (async () => {
    const st = { running: true, step: 'Séries', done: 0, total: 0, error: null };
    try {
      await setStatus(st);
      const { catalog = {} } = await store.get({ catalog: {} });
      const series = (await get('/series', () => stopFlag)).series ?? [];
      const albums = (await get('/albums', () => stopFlag).catch(() => ({ albums: [] }))).albums ?? [];
      const me = await get('/me', () => stopFlag).catch(() => null);
      for (const id of Object.keys(catalog)) if (!series.some((s) => s.id === id)) delete catalog[id];
      const todo = series.filter((s) => {
        const c = catalog[s.id];
        if (onlyIncomplete && s.owned >= s.total && c) return false;
        return force || !c || c.owned !== s.owned || c.total !== s.total || Date.now() - c.at > SERIES_TTL;
      });
      st.step = 'Cartes des séries';
      st.total = todo.length;
      await setStatus(st);
      let n = 0;
      for (const s of todo) {
        const cards = (await get(`/cards?manga=${encodeURIComponent(s.id)}`, () => stopFlag)).cards ?? [];
        catalog[s.id] = { at: Date.now(), owned: s.owned, total: s.total, cards: cards.map(miniCard) };
        st.done++;
        if (++n % 10 === 0) {
          await store.set({ catalog });
          await setStatus(st);
        }
      }
      await store.set({ catalog });
      const view = summarize(series, catalog, albums, me);
      await store.set({ view });
      await snapshot(view);
      await setStatus({ running: false, error: null, lastRefresh: Date.now() });
      ensureAlarm();
      return { series, catalog, view };
    } catch (e) {
      await setStatus({ running: false, error: e.message || String(e) });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

export const stop = () => (stopFlag = true);
export const isRunning = () => !!running;

// Résumé affiché par la page (calculé ici une fois, pour une page rapide).
export function summarize(series, catalog, albums = [], me = null) {
  const blank = () => Object.fromEntries(RARITIES.map((r) => [r, { owned: 0, total: 0, evOwned: 0, evTotal: 0 }]));
  const byRarity = blank();
  const rows = [];
  let owned = 0, total = 0, evOwned = 0, evTotal = 0, copies = 0, partial = 0, dupCards = 0, dupCopies = 0;
  const albumOf = new Map(albums.map((a) => [a.series?.id, a]));
  for (const s of series) {
    const c = catalog[s.id];
    const r = blank();
    if (c) {
      for (const k of c.cards) {
        const b = r[k.rarity] ?? (r[k.rarity] = { owned: 0, total: 0, evOwned: 0, evTotal: 0 });
        b.total++;
        if (k.owned) b.owned++;
        if (k.event) {
          b.evTotal++;
          if (k.owned) b.evOwned++;
        }
        copies += k.owned;
        if (k.owned > 1) {
          dupCards++; // cartes que j'ai en au moins 2 exemplaires
          dupCopies += k.owned - 1; // exemplaires en trop (on garde 1 de chaque)
        }
      }
      for (const [k, v] of Object.entries(r)) {
        const g = byRarity[k] ?? (byRarity[k] = { owned: 0, total: 0, evOwned: 0, evTotal: 0 });
        g.owned += v.owned;
        g.total += v.total;
        g.evOwned += v.evOwned;
        g.evTotal += v.evTotal;
      }
    } else partial++;
    owned += s.owned ?? 0;
    total += s.total ?? 0;
    evOwned += s.eventOwned ?? 0;
    evTotal += s.eventTotal ?? 0;
    const a = albumOf.get(s.id);
    rows.push({
      id: s.id,
      title: s.title,
      slug: s.slug,
      owned: s.owned ?? 0,
      total: s.total ?? 0,
      eventOwned: s.eventOwned ?? 0,
      eventTotal: s.eventTotal ?? 0,
      rarity: c ? Object.fromEntries(Object.entries(r).filter(([, v]) => v.total)) : null,
      claimed: a?.claimed ?? null,
      reward: a?.reward ?? null
    });
  }
  const complete = rows.filter((s) => s.total && s.owned >= s.total).length;
  return {
    at: Date.now(),
    owned: me?.owned ?? owned,
    total: me?.total ?? total,
    perles: me?.perles ?? null,
    eventOwned: evOwned,
    eventTotal: evTotal,
    copies,
    dupCards,
    dupCopies,
    byRarity,
    series: rows,
    seriesCount: rows.length,
    complete,
    unclaimed: rows.filter((s) => s.total && s.owned >= s.total && s.claimed === false).map((s) => ({ id: s.id, title: s.title, reward: s.reward })),
    partial // séries dont le détail par rareté n'est pas encore lu
  };
}

// Une photo par jour (la dernière de la journée remplace les précédentes), 365 jours au plus.
async function snapshot(view) {
  if (view.partial) return;
  const { history = [] } = await store.get({ history: [] });
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shot = {
    day,
    at: Date.now(),
    owned: view.owned,
    total: view.total,
    complete: view.complete,
    byRarity: Object.fromEntries(Object.entries(view.byRarity).map(([k, v]) => [k, [v.owned, v.total]]))
  };
  if (history.at(-1)?.day === day) history[history.length - 1] = shot;
  else history.push(shot);
  await store.set({ history: history.slice(-365) });
}

// Cartes manquantes d'après le catalogue (pour « Compléter ma collection »).
export function missingFrom(catalog, series) {
  const out = [];
  for (const s of series) {
    if ((s.owned ?? 0) >= (s.total ?? 0)) continue;
    for (const c of catalog[s.id]?.cards ?? []) if (!c.owned) out.push({ ...c, series: { id: s.id, title: s.title } });
  }
  return out;
}

async function ensureAlarm() {
  if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== 180) chrome.alarms.create(ALARM, { delayInMinutes: 180, periodInMinutes: 180 });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM || running) return;
  const { catalog } = await store.get({ catalog: null });
  if (catalog && Object.keys(catalog).length) refresh().catch(() => {});
});

export async function start() {
  const { catalog } = await store.get({ catalog: null });
  if (catalog && Object.keys(catalog).length) ensureAlarm();
}

export async function handleMessage(type) {
  switch (type) {
    case 'refresh':
      refresh().catch(() => {});
      return { ok: true };
    case 'full':
      refresh({ force: true }).catch(() => {});
      return { ok: true };
    case 'stop':
      stop();
      return { ok: true };
    default:
      return { error: 'unknown' };
  }
}
