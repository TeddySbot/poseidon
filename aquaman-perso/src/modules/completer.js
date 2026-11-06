// Compléter ma collection (Aquaman perso)
//
//  1. Analyse (sur demande) : cartes qui me manquent, mes doubles échangeables, joueurs qui ont en double ce qui
//     me manque (suggestions du jeu + serveur Aquaman), puis propositions d'échange équilibrées.
//  2. Rien n'est envoyé sans un clic « Envoyer » puis « Confirmer » sur la page Compléter ma collection.
//  3. Suivi : toutes les 15 min, relit mes échanges envoyés (en cours, acceptés, refusés, expirés).
//
// Règles : je garde toujours mon plus petit #serial ; seuls les autres exemplaires partent, plus gros serial d'abord.
// Lecture : une requête toutes les 0,9 s au plus, pause si le site freine. Les envois passent par un onglet du site.

import { nsStore } from '../lib/store.js';
import { myId, getSettings } from '../lib/aquaman.js';
import { get as apiGet, ApiError, sleep, API, SITE } from '../lib/gameapi.js';
import { refresh as refreshCatalog, missingFrom, stop as stopCatalog } from './progression.js';
import { tradeableDoubles, spareCopiesOf, proposalsForPlayer, rank, RARITY_ORDER, DEFAULTS, isBalanced, MAX_SIDE } from './completer-logic.js';

export const store = nsStore('completer:');

const RELAY = 'https://aquaman-relay.finch-arhold-git.workers.dev';
const ALARM = 'completer-refresh';
const PLAYER_TTL = 30 * 60e3;
// Ordre de recherche sur le serveur Aquaman : d'abord ce que mes doubles (surtout des Épiques) peuvent payer.
const LOOK_ORDER = ['SR', 'SSR', 'R', 'UR', 'N', 'SEC'];
const names = (list) => {
  const n = list.map((c) => c.card.name);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} et ${n.at(-1)}`;
};

export const DEFAULT_SETTINGS = {
  message: 'Salut ! Il me manque {cartes} pour compléter ma collection, ça te dit ?', // {cartes} = noms des cartes demandées
  overpay: DEFAULTS.overpay, // jusqu'à +20 % au-dessus de la valeur demandée
  maxPlayers: 20, // joueurs dont on lit les cartes par analyse
  relayCards: 40, // cartes manquantes cherchées sur le serveur Aquaman par analyse
  maxProposals: 40,
  maxTake: DEFAULTS.maxTakePerTrade, // cartes demandées au même joueur dans un seul échange
  notify: true
};

// ---------- état ----------
let busy = false;
let stopFlag = false;

async function data() {
  const d = await store.get({ settings: {}, status: {}, log: [], proposals: [], sent: {}, ignored: [], summary: null, missing: [], playerCache: {} });
  d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
  return d;
}

async function log(kind, text) {
  const { log: l = [] } = await store.get({ log: [] });
  l.unshift({ t: Date.now(), kind, text });
  await store.set({ log: l.slice(0, 200) });
}

const setStatus = (status) => store.set({ status: { ...status, at: Date.now() } });

// ---------- réseau ----------
const get = (path) => apiGet(path, () => stopFlag);

async function relay(path) {
  if ((await getSettings()).relayRead === false) return null;
  try {
    const r = await fetch(RELAY + path, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Les écritures doivent venir d'une page du site (le site refuse l'origine de l'extension).
async function siteTab() {
  const tabs = await chrome.tabs.query({ url: SITE + '/*' });
  let t = tabs.find((x) => x.status === 'complete' && !x.discarded) || tabs[0];
  if (!t) t = await chrome.tabs.create({ url: SITE + '/jeu/echanges', active: false });
  for (let i = 0; i < 30; i++) {
    const cur = await chrome.tabs.get(t.id).catch(() => null);
    if (!cur) throw new ApiError(0, 'L’onglet poseidon-scans.net a été fermé.');
    if (cur.discarded) await chrome.tabs.reload(t.id);
    else if (cur.status === 'complete') return cur;
    await sleep(1000);
  }
  throw new ApiError(0, 'L’onglet poseidon-scans.net ne finit pas de charger.');
}

async function post(path, body) {
  const tab = await siteTab();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [API + path, body === undefined ? null : JSON.stringify(body)],
    func: async (url, b) => {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b || undefined });
      return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
    }
  });
  const r = res?.result;
  if (!r) throw new ApiError(0, 'Pas de réponse de l’onglet du site.');
  if (!r.ok) throw new ApiError(r.status, r.json?.error?.message || `Erreur ${r.status}`);
  return r.json;
}

// ---------- formes compactes (stockage) ----------
const miniCard = (c) => ({ id: c.id, name: c.name, rarity: c.rarity, image: c.image, variant: c.variant ?? null, series: c.series ? { id: c.series.id, title: c.series.title } : null });
const miniCopy = (c) => ({ copyId: c.copyId, serial: c.serial, value: c.value ?? 0, card: miniCard(c.card) });
const miniPlayer = (p) => ({ id: p.id, name: p.name ?? null, image: p.image ?? null });

// ---------- analyse ----------
async function playerCopies(id, cache) {
  const hit = cache[id];
  if (hit && Date.now() - hit.at < PLAYER_TTL) return hit;
  const j = await get(`/players/${encodeURIComponent(id)}/copies`);
  const entry = { at: Date.now(), copies: (j?.copies ?? []).map((c) => ({ ...miniCopy(c), locked: !!c.locked, bound: !!c.bound, protected: !!c.protected })) };
  cache[id] = entry;
  return entry;
}

export async function scan() {
  if (busy) return { error: 'Une analyse est déjà en cours.' };
  busy = true;
  stopFlag = false;
  const st = { running: true, step: 'Profil', done: 0, total: 0, error: null, startedAt: Date.now() };
  try {
    const d = await data();
    const S = d.settings;
    await setStatus(st);
    const me = await get('/me');
    const meId = await myId().catch(() => null);

    // 1. cartes manquantes : catalogue partagé avec « Ma progression » (séries incomplètes relues si besoin)
    st.step = 'Catalogue des séries (voir Ma progression)';
    await setStatus(st);
    const { series, catalog } = await refreshCatalog({ onlyIncomplete: true });
    if (stopFlag) throw new ApiError(0, 'Analyse arrêtée.');
    const incomplete = series.filter((s) => (s.owned ?? 0) < (s.total ?? 0));
    const missing = missingFrom(catalog, series).map(({ owned, event, ...c }) => c);
    const missingIds = new Set(missing.map((c) => c.id));

    // 2. mes exemplaires et mes échanges en cours
    st.step = 'Mes cartes et mes échanges';
    st.done = st.total = 0;
    await setStatus(st);
    const copies = (await get('/copies')).copies ?? [];
    const outgoing = (await get('/trades?box=outgoing')).trades ?? [];
    const reserved = new Set();
    const asked = new Set(); // cartes déjà demandées dans un échange en cours
    for (const t of outgoing) {
      for (const c of t.give ?? []) reserved.add(c.copyId);
      for (const c of t.take ?? []) asked.add(c.card?.id);
    }
    const pool = tradeableDoubles(copies, reserved).filter((c) => c.value > 0).map((c) => ({ ...miniCopy(c) }));
    const poolAll = pool.map((c) => c);
    const ignored = new Set(d.ignored);

    // 3. joueurs candidats : suggestions du jeu, puis serveur Aquaman
    st.step = 'Suggestions du jeu';
    await setStatus(st);
    const players = new Map(); // id -> { player, prefer:Set, hits }
    const sugg = (await get('/trades/suggestions').catch(() => ({ suggestions: [] }))).suggestions ?? [];
    for (const s of sugg) {
      if (!s.player?.id || s.player.id === meId) continue;
      const hits = (s.theyOffer ?? []).filter((c) => missingIds.has(c.card?.id)).length;
      players.set(s.player.id, { player: miniPlayer(s.player), prefer: new Set((s.theyWant ?? []).map((c) => c.card?.id)), hits, source: 'jeu' });
    }

    st.step = 'Serveur Aquaman';
    const lookFor = missing
      .filter((c) => !asked.has(c.id))
      .sort((a, b) => LOOK_ORDER.indexOf(a.rarity) - LOOK_ORDER.indexOf(b.rarity))
      .slice(0, S.relayCards);
    st.total = lookFor.length;
    st.done = 0;
    await setStatus(st);
    const holders = {}; // cardId -> nb de détenteurs connus
    for (const c of lookFor) {
      const h = await relay(`/holdings?card=${encodeURIComponent(c.id)}`);
      const owners = (h?.owners ?? []).map((o) => o.player ?? o).filter((p) => p?.id && p.id !== meId);
      holders[c.id] = owners.length;
      for (const p of owners) {
        const e = players.get(p.id) ?? { player: miniPlayer(p), prefer: new Set(), hits: 0, source: 'aquaman' };
        e.hits++;
        players.set(p.id, e);
      }
      st.done++;
      if (st.done % 5 === 0) await setStatus(st);
      await sleep(250); // le relais est un autre serveur : on reste léger quand même
    }

    // 4. lecture des cartes des joueurs les plus prometteurs
    const ranked = [...players.values()].sort((a, b) => (b.source === 'jeu') - (a.source === 'jeu') || b.hits - a.hits).slice(0, S.maxPlayers);
    st.step = 'Cartes des joueurs';
    st.total = ranked.length;
    st.done = 0;
    await setStatus(st);
    const pc = d.playerCache;
    for (const id of Object.keys(pc)) if (Date.now() - pc[id].at > PLAYER_TTL) delete pc[id];
    const offers = []; // { entry, spares:[copy], owned:Set }
    for (const e of ranked) {
      try {
        const { copies: theirs } = await playerCopies(e.player.id, pc);
        const want = new Set([...missingIds].filter((id) => !asked.has(id) && !ignored.has(`${e.player.id}:${id}`)));
        const spares = [...spareCopiesOf(theirs, want).values()];
        if (spares.length) offers.push({ entry: e, spares, owned: new Set(theirs.map((c) => c.card.id)) });
      } catch (err) {
        if (err.status === 401 || err.status === 429 || err.status >= 500 || stopFlag) throw err;
      }
      st.done++;
      await setStatus(st);
    }
    await store.set({ playerCache: pc });

    // 5. propositions : une carte manquante n'est demandée qu'une fois (au joueur qui en a le plus à céder)
    st.step = 'Calcul des offres';
    await setStatus(st);
    offers.sort((a, b) => b.spares.length - a.spares.length);
    const claimed = new Set();
    const keep = d.proposals.filter((p) => p.status !== 'todo'); // les envoyées / ignorées restent dans l'historique
    const proposals = [];
    for (const o of offers) {
      const take = o.spares.filter((c) => !claimed.has(c.card.id));
      if (!take.length) continue;
      const made = proposalsForPlayer(o.entry.player, take, pool, { prefer: o.entry.prefer, notOwned: o.owned, maxTake: S.maxTake, overpay: S.overpay });
      for (const p of made) {
        p.take.forEach((c) => claimed.add(c.card.id));
        proposals.push({
          id: `${p.player.id}:${p.take.map((c) => c.copyId).join(',')}`,
          player: p.player,
          take: p.take.map(miniCopy),
          give: p.give.map(miniCopy),
          takeValue: p.takeValue,
          giveValue: p.giveValue,
          fit: p.fit,
          source: o.entry.source,
          status: 'todo',
          createdAt: Date.now()
        });
      }
      if (proposals.length >= S.maxProposals) break;
    }

    // 6. résumé pour la page
    const byRarity = {};
    for (const r of RARITY_ORDER) byRarity[r] = { missing: 0, doubles: 0, doublesValue: 0 };
    for (const c of missing) if (byRarity[c.rarity]) byRarity[c.rarity].missing++;
    for (const c of poolAll) if (byRarity[c.card.rarity]) {
      byRarity[c.card.rarity].doubles++;
      byRarity[c.card.rarity].doublesValue += c.value;
    }
    const missingOut = missing
      .map((c) => ({ ...c, holders: holders[c.id] ?? null, asked: asked.has(c.id), proposed: claimed.has(c.id) }))
      .sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name));
    const summary = {
      at: Date.now(),
      perles: me.perles,
      owned: me.owned,
      total: me.total,
      missing: missing.length,
      incompleteSeries: incomplete.length,
      series: incomplete.map((s) => ({ id: s.id, title: s.title, owned: s.owned, total: s.total })).sort((a, b) => b.total - b.owned - (a.total - a.owned)),
      doubles: poolAll.length,
      doublesValue: poolAll.reduce((s, c) => s + c.value, 0),
      copiesCapped: copies.length >= 2000,
      byRarity,
      playersRead: ranked.length,
      reserved: reserved.size
    };
    await store.set({ proposals: [...proposals, ...keep].slice(0, 400), summary, missing: missingOut });
    await refreshTrades(true);
    await log('ok', `Analyse terminée : ${missing.length} cartes manquantes, ${poolAll.length} doubles échangeables, ${proposals.length} propositions.`);
    await setStatus({ running: false, error: null, lastScan: Date.now() });
    return { ok: true, proposals: proposals.length };
  } catch (e) {
    await log('err', e.message || String(e));
    await setStatus({ running: false, error: e.message || String(e) });
    return { error: e.message || String(e) };
  } finally {
    busy = false;
  }
}

// ---------- envoi (toujours après confirmation sur la page) ----------
export async function send(id) {
  const d = await data();
  const p = d.proposals.find((x) => x.id === id);
  if (!p) return { error: 'Proposition introuvable : relance l’analyse.' };
  if (p.status !== 'todo') return { error: 'Cette proposition a déjà été traitée.' };
  if (p.give.length > MAX_SIDE || p.take.length > MAX_SIDE || !isBalanced(p.giveValue, p.takeValue)) return { error: 'Échange refusé par la règle d’équilibre du site.' };
  try {
    // vérifie que le joueur a toujours ces cartes (sa liste peut avoir bougé)
    const fresh = (await get(`/players/${encodeURIComponent(p.player.id)}/copies`)).copies ?? [];
    const ids = new Set(fresh.filter((c) => !c.locked && !c.bound && !c.protected).map((c) => c.copyId));
    const gone = p.take.filter((c) => !ids.has(c.copyId));
    if (gone.length) throw new ApiError(0, `${p.player.name ?? 'Le joueur'} n’a plus : ${gone.map((c) => c.card.name).join(', ')}. Relance l’analyse.`);
    const trade = await post('/trades', {
      to: p.player.id,
      give: p.give.map((c) => c.copyId),
      take: p.take.map((c) => c.copyId),
      givePerles: 0,
      takePerles: 0,
      message: String(d.settings.message || '').replaceAll('{cartes}', names(p.take)).slice(0, 200),
      parentId: null
    });
    p.status = 'sent';
    p.tradeId = trade?.id ?? null;
    p.sentAt = Date.now();
    d.sent[p.tradeId ?? p.id] = { proposalId: p.id, status: 'open', sentAt: p.sentAt, player: p.player, take: p.take, give: p.give, takeValue: p.takeValue, giveValue: p.giveValue };
    // les doubles donnés ne doivent plus servir dans les autres propositions
    const used = new Set(p.give.map((c) => c.copyId));
    for (const o of d.proposals) if (o.status === 'todo' && o.id !== p.id && o.give.some((c) => used.has(c.copyId))) o.status = 'stale';
    await store.set({ proposals: d.proposals, sent: d.sent });
    await log('ok', `Échange envoyé à ${p.player.name ?? p.player.id} : ${p.take.map((c) => c.card.name).join(', ')} contre ${p.give.length} carte(s).`);
    ensureAlarm();
    return { ok: true };
  } catch (e) {
    p.error = e.message || String(e);
    await store.set({ proposals: d.proposals });
    await log('err', `Envoi à ${p.player.name ?? p.player.id} : ${p.error}`);
    return { error: p.error };
  }
}

export async function ignore(id) {
  const d = await data();
  const p = d.proposals.find((x) => x.id === id);
  if (!p) return { ok: true };
  p.status = 'ignored';
  const ign = new Set(d.ignored);
  for (const c of p.take) ign.add(`${p.player.id}:${c.card.id}`);
  await store.set({ proposals: d.proposals, ignored: [...ign].slice(-2000) });
  return { ok: true };
}

// ---------- suivi des échanges ----------
export async function refreshTrades(quiet = false) {
  const d = await data();
  try {
    const out = (await get('/trades?box=outgoing')).trades ?? [];
    const hist = (await get('/trades?box=history')).trades ?? [];
    const incoming = (await get('/trades?box=incoming')).trades ?? [];
    const all = new Map([...hist, ...out].map((t) => [t.id, t]));
    const news = [];
    for (const [tid, s] of Object.entries(d.sent)) {
      const t = all.get(tid);
      if (!t) continue;
      if (t.status !== s.status) {
        s.status = t.status;
        s.closedAt = t.status === 'open' ? null : Date.now();
        if (t.status === 'accepted') news.push(s);
      }
    }
    const brief = (t) => ({ id: t.id, status: t.status, from: miniPlayer(t.from ?? {}), to: miniPlayer(t.to ?? {}), give: (t.give ?? []).map(miniCopy), take: (t.take ?? []).map(miniCopy), givePerles: t.givePerles ?? 0, takePerles: t.takePerles ?? 0, createdAt: t.createdAt ?? null });
    await store.set({ sent: d.sent, trades: { at: Date.now(), outgoing: out.map(brief), history: hist.slice(0, 100).map(brief), incoming: incoming.map(brief) } });
    if (d.settings.notify)
      for (const s of news)
        chrome.notifications.create(`completer-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Échange accepté',
          message: `${s.player.name ?? 'Un joueur'} t’a donné ${s.take.map((c) => c.card.name).join(', ')}.`,
          priority: 1
        });
    return { ok: true };
  } catch (e) {
    if (!quiet) await log('err', 'Suivi des échanges : ' + (e.message || e));
    return { error: e.message || String(e) };
  }
}

async function ensureAlarm() {
  const { sent = {} } = await store.get({ sent: {} });
  const open = Object.values(sent).some((s) => s.status === 'open');
  if (open) {
    if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { delayInMinutes: 15, periodInMinutes: 15 });
  } else chrome.alarms.clear(ALARM);
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM || busy) return;
  await refreshTrades(true);
  ensureAlarm();
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith('completer-')) return;
  chrome.notifications.clear(id);
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/completer.html') });
});

export function start() {
  ensureAlarm();
}

export async function handleMessage(type, msg = {}) {
  switch (type) {
    case 'scan':
      scan(); // longue : la page suit l'avancement dans le stockage
      return { ok: true };
    case 'stop':
      stopFlag = true;
      stopCatalog();
      return { ok: true };
    case 'send':
      return send(msg.id);
    case 'ignore':
      return ignore(msg.id);
    case 'restore': {
      const d = await data();
      const p = d.proposals.find((x) => x.id === msg.id);
      if (p && (p.status === 'ignored' || p.status === 'stale')) {
        p.status = 'todo';
        delete p.error;
        const ign = new Set(d.ignored);
        for (const c of p.take) ign.delete(`${p.player.id}:${c.card.id}`);
        await store.set({ proposals: d.proposals, ignored: [...ign] });
      }
      return { ok: true };
    }
    case 'refresh':
      return refreshTrades();
    case 'settings': {
      const d = await data();
      const clean = {};
      if (typeof msg.settings?.message === 'string') clean.message = msg.settings.message.slice(0, 200);
      if (msg.settings?.overpay != null) clean.overpay = Math.min(0.5, Math.max(0, Number(msg.settings.overpay) || 0));
      if (msg.settings?.maxTake != null) clean.maxTake = Math.min(MAX_SIDE, Math.max(1, Math.round(Number(msg.settings.maxTake) || 1)));
      if (msg.settings?.notify != null) clean.notify = !!msg.settings.notify;
      await store.set({ settings: { ...d.settings, ...clean } });
      return { ok: true };
    }
    case 'clearLog':
      await store.set({ log: [] });
      return { ok: true };
    default:
      return { error: 'unknown' };
  }
}
