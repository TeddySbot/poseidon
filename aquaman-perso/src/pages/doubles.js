// Page « Mes doubles » (Aquaman perso).
import { nsStore } from '../lib/store.js';
import { RARITY_NAMES, RARITY_ORDER, cardImageUrl, fmt } from '../modules/completer-logic.js';

const prog = nsStore('progression:');
const store = nsStore('doubles:');
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dt = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const RECYCLE = { N: 2, R: 6, SR: 40, SSR: 300, UR: 600, SEC: 2000 };
const COMMISSION = 0.05;
const PREPARE_MAX = 80;
const SHOW_MAX = 400;
const SITE = 'https://poseidon-scans.net';

let DUPS = []; // [{id, name, rarity, image, owned, extra, series}]
let PST = {}, VIEW = null;
let D = { status: {}, plan: null, queue: [], log: [], slots: null };
const sel = new Set();
let shown = []; // liste filtrée
let armed = 0;

// ---------- données ----------
async function loadDups() {
  const { catalog = {}, view = null, status = {} } = await prog.get({ catalog: {}, view: null, status: {} });
  VIEW = view;
  PST = status;
  const titles = new Map((view?.series ?? []).map((s) => [s.id, s.title]));
  DUPS = [];
  for (const [sid, s] of Object.entries(catalog))
    for (const c of s.cards ?? [])
      if (c.owned > 1) DUPS.push({ id: c.id, name: c.name, rarity: c.rarity, image: c.image, owned: c.owned, extra: c.owned - 1, series: titles.get(sid) ?? '' });
  for (const id of [...sel]) if (!DUPS.some((d) => d.id === id)) sel.delete(id);
}
async function loadState() {
  D = await store.get({ status: {}, plan: null, queue: [], log: [], slots: null });
}

// ---------- rendu ----------
function renderHead() {
  const line = $('status');
  const run = D.status.running ? D.status : PST.running ? { ...PST, step: 'Comptage : ' + PST.step } : null;
  const err = D.status.error || PST.error;
  line.className = 'statusline' + (run ? ' run' : err ? ' err' : '');
  line.textContent = run
    ? `En cours : ${run.step}${run.total ? ` (${run.done}/${run.total})` : '…'}`
    : err
      ? 'Erreur : ' + err
      : VIEW
        ? `Comptes du ${dt(VIEW.at)} · « Tout recompter » relit toutes les séries (~5 min) après des ventes, recyclages ou boosters`
        : 'Pas encore de données : clique sur « Tout recompter » (environ 5 min).';
  $('recount').textContent = PST.running ? 'Arrêter le comptage' : 'Tout recompter';
  $('prepare').disabled = !sel.size || !!D.status.running;
  $('sell').disabled = !!D.status.running;

  const extra = DUPS.reduce((n, d) => n + d.extra, 0);
  $('kExtra').textContent = VIEW ? fmt(extra) : '–';
  $('kCards').textContent = VIEW ? fmt(DUPS.length) : '–';
  $('kCardsSub').textContent = VIEW?.partial ? `lecture incomplète (${VIEW.partial} séries)` : 'cartes en 2 exemplaires ou plus';
  $('kRecy').textContent = VIEW ? fmt(DUPS.reduce((n, d) => n + d.extra * (RECYCLE[d.rarity] ?? 0), 0)) : '–';
  $('kSlots').textContent = D.slots ? `${D.slots.used} / ${D.slots.max}` : '–';
  $('kSlotsSub').textContent = D.slots ? `${Math.max(0, D.slots.max - D.slots.used)} place(s) libre(s) · lu à ${dt(D.slots.at).slice(-5)}` : 'ordres en cours (50 au plus)';
  $('kQueue').textContent = fmt(D.queue.reduce((n, q) => n + q.left, 0));

  // par rareté
  const by = {};
  for (const d of DUPS) {
    const b = (by[d.rarity] ??= { cards: 0, extra: 0 });
    b.cards++;
    b.extra += d.extra;
  }
  let tc = 0, te = 0, tr = 0;
  $('rarity').innerHTML =
    '<tr><th>Rareté</th><th>Cartes en double</th><th>Exemplaires en trop</th><th>Recyclage (Perles)</th><th></th></tr>' +
    RARITY_ORDER.map((r) => {
      const b = by[r] ?? { cards: 0, extra: 0 };
      tc += b.cards;
      te += b.extra;
      tr += b.extra * RECYCLE[r];
      return `<tr><td class="R-${r}"><b>${RARITY_NAMES[r]}</b> <span class="muted">${r}</span></td><td>${fmt(b.cards)}</td><td>${fmt(b.extra)}</td><td>${fmt(b.extra * RECYCLE[r])}</td>
        <td>${b.cards ? `<button class="ghost small" data-pick="${r}">Voir</button>` : ''}</td></tr>`;
    }).join('') +
    `<tr class="total"><td>Total</td><td>${fmt(tc)}</td><td>${fmt(te)}</td><td>${fmt(tr)}</td><td></td></tr>`;
}

function renderList() {
  const q = $('q').value.trim().toLowerCase(), r = $('r').value, min = Number($('min').value), sort = $('sort').value;
  shown = DUPS.filter((d) => d.extra >= min && (!r || d.rarity === r) && (!q || d.name.toLowerCase().includes(q) || d.series.toLowerCase().includes(q)));
  const rk = (x) => RARITY_ORDER.indexOf(x.rarity);
  const sorters = {
    rarity: (a, b) => rk(b) - rk(a) || b.extra - a.extra || a.name.localeCompare(b.name),
    extra: (a, b) => b.extra - a.extra || rk(b) - rk(a),
    az: (a, b) => a.name.localeCompare(b.name),
    series: (a, b) => a.series.localeCompare(b.series) || rk(b) - rk(a)
  };
  shown.sort(sorters[sort]);
  const n = shown.reduce((s, d) => s + d.extra, 0);
  $('listCount').textContent = `${fmt(shown.length)} carte(s) · ${fmt(n)} exemplaire(s) en trop`;
  if (!shown.length) return void ($('list').innerHTML = `<tr><td class="empty">${VIEW ? 'Aucune carte pour ce filtre.' : 'Pas encore de données.'}</td></tr>`);
  const allOn = shown.every((d) => sel.has(d.id));
  $('list').innerHTML =
    `<tr><th class="c"><input type="checkbox" id="all" ${allOn ? 'checked' : ''} title="Cocher toute la liste filtrée"></th><th>Carte</th><th style="text-align:left">Série</th><th>Rareté</th><th>Exemplaires</th><th>En trop</th><th></th></tr>` +
    shown
      .slice(0, SHOW_MAX)
      .map(
        (d) => `<tr class="${sel.has(d.id) ? 'sel' : ''}" data-id="${esc(d.id)}"><td class="c"><input type="checkbox" ${sel.has(d.id) ? 'checked' : ''}></td>
        <td><div class="namecell"><img class="thumb" src="${esc(cardImageUrl(d.image))}" alt="" loading="lazy"><b>${esc(d.name)}</b></div></td>
        <td class="l muted">${esc(d.series)}</td><td class="R-${d.rarity}">${d.rarity}</td><td>${d.owned}</td><td><b>${d.extra}</b></td>
        <td><a href="${SITE}/jeu/marche/${encodeURIComponent(d.id)}" target="_blank">marché</a></td></tr>`
      )
      .join('') +
    (shown.length > SHOW_MAX ? `<tr><td colspan="7" class="muted">… et ${fmt(shown.length - SHOW_MAX)} autres : affine la recherche ou les filtres.</td></tr>` : '');
  renderSel();
}

function renderSel() {
  const list = DUPS.filter((d) => sel.has(d.id));
  const n = list.reduce((s, d) => s + d.extra, 0);
  $('selInfo').innerHTML = list.length
    ? `<b>${fmt(list.length)}</b> carte(s) cochée(s) · ${fmt(n)} exemplaire(s) en trop${list.length > PREPARE_MAX ? ` <span class="warn">— seules les ${PREPARE_MAX} premières seront préparées</span>` : ''}`
    : 'Aucune carte cochée.';
  $('prepare').disabled = !sel.size || !!D.status.running;
}

function planRows() {
  return [...document.querySelectorAll('#plan tr[data-id]')].map((tr) => {
    const it = D.plan.items.find((x) => x.cardId === tr.dataset.id);
    return { it, count: Math.min(it.sellable, Math.max(0, Math.floor(Number(tr.querySelector('.cnt').value) || 0))), price: Math.round(Number(tr.querySelector('.prc').value) || 0) };
  });
}

function renderPlan() {
  const items = D.plan?.items ?? [];
  $('planCard').hidden = !items.length;
  if (!items.length) return;
  $('planAt').textContent = `préparée le ${dt(D.plan.at)}`;
  const rk = (x) => RARITY_ORDER.indexOf(x.rarity);
  const list = [...items].sort((a, b) => rk(b) - rk(a) || b.sellable - a.sellable);
  $('plan').innerHTML =
    '<tr><th>Carte</th><th>Gardée</th><th>Vendables</th><th>À vendre</th><th>Prix / ex.</th><th style="text-align:left">Repères</th><th>Recherchée</th><th>Total</th></tr>' +
    list
      .map((it) => {
        const marks = [it.comp != null ? `moins chère ${fmt(it.comp)}` : 'aucune autre vente', it.ref != null ? `réf. ${fmt(Math.round(it.ref))}` : null, it.min != null ? `site ${fmt(it.min)}–${fmt(it.max)}` : null]
          .filter(Boolean)
          .join(' · ');
        const why = it.sellable ? '' : it.listed ? ' <span class="muted">(déjà en vente)</span>' : ' <span class="muted">(rien de libre)</span>';
        return `<tr data-id="${esc(it.cardId)}"><td><div class="namecell"><img class="thumb" src="${esc(cardImageUrl(it.image))}" alt="" loading="lazy"><span><b>${esc(it.name)}</b> <span class="R-${it.rarity}">${it.rarity}</span><br><span class="muted" style="font-size:12px">${esc(it.series)}</span></span></div></td>
        <td>#${it.keepSerial ?? '–'}</td><td title="Serials vendus en premier : ${esc(it.serials.slice(0, 10).map((s) => '#' + s).join(' '))}">${it.sellable}${why}</td>
        <td><input class="field num cnt" type="number" min="0" max="${it.sellable}" value="${it.sellable}" ${it.sellable ? '' : 'disabled'}></td>
        <td><input class="field num prc" type="number" min="${it.min ?? 1}" ${it.max != null ? `max="${it.max}"` : ''} value="${it.price}" title="${esc(it.src)}"></td>
        <td class="l muted" style="font-size:12px">${marks}<br>${esc(it.src)}</td><td>${it.wants ? fmt(it.wants) : '–'}</td><td class="tot">–</td></tr>`;
      })
      .join('');
  updatePlanTotals();
}

function updatePlanTotals() {
  if (!D.plan?.items?.length) return;
  let n = 0, sum = 0, bad = 0;
  for (const tr of document.querySelectorAll('#plan tr[data-id]')) {
    const it = D.plan.items.find((x) => x.cardId === tr.dataset.id);
    const c = Math.min(it.sellable, Math.max(0, Math.floor(Number(tr.querySelector('.cnt').value) || 0)));
    const p = Math.round(Number(tr.querySelector('.prc').value) || 0);
    const outOfRange = c && (p < 1 || (it.min != null && p < it.min) || (it.max != null && p > it.max));
    tr.querySelector('.prc').style.borderColor = outOfRange ? 'var(--bad)' : '';
    if (outOfRange) bad++;
    tr.querySelector('.tot').textContent = c ? fmt(c * p) : '–';
    n += c;
    sum += c * p;
  }
  const free = D.slots ? Math.max(0, D.slots.max - D.slots.used) : null;
  $('planInfo').innerHTML =
    `<b>${fmt(n)}</b> exemplaire(s) · <b>${fmt(sum)}</b> Perles (≈ ${fmt(Math.round(sum * (1 - COMMISSION)))} après commission)` +
    (free != null && n > free ? ` · <span class="warn">${free} place(s) libre(s) : ${fmt(n - free)} iront en file d’attente</span>` : '') +
    (bad ? ` · <span class="warn" style="color:var(--bad)">${bad} prix hors des limites du site</span>` : '');
  $('sell').disabled = !n || bad > 0 || !!D.status.running;
  disarm();
}

function disarm() {
  armed = 0;
  $('sell').classList.remove('armed');
  $('sell').textContent = 'Mettre en vente';
}

function renderQueue() {
  const q = D.queue;
  $('queue').innerHTML = q.length
    ? '<tr><th>Carte</th><th>Rareté</th><th>Restant</th><th>Prix</th><th>Ajoutée</th><th></th></tr>' +
      q.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="R-${x.rarity}">${x.rarity}</td><td>${x.left}</td><td>${fmt(x.price)}</td><td class="muted">${dt(x.added)}</td>
        <td><button class="ghost small" data-unq="${esc(x.cardId)}">Retirer</button></td></tr>`).join('')
    : '<tr><td class="empty">File vide.</td></tr>';
  $('log').innerHTML = D.log.length ? D.log.slice(0, 80).map((l) => `<div class="${l.kind}"><span class="muted">${dt(l.t)}</span> · ${esc(l.text)}</div>`).join('') : '<div class="empty">Rien pour l’instant.</div>';
}

// ---------- actions ----------
for (const r of RARITY_ORDER) $('r').insertAdjacentHTML('beforeend', `<option value="${r}">${RARITY_NAMES[r]}s</option>`);
for (const id of ['q', 'r', 'min', 'sort']) $(id).addEventListener(id === 'q' ? 'input' : 'change', renderList);
$('rarity').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  $('r').value = b.dataset.pick;
  renderList();
  $('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('list').addEventListener('change', (e) => {
  if (e.target.id === 'all') {
    for (const d of shown) e.target.checked ? sel.add(d.id) : sel.delete(d.id);
    return renderList();
  }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  e.target.checked ? sel.add(tr.dataset.id) : sel.delete(tr.dataset.id);
  tr.classList.toggle('sel', e.target.checked);
  renderSel();
});
$('clearSel').addEventListener('click', () => (sel.clear(), renderList()));
$('prepare').addEventListener('click', async () => {
  const order = shown.filter((d) => sel.has(d.id)).concat(DUPS.filter((d) => sel.has(d.id) && !shown.includes(d)));
  await send('doubles:prepare', { cardIds: order.slice(0, PREPARE_MAX).map((d) => d.id) });
});
$('plan').addEventListener('input', updatePlanTotals);
$('planClear').addEventListener('click', () => store.set({ plan: null }));
$('sell').addEventListener('click', async () => {
  const rows = planRows().filter((r) => r.count > 0 && r.price > 0);
  if (!rows.length) return;
  const n = rows.reduce((s, r) => s + r.count, 0), sum = rows.reduce((s, r) => s + r.count * r.price, 0);
  if (!armed || Date.now() - armed > 8000) {
    armed = Date.now();
    $('sell').classList.add('armed');
    $('sell').textContent = `Confirmer : ${fmt(n)} exemplaire(s) · ${fmt(sum)} Perles`;
    return;
  }
  disarm();
  await send('doubles:sell', { items: rows.map((r) => ({ cardId: r.it.cardId, name: r.it.name, rarity: r.it.rarity, price: r.price, count: r.count })) });
  await store.set({ plan: null });
});
$('runNow').addEventListener('click', () => send('doubles:run'));
$('stop').addEventListener('click', () => send('doubles:stop'));
$('clearQueue').addEventListener('click', () => confirm('Vider la file d’attente ? (les ventes déjà en ligne restent)') && send('doubles:unqueue'));
$('queue').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unq]');
  if (b) send('doubles:unqueue', { cardId: b.dataset.unq });
});
$('recount').addEventListener('click', () => send(PST.running ? 'progression:stop' : 'progression:full'));
$('toProgression').addEventListener('click', () => (location.href = 'progression.html'));

prog.onChanged(async (ch) => {
  if (ch.view || ch.catalog) {
    await loadDups();
    renderList();
  }
  if (ch.status) PST = ch.status.newValue ?? {};
  renderHead();
});
store.onChanged(async (ch) => {
  await loadState();
  renderHead();
  if (ch.plan) renderPlan();
  if (ch.queue || ch.log) renderQueue();
  if (ch.slots) updatePlanTotals();
});

(async () => {
  await Promise.all([loadDups(), loadState()]);
  renderHead();
  renderList();
  renderPlan();
  renderQueue();
  send('doubles:slots'); // places de vente libres (2 lectures)
})();
