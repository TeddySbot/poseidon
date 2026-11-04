// Version téléphone (script) : le travail du service de fond de l'extension, fait dans la page.
// Pas de badge, de notifications, d'Alertes Marché ni de Vente auto ici (ils ont besoin d'un service qui tourne
// même page fermée) : seulement les fonctions d'Aquaman sur le site et la synchro entre appareils.
const UPDATE_EVERY = 10 * 60e3;
const SCRIPT_REPO = 'TeddySbot/poseidon';
const SCRIPT_DOWNLOAD = `https://github.com/${SCRIPT_REPO}/releases/latest/download/aquaman-perso.user.js`;

const versionNewer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// La version publiée sur le dépôt, quand elle est plus récente que ce script (regardé toutes les 10 min au plus).
async function scriptUpdate() {
  const { updateCheckedAt = 0, scriptLatest } = await chrome.storage.local.get(['updateCheckedAt', 'scriptLatest']);
  let latest = scriptLatest;
  if (Date.now() - updateCheckedAt >= UPDATE_EVERY) {
    await chrome.storage.local.set({ updateCheckedAt: Date.now() });
    try {
      const res = await fetch(`https://api.github.com/repos/${SCRIPT_REPO}/contents/aquaman-perso/manifest.json?ref=main`, {
        headers: { accept: 'application/vnd.github.raw+json' },
        cache: 'no-store'
      });
      if (res.ok) {
        latest = String((await res.json()).version ?? '');
        await chrome.storage.local.set({ scriptLatest: latest });
      }
    } catch {}
  }
  return { update: latest && versionNewer(latest, VERSION) ? { version: latest, script: SCRIPT_DOWNLOAD } : null };
}

async function handle(msg) {
  switch (msg?.type) {
    case 'status':
      return { ok: true };
    case 'check-update':
      return scriptUpdate();
    case 'install-update':
      return { error: 'userscript' };
    case 'open':
      if (String(msg.href).startsWith('/') || String(msg.href).startsWith(location.origin + '/')) location.assign(msg.href);
      return { ok: true };
    default:
      return answer(msg);
  }
}
