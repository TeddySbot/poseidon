// Alertes Marché (ex-extension « Poseidon – Alertes Marché » v1.1, intégrée à Aquaman perso)
//  - Vérif rapide toutes les X secondes : UNE seule requête (les 200 dernières annonces), comparée à toute la liste.
//  - Vérif complète toutes les 60 s : une recherche par carte surveillée (détecte les ventes conclues/retirées).
//  - Si le site répond 429/403/5xx, ralentissement automatique (15 s → 5 min).
// Ventes à prix fixe uniquement (pas les enchères). N'achète jamais.
import { nsStore, RARITY_NAMES } from '../lib/store.js';
import { setBadge, COLORS } from '../lib/badge.js';

const SITE = 'https://poseidon-scans.net';
const API = SITE + '/api-game/v1/market/listings';
const ALARM = 'alertes-keepalive';
const FULL_EVERY_MS = 60_000;
const MAX_BACKOFF_S = 300;
const ICON = chrome.runtime.getURL('icons/icon128.png');
export const store = nsStore('alertes:');

async function getState() {
  return store.get({
    watches: [], // [{id, name, exact, maxPrice, rarity}]
    intervalSec: 5,
    paused: false,
    alerts: {}, // watchId -> {listings:{listingId: info}, dismissed, dismissedIds:[], shownIds:[]}
    status: { lastCheck: null, error: null }
  });
}

// ---------- boucle ----------
let loopTimer = null, lastFull = 0, backoffSec = 0, busy = false, rerun = false;

async function tick() {
  loopTimer = null;
  busy = true;
  let wait = 5;
  try {
    const { intervalSec, paused } = await getState();
    if (paused) {
      wait = 30;
      setBadge('alertes', null);
    } else {
      const full = Date.now() - lastFull >= FULL_EVERY_MS;
      await check(full);
      if (full) lastFull = Date.now();
      wait = Math.max(2, Number(intervalSec) || 5) + backoffSec;
    }
  } catch (e) {
    console.error('[alertes]', e);
  } finally {
    busy = false;
    if (rerun) {
      rerun = false;
      wait = 0.2;
    }
    loopTimer = setTimeout(tick, wait * 1000);
  }
}

function ensureLoop(restart = false) {
  if (busy) {
    if (restart) rerun = true;
    return;
  }
  if (restart && loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  if (!loopTimer) tick();
}

export function start() {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); // relance la boucle si Chrome a endormi le service
  ensureLoop();
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) ensureLoop();
});

// ---------- réseau ----------
const norm = (s) => (s || '').toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function matches(l, w) {
  const n = norm(l.card?.name), q = norm(w.name);
  return (w.exact ? n === q : n.includes(q)) && (!w.maxPrice || l.price <= Number(w.maxPrice)) && (!w.rarity || l.card?.rarity === w.rarity) && !l.mine;
}

class HttpError extends Error {
  constructor(code) {
    super(String(code));
    this.code = code;
  }
}

async function fetchListings(q) {
  const url = q ? `${API}?sort=new&q=${encodeURIComponent(q)}` : `${API}?sort=new`;
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new HttpError(r.status);
  return (await r.json()).listings || [];
}

const info = (l) => ({ price: l.price, serial: l.serial, rarity: l.card?.rarity, name: l.card?.name, cardId: l.card?.id, series: l.card?.series?.title, seller: l.seller?.name });

// ---------- vérification ----------
async function check(full) {
  const { watches, alerts } = await getState();
  let error = null;

  try {
    if (!watches.length) {
      await store.set({ status: { lastCheck: Date.now(), error: null, found: 0 } });
      setBadge('alertes', null);
      return;
    }
    if (full) {
      for (const w of watches) {
        const found = (await fetchListings(w.name)).filter((l) => matches(l, w));
        const a = alerts[w.id] || { listings: {}, dismissed: false, dismissedIds: [] };
        a.listings = Object.fromEntries(found.map((l) => [l.id, info(l)]));
        alerts[w.id] = a;
        await new Promise((r) => setTimeout(r, 300));
      }
    } else {
      const latest = await fetchListings(null);
      for (const w of watches) {
        const a = alerts[w.id] || { listings: {}, dismissed: false, dismissedIds: [] };
        for (const l of latest) if (matches(l, w)) a.listings[l.id] = info(l);
        alerts[w.id] = a;
      }
    }
    backoffSec = 0;
  } catch (e) {
    if (e.code === 401) error = 'AUTH';
    else if (e.code === 429 || e.code === 403 || e.code >= 500) {
      backoffSec = Math.min(MAX_BACKOFF_S, backoffSec ? backoffSec * 2 : 15);
      error = `Le site freine les requêtes (${e.code}) : pause de ${backoffSec} s`;
    } else error = 'Erreur réseau : ' + (e.message || e);
  }

  const ids = new Set(watches.map((w) => w.id));
  for (const k of Object.keys(alerts))
    if (!ids.has(k)) {
      chrome.notifications.clear('w:' + k);
      delete alerts[k];
    }

  if (!error) for (const w of watches) await renderAlert(w, alerts[w.id]);

  if (error === 'AUTH') notifyAuth();
  else chrome.notifications.clear('auth');
  const found = watches.filter((w) => Object.keys(alerts[w.id]?.listings || {}).length).length;
  await store.set({ alerts, status: { lastCheck: Date.now(), error, found } });
  setBadge('alertes', error ? { text: '!', color: COLORS.error, error: true } : found ? { text: String(found), color: COLORS.alert } : null);
}

async function renderAlert(w, a) {
  const nid = 'w:' + w.id;
  const entries = Object.entries(a.listings || {});
  if (!entries.length) {
    chrome.notifications.clear(nid);
    a.dismissed = false;
    a.dismissedIds = [];
    a.shownIds = [];
    return;
  }
  const ids = entries.map(([id]) => id);
  if (a.dismissed) {
    if (!ids.some((id) => !a.dismissedIds.includes(id))) return;
    a.dismissed = false;
  }
  entries.sort((x, y) => x[1].price - y[1].price);
  const best = entries[0][1];
  const rar = RARITY_NAMES[best.rarity] || best.rarity;
  const opts = {
    type: 'basic',
    iconUrl: ICON,
    title: `${best.name} est en vente !`,
    message: entries.length === 1 ? `${best.price} perles · ${rar} #${best.serial} · vendu par ${best.seller || '?'}` : `${entries.length} annonces · dès ${best.price} perles (${rar} #${best.serial})`,
    contextMessage: best.series || 'Marché Poseidon',
    requireInteraction: true,
    priority: 2
  };
  a.cardId = best.cardId;
  const shown = a.shownIds || [];
  const isNew = ids.some((id) => !shown.includes(id));
  const exists = await new Promise((r) => chrome.notifications.getAll((all) => r(!!all[nid])));
  if (!exists || isNew) {
    if (exists) await new Promise((r) => chrome.notifications.clear(nid, r));
    chrome.notifications.create(nid, opts);
  } else chrome.notifications.update(nid, opts);
  a.shownIds = ids;
}

function notifyAuth() {
  chrome.notifications.create('auth', {
    type: 'basic',
    iconUrl: ICON,
    title: 'Aquaman : connexion nécessaire',
    message: 'Connecte-toi sur poseidon-scans.net dans ce navigateur pour que les alertes marchent. Clique ici.',
    requireInteraction: true,
    priority: 1
  });
}

// ---------- clics / fermeture des notifications ----------
chrome.notifications.onClicked.addListener(async (nid) => {
  if (nid === 'auth') {
    chrome.tabs.create({ url: SITE + '/jeu/marche' });
    chrome.notifications.clear(nid);
    return;
  }
  if (!nid.startsWith('w:')) return;
  const { alerts, watches } = await getState();
  const id = nid.slice(2), a = alerts[id], w = watches.find((x) => x.id === id);
  chrome.tabs.create({ url: a?.cardId ? `${SITE}/jeu/marche/${a.cardId}` : `${SITE}/jeu/marche?q=${encodeURIComponent(w?.name || '')}` });
});

chrome.notifications.onClosed.addListener(async (nid, byUser) => {
  if (!byUser || !nid.startsWith('w:')) return;
  const { alerts } = await getState();
  const a = alerts[nid.slice(2)];
  if (a) {
    a.dismissed = true;
    a.dismissedIds = Object.keys(a.listings || {});
    await store.set({ alerts });
  }
});

// ---------- messages de la fenêtre ----------
export async function handleMessage(type) {
  if (type === 'checkNow') {
    lastFull = 0;
    ensureLoop(true);
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  }
  if (type === 'reschedule') {
    backoffSec = 0;
    ensureLoop(true);
    return true;
  }
  return { error: 'unknown_message' };
}
