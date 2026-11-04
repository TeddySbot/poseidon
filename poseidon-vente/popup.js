const DEFAULTS = { enabled: false, dryRun: true, maxSlots: 50, floors: { N: 6, R: 13, SR: 51 }, rarities: { N: true, R: true, SR: true }, rotateMin: 60, checkMin: 2, scanHours: 24, writeMax: 25, writeWindowSec: 35, getDelayMs: 1500, scanDelayMs: 3000, countAuctions: true };
const RN = { N: "Commune", R: "Rare", SR: "Épique" };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hm = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...settings, floors: { ...DEFAULTS.floors, ...(settings.floors || {}) }, rarities: { ...DEFAULTS.rarities, ...(settings.rarities || {}) } };
}
async function setSettings(patch) {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: { ...s, ...patch,
    floors: { ...s.floors, ...(patch.floors || {}) }, rarities: { ...s.rarities, ...(patch.rarities || {}) } } });
}

async function initForm() {
  const s = await getSettings();
  $("enabled").checked = s.enabled;
  $("dryRun").checked = s.dryRun;
  $("fN").value = s.floors.N; $("fR").value = s.floors.R; $("fSR").value = s.floors.SR;
  $("maxSlots").value = s.maxSlots;
  for (const r of ["N", "R", "SR"]) { $("r" + r).checked = s.rarities[r]; $("f" + r).disabled = !s.rarities[r]; }
}
for (const r of ["N", "R", "SR"])
  $("r" + r).onchange = e => { $("f" + r).disabled = !e.target.checked; setSettings({ rarities: { [r]: e.target.checked } }); };

$("enabled").onchange = e => setSettings({ enabled: e.target.checked });
$("dryRun").onchange = e => setSettings({ dryRun: e.target.checked });
for (const [id, r] of [["fN", "N"], ["fR", "R"], ["fSR", "SR"]])
  $(id).onchange = e => { const v = Math.max(1, Math.floor(Number(e.target.value) || 1)); e.target.value = v; setSettings({ floors: { [r]: v } }); };
$("maxSlots").onchange = e => { const v = Math.min(50, Math.max(1, Math.floor(Number(e.target.value) || 50))); e.target.value = v; setSettings({ maxSlots: v }); };

$("stopAll").onclick = () => { chrome.runtime.sendMessage({ type: "stopAll" }); $("enabled").checked = false; };
$("stats").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
$("rotate").onclick = () => chrome.runtime.sendMessage({ type: "rotateNow" });
$("rescan").onclick = () => chrome.runtime.sendMessage({ type: "rescan" });
$("clearLog").onclick = () => chrome.runtime.sendMessage({ type: "clearLog" });
let armed = null;
$("withdraw").onclick = e => {
  if (!armed) {
    e.target.textContent = "Confirmer le retrait ?";
    armed = setTimeout(() => { armed = null; e.target.textContent = "Tout retirer et arrêter"; }, 4000);
    return;
  }
  clearTimeout(armed); armed = null; e.target.textContent = "Tout retirer et arrêter";
  chrome.runtime.sendMessage({ type: "withdrawAll" });
  $("enabled").checked = false;
};

async function render() {
  const { status = {}, run = {}, log = [] } = await chrome.storage.local.get(["status", "run", "log"]);
  const s = await getSettings();
  const pill = $("modePill");
  pill.className = "pill " + (!s.enabled ? "off" : s.dryRun ? "sim" : "real");
  pill.textContent = !s.enabled ? "Arrêtée" : s.dryRun ? "Simulation" : "Réel";
  $("enabled").checked = s.enabled;
  $("stopAll").disabled = !s.enabled;
  $("stopAll").textContent = s.enabled ? "⏹ TOUT ARRÊTER" : "Arrêtée";

  $("phase").textContent = status.phase || "–";
  $("open").textContent = status.open != null ? `${status.open} / ${s.maxSlots}` : "–";
  $("auc").textContent = status.auctions ?? "–";
  $("nextRot").textContent = s.enabled && run.lastRotate ? hm(status.nextRotate) : (s.enabled ? "après l'inventaire" : "–");
  const sc = status.scan;
  $("scan").textContent = sc
    ? (sc.phase === "detail" ? `cartes ${sc.detail}/${sc.detailTotal}` : sc.phase === "cards" ? `séries ${sc.series}/${sc.seriesTotal}` : "démarrage…")
    : status.scannedAt ? "fait à " + hm(status.scannedAt) : "pas encore";
  $("cards").textContent = status.cards != null ? `${status.cards} (${status.wanted ?? 0})` : "–";
  $("err").hidden = !status.error; $("err").textContent = status.error || "";
  $("idle").hidden = !status.idle; $("idle").textContent = status.idle || "";

  const p = run.plan;
  $("planBox").hidden = !p;
  if (p) {
    $("planTitle").textContent = `Dernière simulation (${p.kind}, ${hm(p.at)}) : −${p.removed.length} / +${p.list.length}`;
    const rows = [
      ...p.list.map(l => `<tr><td class="n R-${l.rarity}">${esc(l.name)}</td><td>${RN[l.rarity] || l.rarity} #${l.serial}</td><td class="r">${l.price} P</td><td class="muted" title="${esc(l.source)}">♥${l.wants}</td></tr>`),
      ...(p.removed.length ? [`<tr><td colspan="4" class="muted">Retirées : ${p.removed.length} ventes actuelles</td></tr>`] : [])
    ];
    $("plan").innerHTML = rows.join("") || `<tr><td class="muted">Rien à mettre en vente.</td></tr>`;
  }

  $("log").innerHTML = log.slice(0, 80).map(l => `<div class="k-${l.kind}"><time>${hm(l.t)}</time>${esc(l.text)}</div>`).join("") || `<div class="muted">Rien pour l'instant.</div>`;
}

$("ver").textContent = "v" + chrome.runtime.getManifest().version;
initForm().then(render);
setInterval(render, 1000);
