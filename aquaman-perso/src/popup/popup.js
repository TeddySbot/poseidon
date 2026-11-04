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

// ---------- réglages ----------
async function bindSettings() {
  const settings = await getSettings();
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = !!settings[box.dataset.setting];
    box.addEventListener('change', () => setSettings({ [box.dataset.setting]: box.checked }));
  }
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

$('#checkNow').addEventListener('click', async () => {
  $('#updateInfo').textContent = 'Vérification…';
  await chrome.runtime.sendMessage({ type: 'check-update', force: true }).catch(() => {});
  renderUpdate();
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
bindSettings();
renderStatus();
renderUpdate();
