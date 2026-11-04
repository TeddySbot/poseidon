// Aquaman (perso) : service de fond.
// Réunit trois outils :
//   - Aquaman (A-Finch13, MIT) nettoyé : plus de relais, plus de télémétrie, plus d'installateur PowerShell ;
//   - Alertes Marché (src/modules/alertes.js) ;
//   - Vente auto (src/modules/vente.js).
// Seules adresses contactées : poseidon-scans.net, et api.github.com uniquement si un jeton GitHub est enregistré
// (vérification de nouvelle version sur le dépôt privé de Teddy).
import { ORIGIN, answer, getSettings, gameStatus } from './lib/aquaman.js';
import { setBadge, COLORS } from './lib/badge.js';
import { checkUpdate, RELEASES_URL } from './lib/update.js';
import * as alertes from './modules/alertes.js';
import * as vente from './modules/vente.js';

const POLL_ALARM = 'aquaman-poll';
const UPDATE_ALARM = 'aquaman-update-check';
const ICON = chrome.runtime.getURL('icons/icon128.png');
const OWN_NOTIFS = new Set(['boosters', 'update', 'updated']); // notifications d'Aquaman (les autres sont aux modules)

async function schedule() {
  await chrome.alarms.clear('aquaman-feed'); // alarmes de l'original, si elles traînent encore
  await chrome.alarms.clear('aquaman-update');
  if ((await chrome.alarms.get(POLL_ALARM))?.periodInMinutes !== 5) await chrome.alarms.create(POLL_ALARM, { delayInMinutes: 0.5, periodInMinutes: 5 });
  if ((await chrome.alarms.get(UPDATE_ALARM))?.periodInMinutes !== 360) await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) pollBoosters();
  if (a.name === UPDATE_ALARM) lookForUpdate();
});

// ---------- notifications ----------

async function notify(id, { title, message, href }) {
  await chrome.storage.local.set({ [`notif:${id}`]: href ?? null });
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1 });
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (!OWN_NOTIFS.has(id)) return;
  const key = `notif:${id}`;
  const href = (await chrome.storage.local.get(key))[key];
  chrome.notifications.clear(id);
  chrome.storage.local.remove(key);
  if (href) openSite(href);
});

// Ouvre une page du site, ou la page des versions sur GitHub. Toute autre adresse est ignorée.
async function openSite(href) {
  const s = String(href);
  if (s === RELEASES_URL || s.startsWith(RELEASES_URL + '/')) return void chrome.tabs.create({ url: s });
  const url = s.startsWith('/') ? ORIGIN + s : s;
  if (!url.startsWith(`${ORIGIN}/`)) return;
  const [tab] = await chrome.tabs.query({ url: `${ORIGIN}/*` }).catch(() => []);
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    if (tab.windowId != null) chrome.windows?.update(tab.windowId, { focused: true }).catch(() => {});
  } else chrome.tabs.create({ url });
}

// ---------- boosters en attente ----------

async function onStatus(pending) {
  setBadge('boosters', pending > 0 ? { text: String(Math.min(pending, 99)), color: COLORS.boosters } : null);
  await chrome.storage.local.set({ boostersPending: pending });
  const { lastPending = 0 } = await chrome.storage.local.get('lastPending');
  await chrome.storage.local.set({ lastPending: pending });
  if (pending > lastPending && (await getSettings()).notifyBoosters)
    notify('boosters', { title: pending > 1 ? `${pending} boosters à ouvrir` : 'Un booster à ouvrir', message: 'Ils t’attendent sur l’accueil du jeu.', href: '/jeu' });
}

async function pollBoosters() {
  try {
    await onStatus((await gameStatus()).pending);
  } catch (e) {
    if (e?.status === 401) {
      setBadge('boosters', { text: '!', color: COLORS.grey });
      await chrome.storage.local.set({ boostersPending: -1 });
    }
  }
}

// ---------- nouvelle version (dépôt GitHub de Teddy) ----------

async function lookForUpdate(force = false) {
  const res = await checkUpdate(force);
  if (!res?.update) return res;
  const { updateNotified } = await chrome.storage.local.get('updateNotified');
  if (updateNotified !== res.update.version) {
    await chrome.storage.local.set({ updateNotified: res.update.version });
    notify('update', { title: `Aquaman perso ${res.update.version} est disponible`, message: 'Fais « git pull » dans ton dossier, ou télécharge le zip. Clique pour ouvrir la page.', href: RELEASES_URL });
  }
  return res;
}

async function announceUpdate(previousVersion) {
  const version = chrome.runtime.getManifest().version;
  if (!previousVersion || previousVersion === version || !(await getSettings()).notifyUpdated) return;
  notify('updated', { title: `Aquaman perso est passé en ${version}`, message: 'Clique pour voir les nouveautés de cette version.', href: '/jeu#aqm-nouveautes' });
}

// ---------- démarrage ----------

function startAll() {
  schedule();
  pollBoosters();
  alertes.start();
  vente.start();
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.storage.local.remove(['update', 'updateCheckedAt', 'adminDevice', 'globalPacks', 'helloAt', 'helloKind', 'helloFor']);
  if (reason === 'update') announceUpdate(previousVersion);
  startAll();
  lookForUpdate(true);
});
chrome.runtime.onStartup.addListener(startAll);
// Le service est relancé par Chrome sans événement (après une mise en veille) : les boucles reprennent ici.
alertes.start();
vente.start();

// ---------- messages ----------

async function handle(msg) {
  const type = String(msg?.type ?? '');
  if (type.startsWith('alertes:')) return alertes.handleMessage(type.slice(8));
  if (type.startsWith('vente:')) return vente.handleMessage(type.slice(6));
  switch (type) {
    case 'status':
      await onStatus(msg.pending ?? 0);
      return { ok: true };
    case 'check-update':
      return (await lookForUpdate(!!msg.force)) ?? { ok: true };
    case 'install-update':
      return { error: 'disabled' };
    case 'open':
      await openSite(msg.href);
      return { ok: true };
    default:
      return answer(msg);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false; // seulement l'extension elle-même
  handle(msg).then(reply, (e) => reply({ error: e?.message || String(e) }));
  return true;
});
