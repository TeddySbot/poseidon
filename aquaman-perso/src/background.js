// Aquaman (perso) : service de fond.
// Réunit trois outils :
//   - Aquaman (A-Finch13, MIT) nettoyé : plus de relais, plus de télémétrie, plus d'installateur PowerShell ;
//   - Alertes Marché (src/modules/alertes.js) ;
//   - Vente auto (src/modules/vente.js) ;
//   - Compléter ma collection (src/modules/completer.js) : propositions d'échange, envoyées seulement après confirmation ;
//   - Ma progression (src/modules/progression.js) : avancement par rareté et par série, photo quotidienne ;
//   - Mes doubles (src/modules/doubles.js) : exemplaires en trop, mise en vente après confirmation (on garde le plus petit #serial).
// Seules adresses contactées : poseidon-scans.net, et api.github.com toutes les 6 h (version publiée sur le dépôt de Teddy).
import { ORIGIN, answer, getSettings, gameStatus } from './lib/aquaman.js';
import { setBadge, COLORS } from './lib/badge.js';
import { checkUpdate, RELEASES_URL } from './lib/update.js';
import * as alertes from './modules/alertes.js';
import * as vente from './modules/vente.js';
import * as completer from './modules/completer.js';
import * as progression from './modules/progression.js';
import * as doubles from './modules/doubles.js';
import { applySite, setSite, siteEnabled } from './lib/site.js';

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

// ---------- mise à jour en un clic ----------
// L'assistant (updater/host.ps1, installé une fois par installer-mises-a-jour.bat) télécharge la release GitHub,
// vérifie son empreinte SHA-256, sauvegarde l'ancienne version et remplace les fichiers. L'extension se recharge ensuite.
const UPDATER = 'com.teddysbot.aquaman_perso';

async function native(msg) {
  try {
    return await chrome.runtime.sendNativeMessage(UPDATER, msg);
  } catch (e) {
    return { error: 'no_updater', detail: e?.message || String(e) };
  }
}

async function updaterPing() {
  const r = await native({ action: 'ping' });
  return r?.ok ? { installed: true, version: r.version, git: !!r.git, backups: [].concat(r.backups ?? []) } : { installed: false, error: r?.error };
}

async function installUpdate() {
  const st = await checkUpdate(true);
  if (!st?.update) return { error: st?.error ? 'download_failed' : 'up_to_date', detail: st?.error ?? null };
  const r = await native({ action: 'update', version: st.update.version });
  if (r?.ok) {
    await chrome.storage.local.set({ updateState: { ...st, update: null } });
    setTimeout(() => chrome.runtime.reload(), 1500);
  }
  return r;
}

async function rollbackUpdate() {
  const r = await native({ action: 'rollback' });
  if (r?.ok) setTimeout(() => chrome.runtime.reload(), 1500);
  return r;
}

// ---------- démarrage ----------

function startAll() {
  applySite().catch(() => {});
  schedule();
  pollBoosters();
  alertes.start();
  vente.start();
  completer.start();
  progression.start();
  doubles.start();
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.storage.local.remove(['update', 'updateCheckedAt', 'adminDevice', 'globalPacks', 'helloAt', 'helloKind', 'helloFor', 'githubToken']);
  if (reason === 'update') announceUpdate(previousVersion);
  startAll();
  lookForUpdate(true);
});
chrome.runtime.onStartup.addListener(startAll);
// Le service est relancé par Chrome sans événement (après une mise en veille) : les boucles reprennent ici.
applySite().catch(() => {});
alertes.start();
vente.start();
completer.start();
progression.start();
doubles.start();

// ---------- messages ----------

async function handle(msg) {
  const type = String(msg?.type ?? '');
  if (type.startsWith('alertes:')) return alertes.handleMessage(type.slice(8));
  if (type.startsWith('vente:')) return vente.handleMessage(type.slice(6));
  if (type.startsWith('completer:')) return completer.handleMessage(type.slice(10), msg);
  if (type.startsWith('progression:')) return progression.handleMessage(type.slice(12));
  if (type.startsWith('doubles:')) return doubles.handleMessage(type.slice(8), msg);
  switch (type) {
    case 'status':
      await onStatus(msg.pending ?? 0);
      return { ok: true };
    case 'site-get':
      return { enabled: await siteEnabled() };
    case 'site-set':
      return setSite(!!msg.enabled);
    case 'check-update':
      return (await lookForUpdate(!!msg.force)) ?? { ok: true };
    case 'updater-ping':
      return updaterPing();
    case 'install-update':
      return installUpdate();
    case 'rollback-update':
      return rollbackUpdate();
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
