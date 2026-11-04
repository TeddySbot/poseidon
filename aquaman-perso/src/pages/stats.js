// Page Statistiques de la Vente auto (Aquaman perso).
import { nsStore } from '../lib/store.js';
const store = nsStore("vente:");
const sendV = (type) => chrome.runtime.sendMessage({ type: "vente:" + type }).catch(() => {});
const RN = { N: "Commune", R: "Rare", SR: "Épique", SSR: "Légendaire", UR: "Mythique", SEC: "Secrète" };
const ORDER = ["N", "R", "SR", "SSR", "UR", "SEC"];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => n == null ? "–" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = t => new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const diff = (a, b) => { if (a == null || b == null) return `<span class="zero">–</span>`; const v = b - a; return `<span class="${v > 0 ? "up" : v < 0 ? "down" : "zero"}">${v > 0 ? "+" : ""}${fmt(v)}</span>`; };

// collection : une baisse = des doubles vendus (vert), une hausse = nouvelles cartes (neutre)
const diffC = (a, b) => { if (a == null || b == null) return `<span class="zero">–</span>`; const v = b - a; return `<span class="${v < 0 ? "up" : "zero"}">${v > 0 ? "+" : ""}${fmt(v)}</span>`; };

let period = "base";
let D = {};

async function loadData() {
  D = await store.get({ stats: null, sales: [], run: {}, status: {} });
  render();
}

function periodStart() {
  const now = new Date();
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "7d") return Date.now() - 7 * 86400_000;
  if (period === "base") return D.stats?.baseline?.at || 0;
  return 0;
}

function render() {
  const st = D.stats || {}, base = st.baseline, cur = st.counts, sales = D.sales || [], run = D.run || {}, status = D.status || {};

  // en-tête
  $("since").textContent = base?.at && !base.pending
    ? `Départ des statistiques : ${dt(base.at)}` + (cur?.at ? ` · dernier comptage : ${dt(cur.at)}` : "")
    : "Photo de départ en cours de création…";
  const c = status.counting;
  $("progress").hidden = !c;
  $("progress").textContent = c ? `Comptage en cours : séries ${c.done}/${c.total || "…"}` : "";
  $("count").disabled = !!c;

  // ventes de la période
  const from = periodStart();
  const ps = sales.filter(s => s.t >= from);
  const net = ps.reduce((a, s) => a + s.net, 0), gross = ps.reduce((a, s) => a + s.price, 0);
  $("kNet").textContent = fmt(net, 0) + " P";
  $("kNetSub").textContent = ps.length ? `brut ${fmt(gross)} P · commission ${fmt(gross - net, 0)} P` : "aucune vente sur la période";
  $("kSold").textContent = fmt(ps.length);
  $("kSoldSub").textContent = ps.length ? `prix moyen ${fmt(gross / ps.length, 1)} P` : "";

  // ventes en cours mises par le script
  const bot = run.botCopies || {};
  const open = Object.values(run.tracked || {}).filter(t => bot[t.copyId]);
  const openVal = open.reduce((a, t) => a + (t.price || 0), 0);
  $("kOpen").textContent = fmt(open.length);
  $("kOpenSub").textContent = open.length ? `${fmt(openVal)} P si tout se vend (≈ ${fmt(openVal * 0.95, 0)} P net)` : "";

  // solde
  const pNow = st.perles?.value, pBase = base?.perles;
  $("kPerles").textContent = pNow != null ? fmt(pNow) + " P" : "–";
  $("kPerlesSub").innerHTML = pBase != null && pNow != null ? `départ ${fmt(pBase)} P · écart ${diff(pBase, pNow)} <span class="muted">(boosters, missions et achats compris)</span>` : "";

  renderChart(sales);
  renderByRarity(ps);
  renderCollection(base, cur);
  renderHistory(ps);
}

function renderByRarity(ps) {
  const rows = [];
  let T = { n: 0, g: 0, net: 0 };
  for (const r of ["N", "R", "SR"]) {
    const s = ps.filter(x => x.rarity === r);
    const g = s.reduce((a, x) => a + x.price, 0), n = s.reduce((a, x) => a + x.net, 0);
    const best = s.reduce((m, x) => x.price > (m?.price || 0) ? x : m, null);
    T.n += s.length; T.g += g; T.net += n;
    rows.push(`<tr><td class="R-${r}">${RN[r]}</td><td>${fmt(s.length)}</td><td>${fmt(g)}</td><td>${fmt(g - n, 0)}</td><td>${fmt(n, 0)}</td><td>${s.length ? fmt(g / s.length, 1) : "–"}</td><td class="l">${best ? esc(best.name) + " · " + fmt(best.price) + " P" : "–"}</td></tr>`);
  }
  rows.push(`<tr class="total"><td>Total</td><td>${fmt(T.n)}</td><td>${fmt(T.g)}</td><td>${fmt(T.g - T.net, 0)}</td><td>${fmt(T.net, 0)}</td><td>${T.n ? fmt(T.g / T.n, 1) : "–"}</td><td></td></tr>`);
  $("byRarity").innerHTML = `<tr><th>Rareté</th><th>Vendues</th><th>Brut (P)</th><th>Commission (P)</th><th>Net (P)</th><th>Prix moyen</th><th style="text-align:left">Meilleure vente</th></tr>` + rows.join("");
}

function renderCollection(base, cur) {
  if (!cur) {
    $("collection").innerHTML = `<tr><td class="empty">Pas encore de comptage. Clique sur « Recompter ma collection » (environ 3 min).</td></tr>`;
    $("collNote").textContent = "";
    return;
  }
  const b = base?.byRarity || null, n = cur.byRarity;
  const head = `<tr><th>Rareté</th><th>Exemplaires<br>départ</th><th>maintenant</th><th>écart</th><th>Cartes en double<br>départ</th><th>maintenant</th><th>écart</th><th>Exemplaires en trop<br>départ</th><th>maintenant</th><th>écart</th><th>Cartes différentes</th></tr>`;
  const T = { be: 0, ne: 0, bd: 0, nd: 0, bt: 0, nt: 0, nc: 0 };
  const rows = ORDER.filter(r => (n[r]?.cartes || 0) + (b?.[r]?.cartes || 0) > 0).map(r => {
    const x = n[r] || {}, y = b?.[r] || null;
    T.ne += x.exemplaires || 0; T.nd += x.double || 0; T.nt += x.enTrop || 0; T.nc += x.cartes || 0;
    if (y) { T.be += y.exemplaires; T.bd += y.double; T.bt += y.enTrop; }
    return `<tr><td class="R-${r}">${RN[r]}</td>
      <td>${y ? fmt(y.exemplaires) : "–"}</td><td>${fmt(x.exemplaires)}</td><td>${diffC(y?.exemplaires, x.exemplaires)}</td>
      <td>${y ? fmt(y.double) : "–"}</td><td>${fmt(x.double)}</td><td>${diffC(y?.double, x.double)}</td>
      <td>${y ? fmt(y.enTrop) : "–"}</td><td>${fmt(x.enTrop)}</td><td>${diffC(y?.enTrop, x.enTrop)}</td>
      <td>${fmt(x.cartes)}</td></tr>`;
  });
  rows.push(`<tr class="total"><td>Total</td>
    <td>${b ? fmt(T.be) : "–"}</td><td>${fmt(T.ne)}</td><td>${b ? diffC(T.be, T.ne) : "–"}</td>
    <td>${b ? fmt(T.bd) : "–"}</td><td>${fmt(T.nd)}</td><td>${b ? diffC(T.bd, T.nd) : "–"}</td>
    <td>${b ? fmt(T.bt) : "–"}</td><td>${fmt(T.nt)}</td><td>${b ? diffC(T.bt, T.nt) : "–"}</td>
    <td>${fmt(T.nc)}</td></tr>`);
  $("collection").innerHTML = head + rows.join("");
  $("collNote").textContent = "« Exemplaires en trop » = ce que tu peux vendre en gardant 1 exemplaire de chaque carte. Compté série par série, sans la limite des 2000 du site. Les chiffres « maintenant » se mettent à jour à chaque comptage (bouton, ou inventaire quotidien).";
}

function renderHistory(ps) {
  if (!ps.length) { $("history").innerHTML = `<tr><td class="empty">Aucune vente du script sur la période.</td></tr>`; return; }
  $("history").innerHTML = `<tr><th>Date</th><th style="text-align:left">Carte</th><th>Rareté</th><th>Serial</th><th>Prix</th><th>Net</th></tr>` +
    ps.slice(0, 500).map(s => `<tr><td>${dt(s.t)}</td><td class="l">${esc(s.name)}</td><td class="R-${s.rarity}">${RN[s.rarity] || s.rarity}</td><td>#${s.serial}</td><td>${fmt(s.price)}</td><td>${fmt(s.net, 2)}</td></tr>`).join("");
}

// Graphique en barres : une barre par jour, valeur au survol
function renderChart(sales) {
  const svg = $("svg"), tip = $("tip");
  const W = svg.clientWidth || 800, H = 220, padL = 44, padR = 8, padT = 12, padB = 26;
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ k: dayKey(d), d, net: 0, n: 0 }); }
  const idx = Object.fromEntries(days.map((x, i) => [x.k, i]));
  for (const s of sales) { const i = idx[dayKey(s.t)]; if (i != null) { days[i].net += s.net; days[i].n++; } }
  const max = Math.max(10, ...days.map(x => x.net));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / days.length, barW = Math.max(4, Math.min(28, bw - 6));
  const y = v => padT + ih - (v / top) * ih;
  let g = "";
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/><text x="${padL - 6}" y="${y(v) + 4}" fill="#a1a1aa" font-size="11" text-anchor="end">${fmt(v)}</text>`;
  days.forEach((x, i) => {
    const cx = padL + bw * i + bw / 2, h = (x.net / top) * ih;
    if (x.net > 0) {
      const r = Math.min(4, barW / 2, h), x0 = cx - barW / 2, y0 = y(x.net), y1 = padT + ih;
      g += `<path d="M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${y1} Z" fill="url(#aqmBar)"/>`;
    }
    if (i % 2 === 1 || days.length <= 8) g += `<text x="${cx}" y="${H - 8}" fill="#a1a1aa" font-size="11" text-anchor="middle">${x.d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</text>`;
    g += `<rect class="hit" data-i="${i}" x="${padL + bw * i}" y="${padT}" width="${bw}" height="${ih}" fill="transparent"/>`;
  });
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><linearGradient id="aqmBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>` + g;
  svg.querySelectorAll(".hit").forEach(el => {
    el.onmouseenter = () => {
      const x = days[+el.dataset.i], cx = padL + bw * +el.dataset.i + bw / 2;
      tip.innerHTML = `<b>${x.d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</b><br>${fmt(x.net, 0)} P net · ${x.n} vente${x.n > 1 ? "s" : ""}`;
      tip.style.left = (cx / W * svg.clientWidth) + "px"; tip.style.top = (y(x.net) / H * 220 - 6) + "px"; tip.style.display = "block";
      el.setAttribute("fill", "rgba(255,255,255,0.04)");
    };
    el.onmouseleave = () => { tip.style.display = "none"; el.setAttribute("fill", "transparent"); };
  });
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

// boutons
document.querySelectorAll("#period button").forEach(b => b.onclick = () => {
  period = b.dataset.p;
  document.querySelectorAll("#period button").forEach(x => x.classList.toggle("on", x === b));
  render();
});
$("count").onclick = () => sendV("count");
let armed = null;
$("reset").onclick = e => {
  if (!armed) { e.target.textContent = "Confirmer ?"; armed = setTimeout(() => { armed = null; e.target.textContent = "Remettre à zéro"; }, 4000); return; }
  clearTimeout(armed); armed = null; e.target.textContent = "Remettre à zéro";
  sendV("resetBaseline");
};
$("csv").onclick = () => {
  const rows = [["date", "carte", "rarete", "serial", "prix", "net"], ...(D.sales || []).map(s => [new Date(s.t).toISOString(), s.name, RN[s.rarity] || s.rarity, s.serial, s.price, String(s.net).replace(".", ",")])];
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `aquaman-ventes-${dayKey(Date.now())}.csv`;
  a.click();
};

store.onChanged((ch) => { if (ch.stats || ch.sales || ch.run || ch.status) loadData(); });
window.addEventListener("resize", () => render());

// Premier affichage : si rien n'a encore été compté, on lance un comptage
loadData().then(() => { if (!D.stats?.counts && !D.status?.counting) sendV("count"); });
