// Nouvelle version d'Aquaman perso, lue sur le dépôt GitHub privé de Teddy.
// Le dépôt étant privé, il faut un jeton GitHub en lecture seule (fine-grained, « Contents: Read-only » sur ce seul
// dépôt), collé dans la fenêtre de l'extension. Il reste dans ce navigateur et n'est envoyé qu'à api.github.com.
// Rien n'est installé tout seul : l'extension prévient, la mise à jour se fait par « git pull » ou avec le zip.
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

// { update: {version} | null, checkedAt, error } ; null quand aucun jeton n'est enregistré.
export async function checkUpdate(force = false) {
  const { githubToken, updateState } = await chrome.storage.local.get(['githubToken', 'updateState']);
  if (!githubToken) return null;
  if (!force && updateState && Date.now() - (updateState.checkedAt ?? 0) < EVERY) return updateState;
  let state;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${MANIFEST_PATH}?ref=${BRANCH}`, {
      headers: { accept: 'application/vnd.github.raw+json', authorization: `Bearer ${githubToken}`, 'x-github-api-version': '2022-11-28' },
      cache: 'no-store'
    });
    if (res.status === 401 || res.status === 403) throw new Error('Jeton refusé par GitHub (expiré ou sans accès au dépôt).');
    if (res.status === 404) throw new Error('Dépôt introuvable : le jeton n’a pas accès à ' + REPO + '.');
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
