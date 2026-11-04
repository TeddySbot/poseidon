// Nouvelle version d'Aquaman perso, lue sur le dépôt GitHub public de Teddy (api.github.com, sans compte ni jeton).
// Rien n'est installé tout seul : l'extension prévient, la mise à jour se fait avec le zip ou « git pull ».
export const REPO = 'TeddySbot/poseidon';
export const BRANCH = 'main';
export const MANIFEST_PATH = 'aquaman-perso/manifest.json';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
const EVERY = 6 * 3600e3;

export const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// { update: {version} | null, checkedAt, error }
export async function checkUpdate(force = false) {
  const { updateState } = await chrome.storage.local.get('updateState');
  if (!force && updateState && Date.now() - (updateState.checkedAt ?? 0) < EVERY) return updateState;
  let state;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${MANIFEST_PATH}?ref=${BRANCH}`, {
      headers: { accept: 'application/vnd.github.raw+json', 'x-github-api-version': '2022-11-28' },
      cache: 'no-store'
    });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub limite les vérifications pour le moment : nouvel essai plus tard.');
    if (res.status === 404) throw new Error(`Dépôt ${REPO} introuvable (encore privé ?).`);
    if (!res.ok) throw new Error(`GitHub répond ${res.status}.`);
    const remote = String((await res.json()).version ?? '');
    const mine = chrome.runtime.getManifest().version;
    state = { checkedAt: Date.now(), remote, update: remote && newer(remote, mine) ? { version: remote } : null, error: null };
  } catch (e) {
    state = { checkedAt: Date.now(), update: updateState?.update ?? null, error: e?.message || String(e) };
  }
  await chrome.storage.local.set({ updateState: state });
  return state;
}
