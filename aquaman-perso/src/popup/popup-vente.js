// Onglet Vente auto de la fenêtre (ex-popup « Poseidon – Vente auto »).
import { nsStore } from '../lib/store.js';
const store = nsStore("vente:");
const sendV = (type) => chrome.runtime.sendMessage({ type: "vente:" + type }).catch(() => {});
const DEFAULTS = { enabled: false, dryRun: true, maxSlots: 50, floors: { N: 6, R: 13, SR: 51 }, rarities: { N: true, R: true, SR: true }, rotateMin: 60, checkMin: 2, scanHours: 24, writeMax: 25, writeWindowSec: 31, readDelayMs: 1200, countAuctions: true };
const RN = { N: "Commune", R: "Rare", SR: "Épique" };
const $ = id => document.getElementById("v-" + id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hm = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ---------- réglages ----------
async function getSettings() {
  const { settings = {} } = await store.get("settings");
  return { ...DEFAULTS, ...settings, floors: { ...DEFAULTS.floors, ...(settings.floors || {}) }, rarities: { ...DEFAULTS.rarities, ...(settings.rarities || {}) } };
}
async function setSettings(patch) {
  const s = await getSettings();
  await store.set({ settings: { ...s, ...patch,
    floors: { ...s.floors, ...(patch.floors || {}) }, rarities: { ...s.rarities, ...(patch.rarities || {}) } } });
}

// ---------- onglets (onglet retenu entre deux ouvertures) ----------
function showTab(t) {
  document.querySelectorAll(".subtabs button").forEach(b => b.classList.toggle("on", b.dataset.sub === t));
  for (const p of ["activity", "settings", "actions"]) $(p).hidden = p !== t;
  try { localStorage.setItem("aqm-vente-sub", t); } catch {}
}
document.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => showTab(b.dataset.sub));
try { const t = localStorage.getItem("aqm-vente-sub"); if (t) showTab(t); } catch {}

// ---------- commande principale ----------
$("main").onclick = async () => {
  const s = await getSettings();
  if (s.enabled) sendV("stopAll");
  else await setSettings({ enabled: true });
  render();
};
$("sim").onclick = () => setSettings({ dryRun: true }).then(render);
$("real").onclick = () => setSettings({ dryRun: false }).then(render);

// ---------- formulaire réglages ----------
function showEstimate(s) {
  const d = Number(s.readDelayMs) / 1000;
  const mins = n => { const m = n * d / 60; return m < 1 ? "< 1 min" : `≈ ${Math.round(m)} min`; };
  const fill = Math.max(50 * d, Math.ceil(50 / Math.max(1, s.writeMax)) * 31 - 31);
  $("estimate").textContent = `Inventaire ${mins(1250)} · Comptage ${mins(348)} · Remplir 50 ventes ≈ ${fill < 60 ? Math.round(fill) + " s" : Math.round(fill / 60) + " min"}`;
}
async function initForm() {
  const s = await getSettings();
  for (const r of ["N", "R", "SR"]) { $("r" + r).checked = s.rarities[r]; $("f" + r).value = s.floors[r]; $("f" + r).disabled = !s.rarities[r]; }
  $("maxSlots").value = s.maxSlots;
  $("readDelay").value = String(s.readDelayMs);
  if (![...$("readDelay").options].some(o => o.value === String(s.readDelayMs))) $("readDelay").value = "1200";
  $("writeMax").value = s.writeMax;
  showEstimate(s);
}
const clampInt = (v, lo, hi, def) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || def)));
for (const r of ["N", "R", "SR"]) {
  $("r" + r).onchange = e => { $("f" + r).disabled = !e.target.checked; setSettings({ rarities: { [r]: e.target.checked } }); };
  $("f" + r).onchange = e => { const v = clampInt(e.target.value, 1, 100000, 1); e.target.value = v; setSettings({ floors: { [r]: v } }); };
}
$("maxSlots").onchange = e => { const v = clampInt(e.target.value, 1, 50, 50); e.target.value = v; setSettings({ maxSlots: v }); };
$("readDelay").onchange = async e => { await setSettings({ readDelayMs: Number(e.target.value) }); showEstimate(await getSettings()); };
$("writeMax").onchange = async e => { const v = clampInt(e.target.value, 1, 29, 25); e.target.value = v; await setSettings({ writeMax: v }); showEstimate(await getSettings()); };

// ---------- actions ----------
$("stats").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/stats.html") });
$("rotate").onclick = () => { sendV("rotateNow"); showTab("activity"); };
$("rescan").onclick = () => { sendV("rescan"); showTab("activity"); };
$("clearLog").onclick = () => sendV("clearLog");
let armed = null;
$("withdraw").onclick = () => {
  const btn = $("withdraw");
  if (!armed) {
    btn.classList.add("armed"); $("withdrawLab").textContent = "Cliquer encore pour confirmer";
    armed = setTimeout(() => { armed = null; btn.classList.remove("armed"); $("withdrawLab").textContent = "Tout retirer et arrêter"; }, 4000);
    return;
  }
  clearTimeout(armed); armed = null; btn.classList.remove("armed"); $("withdrawLab").textContent = "Tout retirer et arrêter";
  sendV("withdrawAll");
  showTab("activity");
};

// ---------- affichage en direct ----------
async function render() {
  const { status = {}, run = {}, log = [] } = await store.get(["status", "run", "log"]);
  const s = await getSettings();

  // en-tête + commande
  const head = document.getElementById("headPill");
  for (const pill of [$("pill"), head]) pill.className = "pill " + (!s.enabled ? "off" : s.dryRun ? "sim" : "real");
  $("pill").textContent = !s.enabled ? "Arrêtée" : s.dryRun ? "Simulation" : "Réel";
  head.textContent = s.dryRun ? "Vente : SIM" : "Vente : réel";
  head.hidden = !s.enabled;
  $("pill").hidden = !s.enabled;
  $("main").className = "btn grow " + (s.enabled ? "stop" : "go");
  $("main").textContent = s.enabled ? "⏹ Tout arrêter" : "▶ Démarrer";
  $("sim").classList.toggle("on", s.dryRun); $("real").classList.toggle("on", !s.dryRun);

  // état
  $("phase").textContent = s.enabled || status.counting ? (status.phase || "Démarrage…") : "Arrêtée";
  $("dot").className = "dot " + (status.error ? "err" : (s.enabled || status.counting) ? "run" : "");

  const sc = status.scan, cnt = status.counting;
  let pr = null;
  if (cnt) pr = { v: cnt.done, t: cnt.total, lab: `Comptage : séries ${cnt.done}/${cnt.total || "…"}` };
  else if (sc?.phase === "cards") pr = { v: sc.series, t: sc.seriesTotal, lab: `Inventaire 1/2 : séries ${sc.series}/${sc.seriesTotal}` };
  else if (sc?.phase === "detail") pr = { v: sc.detail, t: sc.detailTotal, lab: `Inventaire 2/2 : cartes ${sc.detail}/${sc.detailTotal}` };
  else if (sc) pr = { v: 0, t: 1, lab: "Inventaire : démarrage…" };
  $("progress").hidden = !pr;
  if (pr) { $("barFill").style.width = (pr.t ? Math.round(pr.v / pr.t * 100) : 0) + "%"; $("barLab").textContent = pr.lab; }

  $("open").textContent = status.open != null ? `${status.open}/${s.maxSlots}` : "–";
  $("wanted").textContent = status.wanted ?? "–";
  $("wantedLab").textContent = status.cards != null ? `recherchés / ${status.cards} doubles` : "doubles recherchés";
  $("nextRot").textContent = !s.enabled ? "–" : run.lastRotate ? hm(status.nextRotate) : "après inv.";
  $("err").hidden = !status.error; $("err").textContent = status.error || "";
  $("idle").hidden = !status.idle || !s.enabled; $("idle").textContent = status.idle || "";

  // simulation
  const p = run.plan;
  $("planBox").hidden = !p || !s.dryRun;
  if (p) {
    $("planTitle").textContent = `Dernière simulation · ${p.kind} ${hm(p.at)} · −${p.removed.length} / +${p.list.length}`;
    const rows = [
      ...p.list.map(l => `<tr><td class="n R-${l.rarity}">${esc(l.name)}</td><td>${RN[l.rarity] || l.rarity} #${l.serial}</td><td class="r">${l.price} P</td><td class="muted" title="${esc(l.source)}">♥${l.wants}</td></tr>`),
      ...(p.removed.length ? [`<tr><td colspan="4" class="muted">+ retrait de ${p.removed.length} ventes actuelles</td></tr>`] : [])
    ];
    $("plan").innerHTML = rows.join("") || `<tr><td class="muted">Rien à mettre en vente.</td></tr>`;
  }

  // journal
  $("log").innerHTML = log.slice(0, 80).map(l => `<div class="k-${l.kind}"><time>${hm(l.t)}</time>${esc(l.text)}</div>`).join("") || `<div class="muted">Rien pour l'instant.</div>`;
}

initForm().then(render);
setInterval(render, 1000);
