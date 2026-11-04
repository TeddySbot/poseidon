import { ORIGIN, getSettings, setSettings } from '../lib/aquaman.js';

const $ = (s) => document.querySelector(s);

// Liens : uniquement des pages du site (via le service de fond).
document.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-open]');
  if (!link) return;
  e.preventDefault();
  await chrome.runtime.sendMessage({ type: 'open', href: link.dataset.open });
  window.close();
});

async function bindSettings() {
  const settings = await getSettings();
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = !!settings[box.dataset.setting];
    box.addEventListener('change', () => setSettings({ [box.dataset.setting]: box.checked }));
  }
}

async function renderStatus() {
  const text = await chrome.action.getBadgeText({});
  $('#status').textContent =
    text === '!' ? `Connecte-toi sur ${ORIGIN.replace('https://', '')} pour voir tes boosters.` : text ? `${text} booster${text === '1' ? '' : 's'} à ouvrir sur l’accueil du jeu.` : 'Aucun booster à ouvrir pour le moment.';
}

$('#version').textContent = chrome.runtime.getManifest().version;
bindSettings();
renderStatus();
