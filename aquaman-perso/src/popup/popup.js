// Fenêtre d'Aquaman perso : onglets, accueil, réglages, mises à jour.
import { ORIGIN, getSettings, setSettings } from '../lib/aquaman.js';
import { RELEASES_URL, REPO } from '../lib/update.js';

const $ = (s) => document.querySelector(s);

// ---------- onglets (onglet retenu entre deux ouvertures) ----------
export function showTab(t) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  for (const p of ['home', 'alertes', 'vente']) $(`#pane-${p}`).hidden = p !== t;
  try {
    localStorage.setItem('aqm-tab', t);
  } catch {}
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
try {
  const t = localStorage.getItem('aqm-tab');
  if (t) showTab(t);
} catch {}

// ---------- liens : pages du site, ou page des versions ----------
document.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-open]');
  if (!link) return;
  e.preventDefault();
  const href = link.dataset.open === 'releases' ? RELEASES_URL : link.dataset.open;
  await chrome.runtime.sendMessage({ type: 'open', href });
  window.close();
});

// ---------- Compléter ma collection ----------
document.getElementById('openCompleter')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/completer.html') });
  window.close();
});

document.getElementById('openDoubles')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/doubles.html') });
  window.close();
});

document.getElementById('openProgression')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/progression.html') });
  window.close();
});

// ---------- réglages ----------
async function bindSettings() {
  const settings = await getSettings();
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = !!settings[box.dataset.setting];
    box.addEventListener('change', () => setSettings({ [box.dataset.setting]: box.checked }));
  }
}

// ---------- Aquaman sur le site (interrupteur) ----------
// Coupé : plus rien n'est ajouté aux pages du jeu ; Vente auto, Alertes et le reste continuent en arrière-plan.
async function bindSite() {
  const box = $('#siteToggle');
  const info = $('#siteInfo');
  const say = (on) => (info.textContent = on ? 'Activé : panneaux et outils d’Aquaman affichés sur le jeu.' : 'Coupé : le site s’affiche normalement. Vente auto et Alertes continuent.');
  const r = await chrome.runtime.sendMessage({ type: 'site-get' }).catch(() => null);
  box.checked = r?.enabled !== false;
  say(box.checked);
  box.addEventListener('change', async () => {
    box.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'site-set', enabled: box.checked }).catch((e) => ({ error: e.message }));
    box.disabled = false;
    if (res?.error) {
      box.checked = !box.checked;
      info.textContent = 'Erreur : ' + res.error;
    } else say(box.checked);
  });
}

// ---------- boosters ----------
async function renderStatus() {
  const { boostersPending } = await chrome.storage.local.get('boostersPending');
  $('#status').textContent =
    boostersPending === -1
      ? `Connecte-toi sur ${ORIGIN.replace('https://', '')} pour voir tes boosters.`
      : boostersPending > 0
        ? `${boostersPending} booster${boostersPending === 1 ? '' : 's'} à ouvrir sur l’accueil du jeu.`
        : 'Aucun booster à ouvrir pour le moment.';
}

// ---------- mises à jour ----------
const ago = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

async function renderUpdate() {
  const { updateState: st } = await chrome.storage.local.get('updateState');
  $('#update').hidden = !st?.update;
  if (st?.update) $('#update-version').textContent = st.update.version;
  const info = $('#updateInfo');
  info.style.color = st?.error ? 'var(--bad)' : '';
  info.textContent = st?.error
    ? st.error
    : st?.checkedAt
      ? st.update
        ? `Version ${st.update.version} disponible (vérifié le ${ago(st.checkedAt)}).`
        : `À jour (vérifié le ${ago(st.checkedAt)}).`
      : `Pas encore vérifié. Dépôt : ${REPO}.`;
}

// ---------- mise à jour en un clic (assistant installé par installer-mises-a-jour.bat) ----------
const UPD_ERRORS = {
  no_updater: 'Assistant de mise à jour absent : double-clic sur installer-mises-a-jour.bat (une seule fois).',
  unknown_extension: 'Le dossier de l’extension a changé : relance installer-mises-a-jour.bat.',
  git_failed: 'git pull a échoué (modifications locales ?) : ',
  download_failed: 'Téléchargement impossible depuis GitHub : ',
  bad_checksum: 'Empreinte de la version absente ou illisible : mise à jour annulée.',
  checksum_mismatch: 'Le fichier téléchargé ne correspond pas à l’empreinte publiée : mise à jour annulée.',
  bad_package: 'Le paquet téléchargé n’est pas Aquaman (perso) : mise à jour annulée.',
  copy_failed: 'Copie impossible (fichier ouvert ?) : l’ancienne version a été remise. ',
  no_backup: 'Aucune sauvegarde à remettre.',
  git_rollback: 'Dossier Git : reviens en arrière avec git (ex. git checkout <version>).',
  bad_version: 'Numéro de version invalide.',
  up_to_date: 'Déjà à jour.'
};
const updError = (r) => {
  const base = UPD_ERRORS[r?.error] ?? `Erreur : ${r?.error || 'inconnue'}. `;
  return /(: |\. )$/.test(base) && r?.detail ? base + String(r.detail).slice(0, 200) : base.trim();
};

async function renderUpdater() {
  const r = await chrome.runtime.sendMessage({ type: 'updater-ping' }).catch(() => null);
  const ok = !!r?.installed;
  $('#upd-ready').hidden = !ok;
  $('#upd-setup').hidden = ok;
  const info = $('#updaterInfo');
  info.replaceChildren();
  info.append(ok ? `Mise à jour en un clic : prête${r.git ? ' (dossier Git : git pull)' : ''}.` : 'Mise à jour en un clic : pas installée (installer-mises-a-jour.bat, une seule fois).');
  if (ok && r.backups?.length) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'link';
    back.textContent = 'Revenir à la version précédente';
    back.addEventListener('click', async () => {
      if (back.dataset.armed !== '1') {
        back.dataset.armed = '1';
        back.textContent = 'Confirmer le retour arrière';
        return;
      }
      back.disabled = true;
      info.lastChild.textContent = ' Retour arrière…';
      const res = await chrome.runtime.sendMessage({ type: 'rollback-update' }).catch((e) => ({ error: e.message }));
      info.lastChild.textContent = res?.ok ? ` Version ${res.version} remise, rechargement…` : ' ' + updError(res);
    });
    info.append(' ', back, document.createElement('span'));
  }
}

$('#installUpdate').addEventListener('click', async () => {
  const b = $('#installUpdate');
  b.disabled = true;
  b.textContent = 'Mise à jour…';
  $('#upd-msg').textContent = 'Téléchargement et vérification de la nouvelle version…';
  const r = await chrome.runtime.sendMessage({ type: 'install-update' }).catch((e) => ({ error: e.message }));
  if (r?.ok) $('#upd-msg').textContent = `Version ${r.version} installée. L’extension redémarre ; recharge la page du jeu.`;
  else {
    $('#upd-msg').textContent = updError(r);
    $('#upd-msg').style.color = 'var(--bad)';
    b.disabled = false;
    b.textContent = 'Réessayer';
    renderUpdater();
  }
});

$('#checkNow').addEventListener('click', async () => {
  $('#updateInfo').textContent = 'Vérification…';
  await chrome.runtime.sendMessage({ type: 'check-update', force: true }).catch(() => {});
  renderUpdate();
renderUpdater();
});

// ---------- synchro entre appareils (Gist privé) ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids.filter((k) => k != null));
  return e;
}
async function renderSync() {
  const r = await chrome.runtime.sendMessage({ type: 'sync-info' }).catch(() => null);
  const pill = $('#syncPill');
  const box = $('#syncInfo');
  box.replaceChildren();
  pill.className = 'pill ' + (r?.linked ? (r.state?.error ? 'sim' : 'real') : 'off');
  pill.textContent = r?.linked ? (r.state?.error ? 'Erreur' : 'Reliée') : 'Non reliée';
  $('#syncToken').placeholder = r?.linked ? '•••••••• (jeton enregistré, vide = délier)' : 'Jeton GitHub (Gists)';
  $('#syncSave').textContent = r?.linked ? 'Changer' : 'Relier';
  if (r?.player) {
    const copy = el('button', { type: 'button', class: 'link' }, 'copier');
    copy.addEventListener('click', () => navigator.clipboard.writeText(r.player).then(() => (copy.textContent = 'copié ✔')));
    box.append(el('p', {}, 'Ton identifiant joueur : ', el('code', {}, r.player), ' ', copy));
  }
  if (!r?.linked) return;
  if (r.state?.error) box.append(el('p', { style: 'color: var(--bad)' }, r.state.error));
  const devs = r.state?.devices ?? [];
  if (devs.length) box.append(el('p', {}, 'Boosters comptés : ' + devs.map((d) => `${d.name} ${d.count}`).join(' · ')));
  if (r.gist) {
    const a = el('a', { href: `https://gist.github.com/${r.gist}`, target: '_blank', rel: 'noopener' }, 'voir le Gist');
    box.append(el('p', {}, 'Gist : ', el('code', {}, r.gist.slice(0, 10) + '…'), ' · ', a));
  }
}
$('#syncSave').addEventListener('click', async () => {
  const token = $('#syncToken').value.trim();
  const { syncToken } = await chrome.storage.local.get('syncToken');
  if (!token && !syncToken) return;
  $('#syncSave').disabled = true;
  $('#syncInfo').textContent = token ? 'Connexion à GitHub…' : 'Synchro coupée.';
  const res = await chrome.runtime.sendMessage({ type: 'sync-setup', token }).catch((e) => ({ error: e.message }));
  $('#syncToken').value = '';
  $('#syncSave').disabled = false;
  await renderSync();
  if (res?.error) $('#syncInfo').prepend(el('p', { style: 'color: var(--bad)' }, res.error));
});

$('#version').textContent = chrome.runtime.getManifest().version;
renderSync();
bindSite();
bindSettings();
renderStatus();
renderUpdate();
renderUpdater();
