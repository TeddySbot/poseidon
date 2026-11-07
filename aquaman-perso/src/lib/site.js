// Interrupteur « Aquaman sur le site » : les scripts des pages (inject.js, tutorial.js, content.js) sont enregistrés
// ici plutôt que dans le manifeste, pour pouvoir les couper sans toucher au reste (Vente auto, Alertes, Compléter,
// Progression tournent dans le service de fond et continuent).
const KEY = 'siteEnabled';
const MATCHES = ['https://poseidon-scans.net/*'];
const SCRIPTS = [
  { id: 'aqm-inject', matches: MATCHES, js: ['src/content/inject.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
  { id: 'aqm-content', matches: MATCHES, js: ['src/content/tutorial.js', 'src/content/content.js'], css: ['src/content/content.css'], runAt: 'document_idle', persistAcrossSessions: true }
];

export async function siteEnabled() {
  const v = (await chrome.storage.local.get(KEY))[KEY];
  return v !== false; // activé par défaut
}

// Met les scripts des pages en accord avec le réglage.
export async function applySite() {
  const on = await siteEnabled();
  const ids = SCRIPTS.map((s) => s.id);
  const have = (await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => [])).map((s) => s.id);
  if (on) {
    const missing = SCRIPTS.filter((s) => !have.includes(s.id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing);
  } else if (have.length) await chrome.scripting.unregisterContentScripts({ ids: have });
  return on;
}

// Change le réglage puis recharge les onglets du jeu ouverts (pour retirer ou remettre Aquaman tout de suite).
export async function setSite(on, reloadTabs = true) {
  await chrome.storage.local.set({ [KEY]: !!on });
  await applySite();
  if (reloadTabs) {
    const tabs = await chrome.tabs.query({ url: MATCHES }).catch(() => []);
    for (const t of tabs) chrome.tabs.reload(t.id).catch(() => {});
  }
  return { ok: true, enabled: !!on };
}
