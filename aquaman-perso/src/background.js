// Aquaman (perso) : service de fond réduit.
// Retiré par rapport à l'original : recherche de version sur GitHub, assistant de mise à jour (programme PowerShell
// lancé par le navigateur), vidage du cache du site, relevé des « beaux tirages » chaque minute en arrière-plan.
// Restent : le badge des boosters en attente (une lecture de /api-game/v1/me toutes les 5 minutes) et les notifications.
import { ORIGIN, answer, getSettings, gameStatus } from './lib/aquaman.js';

const POLL_ALARM = 'aquaman-poll';
const ICON = chrome.runtime.getURL('icons/icon128.png');

async function schedule() {
  // Anciennes alarmes de l'original (relevé des tirages, mises à jour) supprimées si elles existent encore.
  await chrome.alarms.clear('aquaman-feed');
  await chrome.alarms.clear('aquaman-update');
  if ((await chrome.alarms.get(POLL_ALARM))?.periodInMinutes !== 5) await chrome.alarms.create(POLL_ALARM, { delayInMinutes: 0.5, periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) pollBoosters();
});

// ---------- notifications et badge ----------

async function notify(id, { title, message, href }) {
  await chrome.storage.local.set({ [`notif:${id}`]: href ?? null });
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1 });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const key = `notif:${id}`;
  const href = (await chrome.storage.local.get(key))[key];
  chrome.notifications.clear(id);
  chrome.storage.local.remove(key);
  if (href) openSite(href);
});

// Ouvre une page du site uniquement (toute autre adresse est ignorée).
async function openSite(href) {
  const url = String(href).startsWith('/') ? ORIGIN + href : String(href);
  if (!url.startsWith(`${ORIGIN}/`)) return;
  const [tab] = await chrome.tabs.query({ url: `${ORIGIN}/*` }).catch(() => []);
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    if (tab.windowId != null) chrome.windows?.update(tab.windowId, { focused: true }).catch(() => {});
  } else chrome.tabs.create({ url });
}

function setBadge(pending, loggedOut = false) {
  chrome.action.setBadgeBackgroundColor({ color: loggedOut ? '#71717a' : '#2563eb' });
  chrome.action.setBadgeText({ text: loggedOut ? '!' : pending > 0 ? String(Math.min(pending, 99)) : '' });
}

async function onStatus(pending) {
  setBadge(pending);
  const { lastPending = 0 } = await chrome.storage.local.get('lastPending');
  await chrome.storage.local.set({ lastPending: pending });
  if (pending > lastPending && (await getSettings()).notifyBoosters)
    notify('boosters', {
      title: pending > 1 ? `${pending} boosters à ouvrir` : 'Un booster à ouvrir',
      message: 'Ils t’attendent sur l’accueil du jeu.',
      href: '/jeu'
    });
}

async function pollBoosters() {
  try {
    await onStatus((await gameStatus()).pending);
  } catch (e) {
    if (e?.status === 401) setBadge(0, true);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // Nettoie ce que l'original gardait pour les mises à jour et le relais.
  await chrome.storage.local.remove(['update', 'updateCheckedAt', 'updateNotified', 'adminDevice', 'globalPacks', 'helloAt', 'helloKind', 'helloFor']);
  await schedule();
  pollBoosters();
});

chrome.runtime.onStartup.addListener(() => {
  schedule();
  pollBoosters();
});

// ---------- messages ----------

async function handle(msg) {
  switch (msg?.type) {
    case 'status':
      await onStatus(msg.pending ?? 0);
      return { ok: true };
    case 'check-update':
      return { ok: true }; // plus de mise à jour automatique
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
  // Seules les pages de l'extension et ses scripts sur poseidon-scans.net peuvent lui parler.
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then(reply, (e) => reply({ error: e?.message || String(e) }));
  return true;
});
