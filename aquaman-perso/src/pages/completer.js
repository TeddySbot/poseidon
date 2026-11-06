// Page « Compléter ma collection » (Aquaman perso).
import { nsStore } from '../lib/store.js';
import { RARITY_NAMES, RARITY_ORDER, cardImageUrl, fmt } from '../modules/completer-logic.js';

const store = nsStore('completer:');
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type: 'completer:' + type, ...extra }).catch((e) => ({ error: e.message }));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dt = (t) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const SITE = 'https://poseidon-scans.net';
const STATUS = { open: ['En cours', 'blue'], accepted: ['Accepté', 'ok'], declined: ['Refusé', 'bad'], cancelled: ['Annulé', ''], countered: ['Contre-offre', 'warn'], expired: ['Expiré', ''] };

let D = {};
let propView = 'todo';
const armed = new Map(); // id -> timer

async function load() {
  D = await store.get({ settings: {}, status: {}, log: [], proposals: [], sent: {}, summary: null, missing: [], trades: null });
  render();
}

function cardHtml(c) {
  return `<div class="cc" title="${esc(c.card.name)} · ${esc(c.card.series?.title)}">
    <img src="${esc(cardImageUrl(c.card.image))}" alt="" loading="lazy">
    <div class="n">${esc(c.card.name)}</div>
    <div class="m"><span class="R-${c.card.rarity}">${c.card.rarity}</span> · #${c.serial ?? '?'} · ${fmt(c.value)} P</div>
  </div>`;
}

function render() {
  const st = D.status || {}, s = D.summary, sent = Object.values(D.sent || {});
  const props = D.proposals || [];

  // en-tête
  const line = $('status');
  line.className = 'statusline' + (st.running ? ' run' : st.error ? ' err' : '');
  if (st.running) {
    const pct = st.total ? Math.round((100 * st.done) / st.total) : null;
    line.innerHTML = `Analyse en cours : ${esc(st.step)}${st.total ? ` (${st.done}/${st.total})` : '…'}${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}`;
  } else if (st.error) line.textContent = 'Erreur : ' + st.error;
  else line.textContent = s ? `Dernière analyse : ${dt(s.at)} · ${s.playersRead} joueurs lus` : 'Pas encore d’analyse : clique sur « Analyser » (2 à 4 min la première fois).';
  $('scan').textContent = st.running ? 'Arrêter' : 'Analyser';

  // tuiles
  if (s) {
    $('kColl').textContent = `${((100 * s.owned) / s.total).toFixed(1)} %`;
    $('kCollSub').textContent = `${fmt(s.owned)} / ${fmt(s.total)} cartes · ${fmt(s.perles)} Perles`;
    $('kMiss').textContent = fmt(s.missing);
    $('kMissSub').textContent = `dans ${fmt(s.incompleteSeries)} séries incomplètes`;
    $('kDup').textContent = fmt(s.doubles);
    $('kDupSub').textContent = `valeur ${fmt(s.doublesValue)} P` + (s.reserved ? ` · ${s.reserved} déjà engagés` : '');
  }
  const todo = props.filter((p) => p.status === 'todo');
  $('kTodo').textContent = fmt(todo.length);
  $('kTodoSub').textContent = todo.length ? `${todo.reduce((a, p) => a + p.take.length, 0)} cartes à récupérer` : '';
  const open = sent.filter((x) => x.status === 'open');
  $('kOpen').textContent = fmt(open.length);
  $('kOpenSub').textContent = `${sent.length} envoyés au total`;
  const acc = sent.filter((x) => x.status === 'accepted');
  const got = acc.reduce((a, x) => a + x.take.length, 0);
  $('kGot').textContent = fmt(got);
  $('kGotSub').textContent = acc.length
    ? `${acc.length} échange(s) acceptés · reçu ${fmt(acc.reduce((a, x) => a + x.takeValue, 0))} P contre ${fmt(acc.reduce((a, x) => a + x.giveValue, 0))} P` + (sent.length - open.length ? ` · ${Math.round((100 * acc.length) / (sent.length - open.length))} % d’acceptation` : '')
    : '';

  renderProps(props);
  renderSent(sent);
  renderRarity(s);
  renderSeries(s);
  renderMissing();
  renderLog();
  renderSettings();
}

function renderProps(props) {
  const list = props.filter((p) => (propView === 'ignored' ? p.status === 'ignored' || p.status === 'stale' : p.status === propView));
  if (!list.length) {
    $('props').innerHTML = `<div class="empty">${propView === 'todo' ? (D.summary ? 'Aucune proposition : relance l’analyse plus tard, ou augmente la marge dans les réglages.' : 'Lance une analyse pour obtenir des propositions.') : 'Rien ici.'}</div>`;
    return;
  }
  $('props').innerHTML = list
    .map((p) => {
      const fit = p.fit === 'ok' ? ['Équilibré', 'ok'] : p.fit === 'over' ? ['Tu donnes plus', 'warn'] : ['Un peu sous la valeur', 'warn'];
      const ratio = p.takeValue ? Math.round((100 * (p.giveValue - p.takeValue)) / p.takeValue) : 0;
      const st = p.status === 'sent' ? (STATUS[D.sent?.[p.tradeId]?.status] ?? ['Envoyé', 'blue']) : p.status === 'stale' ? ['Doubles déjà utilisés', ''] : null;
      const btns =
        p.status === 'todo'
          ? `<button class="small ${armed.has(p.id) ? 'armed' : 'ok'}" data-send="${esc(p.id)}">${armed.has(p.id) ? 'Confirmer l’envoi' : 'Envoyer'}</button><button class="small ghost" data-ignore="${esc(p.id)}">Ignorer</button>`
          : p.status === 'ignored' || p.status === 'stale'
            ? `<button class="small ghost" data-restore="${esc(p.id)}">Remettre à valider</button>`
            : '';
      return `<div class="prop">
        <div class="top">
          <a class="who" href="${SITE}/profile/${encodeURIComponent(p.player.id)}" target="_blank">${esc(p.player.name ?? p.player.id)}</a>
          <span class="pill ${p.source === 'jeu' ? 'blue' : ''}">${p.source === 'jeu' ? 'Suggestion du jeu' : 'Serveur Aquaman'}</span>
          <span class="pill ${fit[1]}">${fit[0]} (${ratio >= 0 ? '+' : ''}${ratio} %)</span>
          ${st ? `<span class="pill ${st[1]}">${st[0]}</span>` : ''}
          <span class="muted" style="margin-left:auto">${dt(p.sentAt || p.createdAt)}</span>
        </div>
        <div class="sides">
          <div class="side"><h3>Tu reçois · <b>${fmt(p.takeValue)} P</b></h3><div class="cards">${p.take.map(cardHtml).join('')}</div></div>
          <div class="arrow">⇄</div>
          <div class="side"><h3>Tu donnes · <b>${fmt(p.giveValue)} P</b></h3><div class="cards">${p.give.map(cardHtml).join('')}</div></div>
        </div>
        <div class="actions">${btns}${p.error ? `<span class="err">${esc(p.error)}</span>` : ''}</div>
      </div>`;
    })
    .join('');
}

function renderSent(sent) {
  if (!sent.length) return void ($('sent').innerHTML = `<tr><td class="empty">Aucun échange envoyé depuis cette page.</td></tr>`);
  const rows = [...sent].sort((a, b) => b.sentAt - a.sentAt);
  $('sent').innerHTML =
    `<tr><th>Envoyé</th><th style="text-align:left">Joueur</th><th style="text-align:left">Tu reçois</th><th style="text-align:left">Tu donnes</th><th>Valeurs</th><th>Statut</th></tr>` +
    rows
      .map((x) => {
        const st = STATUS[x.status] ?? [x.status, ''];
        return `<tr><td>${dt(x.sentAt)}</td><td class="l">${esc(x.player.name ?? x.player.id)}</td>
        <td class="l">${x.take.map((c) => `<span class="R-${c.card.rarity}">${esc(c.card.name)}</span>`).join(', ')}</td>
        <td class="l">${x.give.map((c) => `<span class="R-${c.card.rarity}">${esc(c.card.name)}</span> #${c.serial}`).join(', ')}</td>
        <td>${fmt(x.takeValue)} ⇄ ${fmt(x.giveValue)}</td><td><span class="pill ${st[1]}">${st[0]}</span></td></tr>`;
      })
      .join('');
}

function renderRarity(s) {
  if (!s) return void ($('rarity').innerHTML = '');
  $('rarity').innerHTML =
    `<tr><th>Rareté</th><th>Manquantes</th><th>Mes doubles</th><th>Valeur des doubles</th></tr>` +
    RARITY_ORDER.map((r) => {
      const b = s.byRarity[r] || {};
      return `<tr><td class="R-${r}">${RARITY_NAMES[r]}</td><td>${fmt(b.missing)}</td><td>${fmt(b.doubles)}</td><td>${fmt(b.doublesValue)} P</td></tr>`;
    }).join('');
  $('rarNote').textContent = s.copiesCapped ? 'Le jeu ne renvoie que tes 2 000 exemplaires les plus chers : quelques doubles de Communes ou de Rares peuvent manquer.' : '';
}

function renderSeries(s) {
  if (!s) return void ($('series').innerHTML = '');
  $('series').innerHTML = s.series
    .slice(0, 40)
    .map(
      (x) => `<div class="serie"><div><a href="${SITE}/jeu/collection?serie=${encodeURIComponent(x.id)}" target="_blank">${esc(x.title)}</a>
      <div class="bar"><i style="width:${(100 * x.owned) / x.total}%"></i></div></div><div class="muted" style="text-align:right">${x.owned}/${x.total}</div></div>`
    )
    .join('');
}

function renderMissing() {
  const q = $('q').value.trim().toLowerCase();
  const r = $('rf').value;
  const list = (D.missing || []).filter((c) => (!r || c.rarity === r) && (!q || c.name.toLowerCase().includes(q) || (c.series?.title || '').toLowerCase().includes(q)));
  if (!list.length) return void ($('missing').innerHTML = `<tr><td class="empty">${D.missing?.length ? 'Aucune carte pour ce filtre.' : 'Lance une analyse.'}</td></tr>`);
  $('missing').innerHTML =
    `<tr><th>Carte</th><th style="text-align:left">Série</th><th>Rareté</th><th>Détenteurs</th><th>État</th><th></th></tr>` +
    list
      .slice(0, 500)
      .map(
        (c) => `<tr><td class="l">${esc(c.name)}${c.variant ? ` <span class="muted">(${esc(c.variant)})</span>` : ''}</td><td class="l muted">${esc(c.series?.title)}</td>
      <td class="R-${c.rarity}">${RARITY_NAMES[c.rarity] ?? c.rarity}</td><td>${c.holders == null ? '<span class="muted">–</span>' : fmt(c.holders)}</td>
      <td>${c.asked ? '<span class="pill blue">Demandée</span>' : c.proposed ? '<span class="pill ok">Proposée</span>' : ''}</td>
      <td><a href="${SITE}/jeu/marche/${encodeURIComponent(c.id)}" target="_blank">Marché</a></td></tr>`
      )
      .join('') +
    (list.length > 500 ? `<tr><td class="muted" colspan="6">… et ${list.length - 500} autres (filtre pour les voir).</td></tr>` : '');
}

function renderLog() {
  $('log').innerHTML = (D.log || []).length ? D.log.map((l) => `<div class="${l.kind === 'err' ? 'err2' : ''}"><span class="muted">${dt(l.t)}</span> · ${esc(l.text)}</div>`).join('') : '<div class="muted">Rien pour l’instant.</div>';
}

let settingsShown = false;
function renderSettings() {
  if (settingsShown) return;
  settingsShown = true;
  const s = { message: 'Salut ! Il me manque {cartes} pour compléter ma collection, ça te dit ?', overpay: 0.2, maxTake: 4, notify: true, ...D.settings };
  $('msg').value = s.message;
  $('over').value = String(s.overpay);
  $('maxTake').value = String(s.maxTake);
  $('notify').checked = !!s.notify;
}

// ---------- actions ----------
for (const r of RARITY_ORDER) $('rf').insertAdjacentHTML('beforeend', `<option value="${r}">${RARITY_NAMES[r]}</option>`);
$('q').addEventListener('input', renderMissing);
$('rf').addEventListener('change', renderMissing);
$('propTab').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  propView = b.dataset.v;
  document.querySelectorAll('#propTab button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
$('scan').addEventListener('click', () => send(D.status?.running ? 'stop' : 'scan'));
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  await send('refresh');
  $('refresh').disabled = false;
});
$('clear').addEventListener('click', () => send('clearLog'));
$('save').addEventListener('click', async () => {
  await send('settings', { settings: { message: $('msg').value, overpay: Number($('over').value), maxTake: Number($('maxTake').value), notify: $('notify').checked } });
  $('saved').textContent = 'Enregistré. Les nouvelles marges servent à la prochaine analyse.';
  setTimeout(() => ($('saved').textContent = ''), 4000);
});

$('props').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.send) {
    const id = b.dataset.send;
    if (!armed.has(id)) {
      // premier clic : on arme, il faut confirmer dans les 5 s
      armed.set(id, setTimeout(() => (armed.delete(id), render()), 5000));
      return render();
    }
    clearTimeout(armed.get(id));
    armed.delete(id);
    b.disabled = true;
    b.textContent = 'Envoi…';
    const r = await send('send', { id });
    if (r?.error) alertLine(r.error);
  } else if (b.dataset.ignore) await send('ignore', { id: b.dataset.ignore });
  else if (b.dataset.restore) await send('restore', { id: b.dataset.restore });
});

function alertLine(text) {
  const l = $('status');
  l.className = 'statusline err';
  l.textContent = text;
}

store.onChanged(() => load());
load();
