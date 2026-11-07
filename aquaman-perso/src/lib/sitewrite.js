// Écritures vers le jeu (mise en vente) envoyées depuis un onglet poseidon-scans.net :
// le site refuse celles qui viennent directement de l'extension (« Origine de la requête refusée »).
// Même méthode que la Vente auto (modules/vente.js). 25 écritures au plus par tranche de 31 s.

import { SITE, API, ApiError, sleep } from './gameapi.js';

const WRITE_MAX = 25;
const WRITE_WINDOW = 31_000;
const WRITE_DELAY = 300;
let writes = [];
let lastWrite = 0;
let tabId = null;

async function waitLoaded(id) {
  for (let i = 0; i < 30; i++) {
    const t = await chrome.tabs.get(id).catch(() => null);
    if (!t) throw new ApiError(0, "L'onglet poseidon-scans.net a été fermé.");
    if (t.discarded) await chrome.tabs.reload(id);
    else if (t.status === 'complete') return t;
    await sleep(1000);
  }
  throw new ApiError(0, "L'onglet poseidon-scans.net ne finit pas de charger.");
}

async function siteTab() {
  if (tabId != null) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t && (t.url || t.pendingUrl || '').startsWith(SITE)) return waitLoaded(t.id);
    tabId = null;
  }
  const tabs = await chrome.tabs.query({ url: SITE + '/*' });
  let t = tabs.find((x) => x.status === 'complete' && !x.discarded) || tabs[0];
  if (!t) t = await chrome.tabs.create({ url: SITE + '/jeu/marche', active: false, pinned: true });
  tabId = t.id;
  return waitLoaded(t.id);
}

async function inTab(path, method, body) {
  const tab = await siteTab();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [API + path, method, body == null ? null : JSON.stringify(body)],
    func: async (url, m, b) => {
      // aqmVente : Aquaman sur le site ne retraite pas ces ventes
      const r = await fetch(url, { method: m, credentials: 'include', headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b || undefined, aqmVente: true });
      return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
    }
  });
  if (!res?.result) throw new Error("pas de réponse de l'onglet");
  return res.result;
}

// POST/DELETE vers /api-game/v1<path>. Renvoie le JSON ou lève ApiError (status, message).
export async function write(path, method = 'POST', body) {
  for (;;) {
    const now = Date.now();
    writes = writes.filter((t) => now - t < WRITE_WINDOW);
    if (writes.length < WRITE_MAX) break;
    await sleep(writes[0] + WRITE_WINDOW + 300 - now);
  }
  const wait = lastWrite + WRITE_DELAY - Date.now();
  if (wait > 0) await sleep(wait);
  writes.push(Date.now());
  lastWrite = Date.now();
  let r;
  try {
    r = await inTab(path, method, body);
  } catch {
    if (tabId != null) {
      await chrome.tabs.reload(tabId).catch(() => {});
      await sleep(3000);
    }
    try {
      r = await inTab(path, method, body);
    } catch (e2) {
      throw new ApiError(0, "Impossible d'utiliser l'onglet poseidon-scans.net : " + (e2.message || e2));
    }
  }
  if (r.status === 401) throw new ApiError(401, 'Non connecté : connecte-toi sur poseidon-scans.net dans Chrome.');
  if (r.status === 429 || r.status >= 500) throw new ApiError(r.status, `Le site freine (${r.status}) : réessaie dans quelques minutes.`);
  if (!r.ok) throw new ApiError(r.status, r.json?.error?.message || `Erreur ${r.status}`);
  return r.json;
}
