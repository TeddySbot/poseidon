// Mes doubles (Aquaman perso) : préparation et mise en vente des exemplaires en trop.
//
// Règles :
//  - De chaque carte, on garde TOUJOURS l'exemplaire au plus petit #serial. On vend les autres, plus gros serials d'abord.
//  - Jamais un exemplaire bloqué, lié, protégé ou déjà en vente.
//  - Rien n'est mis en vente sans un clic sur « Mettre en vente » puis « Confirmer » dans la page.
//  - Le site accepte 50 ordres en cours au plus (ventes + achats) : ce qui ne rentre pas attend dans une file,
//    retentée toutes les 2 min. Chaque exemplaire est relu juste avant sa mise en vente.

import { nsStore } from '../lib/store.js';
import { get } from '../lib/gameapi.js';
import { write } from '../lib/sitewrite.js';
import { refPrice, competitorAsk } from './vente-logic.js';

export const store = nsStore('doubles:');
const ALARM = 'doubles-queue';
export const MAX_ORDERS = 50;
const PREPARE_MAX = 80;
const FULL = /ordres? en cours|limit|emplacement/i;
const DONE = new Set(['filled', 'cancelled', 'canceled', 'expired', 'closed', 'done']);

let running = null;
let stopFlag = false;
const stopped = () => stopFlag;

async function log(kind, text) {
  const { log: l = [] } = await store.get({ log: [] });
  l.unshift({ t: Date.now(), kind, text });
  await store.set({ log: l.slice(0, 300) });
}
const setStatus = (s) => store.set({ status: { ...s, at: Date.now() } });

// Places de vente occupées (ordres ouverts)
export async function readSlots() {
  const listings = (await get('/market/listings?mine=1', stopped)).listings ?? [];
  const orders = (await get('/market/orders', stopped).catch(() => ({ orders: [] }))).orders ?? [];
  const open = orders.filter((o) => o?.status && !DONE.has(String(o.status).toLowerCase())).length;
  const slots = { at: Date.now(), used: Math.max(listings.length, open), max: MAX_ORDERS };
  await store.set({ slots });
  return slots;
}

// Exemplaires d'une carte : celui gardé (plus petit serial) et ceux vendables (plus gros serial d'abord)
async function copiesOf(cardId) {
  const j = await get(`/cards/${encodeURIComponent(cardId)}`, stopped);
  const all = (j.copies ?? [])
    .map((c) => ({ id: c.copyId || c.id, serial: c.serial ?? Infinity, locked: !!c.locked, bound: !!c.bound, protected: !!c.protected }))
    .sort((a, b) => a.serial - b.serial);
  const keep = all[0] ?? null;
  const sellable = all.slice(1).filter((c) => !c.locked && !c.bound && !c.protected).sort((a, b) => b.serial - a.serial);
  return { card: j, all, keep, sellable };
}

// Prix conseillé : la vente la moins chère des autres − 1, sans descendre sous 70 % du prix de référence
// (médiane des ventes récentes, sinon estimation du site), ni sous la meilleure offre d'achat ; dans les limites du site.
export function suggest(m) {
  const { ref, src: refSrc } = refPrice(m);
  const comp = competitorAsk(m, m?.mine ?? []);
  let price, src;
  if (comp != null && (ref == null || comp - 1 <= ref * 1.15)) {
    price = comp - 1;
    src = `moins chère ${comp} − 1`;
  } else if (ref != null) {
    price = Math.round(ref);
    src = refSrc;
  } else {
    price = m?.value ?? m?.limits?.market?.min ?? 1;
    src = 'valeur officielle';
  }
  const floor = ref ? Math.ceil(ref * 0.7) : 0;
  if (price < floor) {
    price = floor;
    src += ' → 70 % de la réf.';
  }
  if (m?.bestBid != null && m.bestBid > price) {
    price = m.bestBid;
    src = `offre d'achat ${m.bestBid}`;
  }
  const lim = m?.limits?.market;
  if (lim?.min != null && price < lim.min) price = lim.min;
  if (lim?.max != null && price > lim.max) price = lim.max;
  return { price: Math.max(1, Math.round(price)), src, ref, comp, min: lim?.min ?? null, max: lim?.max ?? null };
}

function job(fn) {
  if (running) return running;
  stopFlag = false;
  running = fn()
    .catch(async (e) => {
      await setStatus({ running: false, error: e.message || String(e) });
    })
    .finally(() => (running = null));
  return running;
}

// Lit les exemplaires et les prix des cartes choisies → plan à valider dans la page
function prepare(cardIds) {
  return job(async () => {
    const ids = [...new Set(cardIds)].slice(0, PREPARE_MAX);
    const st = { running: true, step: 'Lecture des exemplaires et des prix', done: 0, total: ids.length, error: null };
    await setStatus(st);
    await readSlots();
    const items = [];
    for (const id of ids) {
      const { card, all, keep, sellable } = await copiesOf(id);
      const m = await get(`/market/cards/${encodeURIComponent(id)}`, stopped).catch(() => null);
      const s = suggest(m ?? {});
      items.push({
        cardId: id,
        name: card.name,
        rarity: card.rarity,
        image: card.image,
        series: card.series?.title ?? '',
        owned: all.length,
        keepSerial: keep?.serial ?? null,
        sellable: sellable.length,
        serials: sellable.map((c) => c.serial),
        listed: all.filter((c) => c.locked).length,
        wants: m?.wants ?? card.wants ?? 0,
        value: m?.value ?? null,
        estimate: m?.estimate ?? null,
        ...s
      });
      st.done++;
      await setStatus(st);
    }
    await store.set({ plan: { at: Date.now(), items } });
    await setStatus({ running: false, error: null, lastPrepare: Date.now() });
  });
}

// Ajoute à la file : [{cardId, name, rarity, price, count}] puis lance la mise en vente
async function enqueue(items) {
  const { queue = [] } = await store.get({ queue: [] });
  for (const it of items) {
    const count = Math.max(0, Math.floor(Number(it.count) || 0));
    const price = Math.round(Number(it.price) || 0);
    if (!count || price < 1) continue;
    const q = queue.find((x) => x.cardId === it.cardId);
    if (q) Object.assign(q, { price, left: count });
    else queue.push({ cardId: it.cardId, name: it.name, rarity: it.rarity, price, left: count, added: Date.now() });
  }
  await store.set({ queue });
  chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: 2 }); // relance si une autre lecture est en cours
  await log('info', `${items.reduce((n, x) => n + (Number(x.count) || 0), 0)} exemplaire(s) ajoutés à la file de vente.`);
  runQueue();
}

// Met en vente ce qui rentre dans les places libres
function runQueue() {
  return job(async () => {
    let { queue = [] } = await store.get({ queue: [] });
    if (!queue.length) return void (await setStatus({ running: false, error: null }));
    const st = { running: true, step: 'Mise en vente', done: 0, total: queue.reduce((n, x) => n + x.left, 0), error: null };
    await setStatus(st);
    const slots = await readSlots();
    let free = slots.max - slots.used;
    let full = free <= 0;
    for (const q of queue) {
      if (full || stopFlag) break;
      st.step = `Mise en vente : ${q.name}`;
      await setStatus(st);
      const { sellable } = await copiesOf(q.cardId);
      if (!sellable.length) {
        await log('skip', `${q.name} : plus d'exemplaire en trop à vendre, retirée de la file.`);
        q.left = 0;
        continue;
      }
      if (sellable.length < q.left) q.left = sellable.length;
      for (const copy of sellable) {
        if (q.left <= 0 || stopFlag) break;
        if (free <= 0) {
          full = true;
          break;
        }
        try {
          const res = await write('/market/orders', 'POST', { cardId: q.cardId, side: 'sell', price: q.price, copyId: copy.id });
          q.left--;
          st.done++;
          if (res?.filled) await log('sold', `Vendue tout de suite : ${q.name} #${copy.serial} à ${res.filled.price ?? q.price} Perles`);
          else {
            free--;
            await log('list', `En vente : ${q.name} (${q.rarity} #${copy.serial}) à ${q.price} Perles`);
          }
        } catch (e) {
          if (FULL.test(e.message)) {
            full = true;
            break;
          }
          if (e.status === 401 || e.status === 429 || e.status >= 500 || e.status === 0) throw e;
          await log('error', `${q.name} #${copy.serial} refusée : ${e.message} (retirée de la file)`);
          q.left = 0;
          break;
        }
        await setStatus(st);
      }
      await store.set({ queue: queue.filter((x) => x.left > 0) });
    }
    queue = queue.filter((x) => x.left > 0);
    await store.set({ queue });
    await readSlots().catch(() => {});
    if (queue.length) {
      if (full) await log('info', `Plus de place (${MAX_ORDERS} ordres en cours) : ${queue.reduce((n, x) => n + x.left, 0)} exemplaire(s) attendent, nouvel essai toutes les 2 min.`);
      chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: 2 });
    } else chrome.alarms.clear(ALARM);
    await setStatus({ running: false, error: null, lastRun: Date.now() });
  });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM && !running) runQueue();
});

export async function start() {
  const { queue = [] } = await store.get({ queue: [] });
  if (queue.length && !(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 2 });
  const { status } = await store.get({ status: null });
  if (status?.running && !running) await setStatus({ ...status, running: false }); // service relancé en cours de route
}

export async function handleMessage(type, msg = {}) {
  switch (type) {
    case 'prepare':
      prepare(msg.cardIds ?? []);
      return { ok: true };
    case 'sell':
      await enqueue(msg.items ?? []);
      return { ok: true };
    case 'run':
      runQueue();
      return { ok: true };
    case 'slots':
      return readSlots();
    case 'stop':
      stopFlag = true;
      return { ok: true };
    case 'unqueue': {
      const { queue = [] } = await store.get({ queue: [] });
      const rest = msg.cardId ? queue.filter((x) => x.cardId !== msg.cardId) : [];
      await store.set({ queue: rest });
      if (!rest.length) chrome.alarms.clear(ALARM);
      return { ok: true };
    }
    default:
      return { error: 'unknown' };
  }
}
