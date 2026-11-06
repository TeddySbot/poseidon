// Page « Ma progression » (Aquaman perso).
import { nsStore } from '../lib/store.js';
import { RARITY_NAMES, RARITY_ORDER, cardImageUrl, fmt } from '../modules/completer-logic.js';

const store = nsStore('progression:');
const send = (type) => chrome.runtime.sendMessage({ type: 'progression:' + type }).catch(() => {});
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dt = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const pct = (a, b) => (b ? (100 * a) / b : 0);
const p1 = (a, b) => `${pct(a, b).toFixed(1).replace('.', ',')} %`;
const bar = (a, b) => `<div class="bar ${b && a >= b ? 'done' : ''}"><i style="width:${pct(a, b)}%"></i></div>`;
const SITE = 'https://poseidon-scans.net';

let V = null, H = [], ST = {};
const open = new Set(); // séries dépliées
let catalog = null; // lu à la demande (gros)

async function load() {
  const d = await store.get({ view: null, history: [], status: {} });
  V = d.view;
  H = d.history;
  ST = d.status;
  render();
}

function render() {
  // en-tête
  const line = $('status');
  line.className = 'statusline' + (ST.running ? ' run' : ST.error ? ' err' : '');
  line.textContent = ST.running
    ? `Lecture en cours : ${ST.step}${ST.total ? ` (${ST.done}/${ST.total})` : '…'}`
    : ST.error
      ? 'Erreur : ' + ST.error
      : V
        ? `Mis à jour le ${dt(V.at)} · actualisé tout seul toutes les 3 h`
        : 'Pas encore de données : clique sur « Actualiser » (environ 5 min la première fois, ensuite quelques secondes).';
  $('refresh').textContent = ST.running ? 'Arrêter' : 'Actualiser';
  $('full').disabled = !!ST.running;
  if (!V) return;

  // tuiles
  $('kPct').textContent = p1(V.owned, V.total);
  $('kPctSub').textContent = `${fmt(V.owned)} / ${fmt(V.total)} cartes · ${fmt(V.copies)} exemplaires`;
  $('kMiss').textContent = fmt(V.total - V.owned);
  const near = V.series.filter((s) => s.total > s.owned && s.total - s.owned <= 2).length;
  $('kMissSub').textContent = near ? `${near} série(s) à 1 ou 2 cartes de la fin` : '';
  $('kSer').textContent = `${fmt(V.complete)} / ${fmt(V.seriesCount)}`;
  $('kSerSub').textContent = p1(V.complete, V.seriesCount) + ' des séries';
  $('kEv').textContent = `${fmt(V.eventOwned)} / ${fmt(V.eventTotal)}`;
  $('kEvSub').textContent = V.eventTotal ? p1(V.eventOwned, V.eventTotal) : '';
  const prev = (days) => {
    const lim = Date.now() - days * 86400e3;
    return [...H].reverse().find((h) => h.at <= lim) ?? null;
  };
  const g1 = prev(1), g7 = prev(7);
  $('kGain').innerHTML = g1 ? `<span class="up">+${fmt(V.owned - g1.owned)}</span>` : '–';
  $('kGainSub').textContent = g1 ? `depuis hier${g7 ? ` · +${fmt(V.owned - g7.owned)} en 7 jours` : ''}` : 'les écarts apparaîtront dès demain';

  // albums à réclamer
  $('claimCard').hidden = !V.unclaimed.length;
  $('claim').innerHTML = V.unclaimed
    .map((a) => `<div>✅ <b>${esc(a.title)}</b>${a.reward ? ` · ${fmt(a.reward)} Perles` : ''} · <a href="${SITE}/jeu/collection" target="_blank">réclamer dans la collection</a></div>`)
    .join('');

  // raretés
  let to = 0, tt = 0, eo = 0, et = 0;
  $('rarity').innerHTML =
    `<tr><th>Rareté</th><th>Possédées</th><th>Total</th><th>Manquantes</th><th style="text-align:left">Avancement</th><th>%</th><th>Événement</th></tr>` +
    RARITY_ORDER.filter((r) => V.byRarity[r]?.total)
      .map((r) => {
        const b = V.byRarity[r];
        to += b.owned;
        tt += b.total;
        eo += b.evOwned;
        et += b.evTotal;
        return `<tr><td class="R-${r}"><b>${RARITY_NAMES[r]}</b> <span class="muted">${r}</span></td><td>${fmt(b.owned)}</td><td>${fmt(b.total)}</td><td>${fmt(b.total - b.owned)}</td>
        <td class="w">${bar(b.owned, b.total)}</td><td>${p1(b.owned, b.total)}</td><td class="muted">${b.evTotal ? `${b.evOwned}/${b.evTotal}` : '–'}</td></tr>`;
      })
      .join('') +
    `<tr class="total"><td>Total</td><td>${fmt(to)}</td><td>${fmt(tt)}</td><td>${fmt(tt - to)}</td><td class="w">${bar(to, tt)}</td><td>${p1(to, tt)}</td><td class="muted">${et ? `${eo}/${et}` : '–'}</td></tr>`;
  if (V.partial) $('rarity').insertAdjacentHTML('beforeend', `<tr><td class="muted" colspan="7">Détail encore incomplet : ${V.partial} série(s) pas encore lues.</td></tr>`);

  renderChart();
  renderSeries();
}

function renderChart() {
  const pts = H.slice(-90);
  if (pts.length < 2) return void ($('chart').innerHTML = '<div class="empty">La courbe apparaîtra après quelques jours d’actualisation.</div>');
  const W = 1000, Hh = 200, pad = 34;
  const ys = pts.map((p) => p.owned);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = Math.max(1, max - min);
  const x = (i) => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = (v) => Hh - 24 - ((v - min) * (Hh - 48)) / span;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.owned).toFixed(1)}`).join(' ');
  const lab = (p) => p.day.slice(8, 10) + '/' + p.day.slice(5, 7);
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Cartes possédées par jour">
    <line x1="${pad}" x2="${W - pad}" y1="${y(min)}" y2="${y(min)}" stroke="rgba(255,255,255,.08)"/>
    <line x1="${pad}" x2="${W - pad}" y1="${y(max)}" y2="${y(max)}" stroke="rgba(255,255,255,.08)"/>
    <text x="4" y="${y(max) + 4}" fill="#a1a1aa" font-size="12">${max}</text><text x="4" y="${y(min) + 4}" fill="#a1a1aa" font-size="12">${min}</text>
    <path d="${path}" fill="none" stroke="#60a5fa" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.owned)}" r="3" fill="#60a5fa"><title>${lab(p)} : ${p.owned} cartes</title></circle>`).join('')}
    <text x="${pad}" y="${Hh - 4}" fill="#a1a1aa" font-size="12">${lab(pts[0])}</text>
    <text x="${W - pad}" y="${Hh - 4}" fill="#a1a1aa" font-size="12" text-anchor="end">${lab(pts.at(-1))}</text></svg>`;
}

function renderSeries() {
  const q = $('q').value.trim().toLowerCase(), f = $('f').value, r = $('r').value, sort = $('sort').value;
  let list = V.series.filter((s) => s.total);
  if (f === 'incomplete') list = list.filter((s) => s.owned < s.total);
  if (f === 'complete') list = list.filter((s) => s.owned >= s.total);
  if (f === 'claim') list = list.filter((s) => s.owned >= s.total && s.claimed === false);
  if (q) list = list.filter((s) => s.title.toLowerCase().includes(q));
  if (r) list = list.filter((s) => s.rarity?.[r] && s.rarity[r].owned < s.rarity[r].total);
  const miss = (s) => s.total - s.owned;
  const sorters = {
    near: (a, b) => (miss(a) || 1e9) - (miss(b) || 1e9) || pct(b.owned, b.total) - pct(a.owned, a.total),
    pct: (a, b) => pct(b.owned, b.total) - pct(a.owned, a.total) || miss(a) - miss(b),
    missing: (a, b) => miss(b) - miss(a),
    size: (a, b) => b.total - a.total,
    az: (a, b) => a.title.localeCompare(b.title)
  };
  list.sort(sorters[sort]);
  $('serCount').textContent = `${list.length} série(s)`;
  if (!list.length) return void ($('series').innerHTML = '<tr><td class="empty">Aucune série pour ce filtre.</td></tr>');
  $('series').innerHTML =
    `<tr><th>Série</th><th style="text-align:left">Avancement</th><th>Possédées</th><th>Manquantes</th><th style="text-align:left">Par rareté (possédées/total)</th></tr>` +
    list
      .map((s) => {
        const chips = s.rarity
          ? `<div class="chips">${RARITY_ORDER.filter((k) => s.rarity[k])
              .map((k) => `<span class="chip R-${k} ${s.rarity[k].owned >= s.rarity[k].total ? 'full' : ''}">${k} ${s.rarity[k].owned}/${s.rarity[k].total}</span>`)
              .join('')}</div>`
          : '<span class="muted">pas encore lu</span>';
        const tag = s.owned >= s.total ? (s.claimed === false ? ' <span class="pill warn">à réclamer</span>' : ' <span class="pill">complète</span>') : '';
        const row = `<tr class="srow" data-id="${esc(s.id)}"><td class="l"><b>${esc(s.title)}</b>${tag}</td><td class="w">${bar(s.owned, s.total)}<span class="muted" style="font-size:12px">${p1(s.owned, s.total)}</span></td>
          <td>${s.owned}/${s.total}</td><td>${miss(s) || '–'}</td><td class="l">${chips}</td></tr>`;
        return row + (open.has(s.id) ? `<tr class="detail"><td colspan="5">${detail(s)}</td></tr>` : '');
      })
      .join('');
}

function detail(s) {
  const cards = catalog?.[s.id]?.cards;
  if (!cards) return '<span class="muted">Chargement…</span>';
  const miss = cards.filter((c) => !c.owned).sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  if (!miss.length) return '<span class="muted">Rien ne manque dans cette série.</span>';
  return `<div class="miss">${miss
    .map(
      (c) => `<a class="cc" href="${SITE}/jeu/marche/${encodeURIComponent(c.id)}" target="_blank" title="Voir au marché">
      <img src="${esc(cardImageUrl(c.image))}" alt="" loading="lazy"><div class="n">${esc(c.name)}</div><div class="R-${c.rarity}">${RARITY_NAMES[c.rarity] ?? c.rarity}${c.event ? ' · évén.' : ''}</div></a>`
    )
    .join('')}</div>`;
}

// ---------- actions ----------
for (const r of RARITY_ORDER) $('r').insertAdjacentHTML('beforeend', `<option value="${r}">Il me manque des ${RARITY_NAMES[r]}s</option>`);
for (const id of ['q', 'f', 'r', 'sort']) $(id).addEventListener(id === 'q' ? 'input' : 'change', () => V && renderSeries());
$('refresh').addEventListener('click', () => send(ST.running ? 'stop' : 'refresh'));
$('full').addEventListener('click', () => send('full'));
$('completer').addEventListener('click', () => (location.href = 'completer.html'));
$('series').addEventListener('click', async (e) => {
  const row = e.target.closest('tr.srow');
  if (!row) return;
  const id = row.dataset.id;
  if (open.has(id)) open.delete(id);
  else {
    open.add(id);
    if (!catalog) {
      renderSeries();
      catalog = (await store.get({ catalog: {} })).catalog;
    }
  }
  renderSeries();
});

store.onChanged((ch) => {
  if (ch.catalog) catalog = null; // relu au prochain dépliage
  if (ch.catalog && open.size) store.get({ catalog: {} }).then((d) => ((catalog = d.catalog), V && renderSeries()));
  if (ch.view || ch.history || ch.status) load();
});
load();
