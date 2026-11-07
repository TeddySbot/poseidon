// Onglet Alertes de la fenêtre (ex-popup « Poseidon – Alertes Marché »).
import { nsStore, RARITY_NAMES as RAR } from '../lib/store.js';

const store = nsStore('alertes:');
const $ = (s) => document.querySelector(s);
const send = (type) => chrome.runtime.sendMessage({ type: `alertes:${type}` }).catch(() => {});
const load = () => store.get({ watches: [], intervalSec: 5, paused: false, alerts: {}, status: {} });

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids.filter((k) => k != null));
  return e;
}

async function render() {
  const { watches, intervalSec, paused, alerts, status } = await load();
  $('#a-interval').value = String(intervalSec);
  $('#a-paused').hidden = !paused;
  $('#a-pause').textContent = paused ? 'Reprendre' : 'Pause';

  const ul = $('#a-list');
  ul.replaceChildren();
  if (!watches.length) ul.append(el('li', { class: 'empty' }, 'Aucune carte surveillée pour l’instant.'));
  let liveCount = 0;
  for (const w of watches) {
    const live = Object.keys(alerts[w.id]?.listings || {}).length;
    if (live) liveCount++;
    const best = Object.values(alerts[w.id]?.listings || {}).sort((a, b) => a.price - b.price)[0];
    const crit = [w.maxPrice ? `Max ${w.maxPrice} P` : 'Aucun prix max', w.exact ? 'nom exact' : 'contient', live > 1 ? `${live} en vente` : null].filter(Boolean).join(' · ');
    const x = el('button', { type: 'button', class: 'x', title: 'Retirer', 'aria-label': `Retirer ${w.name}` }, '×');
    x.addEventListener('click', async () => {
      const s = await load();
      await store.set({ watches: s.watches.filter((y) => y.id !== w.id) });
      chrome.notifications.clear('w:' + w.id);
      render();
    });
    const title = el('b', {}, el('span', { class: 'grow', style: 'overflow:hidden;text-overflow:ellipsis' }, w.name), w.rarity ? el('span', { class: `cel-rar ${w.rarity}`, title: RAR[w.rarity] }, w.rarity) : null);
    const name = el('div', { class: 'name' }, title, el('small', {}, crit));
    const strip = el('span', { class: `cel-strip ${w.rarity || ''}`, 'aria-hidden': 'true' });
    let right = null;
    if (live && best) {
      right = el('button', { type: 'button', class: 'price-live', title: 'Ouvrir la carte sur le marché' }, `${best.price} P`);
      if (best.cardId) right.addEventListener('click', () => chrome.tabs.create({ url: `https://poseidon-scans.net/jeu/marche/${best.cardId}` }));
    }
    const li = el('li', { class: live ? 'live' : null }, strip, name, right, x);
    ul.append(li);
  }
  // résumé sur l'accueil
  const sum = $('#m-alertes');
  if (sum) {
    const n = watches.length;
    sum.textContent = !n
      ? 'Aucune carte surveillée'
      : `${n} carte${n > 1 ? 's' : ''} surveillée${n > 1 ? 's' : ''}` + (paused ? ' · en pause' : liveCount ? ` · ${liveCount} en vente !` : ` · toutes les ${intervalSec < 60 ? intervalSec + ' s' : 'minutes'}`);
    $('#m-alertes-dot').className = 'cel-dot' + (status.error ? ' err' : paused ? ' wait' : n ? ' on' : '');
  }
  const badge = $('#alertCount');
  badge.hidden = !liveCount;
  badge.textContent = liveCount || '';

  const st = $('#a-status');
  const dot = $('#a-dot');
  st.style.color = '';
  dot.className = 'cel-dot' + (paused ? ' wait' : '');
  if (paused) st.textContent = 'Surveillance en pause.';
  else if (status.error === 'AUTH') {
    st.style.color = 'var(--bad)';
    dot.className = 'cel-dot err';
    st.replaceChildren('Non connecté. ', el('a', { href: 'https://poseidon-scans.net/jeu/marche', target: '_blank' }, 'Se connecter'));
  } else if (status.error) {
    st.style.color = 'var(--bad)';
    dot.className = 'cel-dot err';
    st.textContent = status.error;
  } else if (status.lastCheck) {
    dot.className = watches.length ? 'cel-dot on' : 'cel-dot';
    st.textContent = 'Vérifié à ' + new Date(status.lastCheck).toLocaleTimeString('fr-FR');
  } else st.textContent = 'Pas encore vérifié';
}

$('#a-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#a-name').value.trim();
  if (!name) return;
  const s = await load();
  s.watches.push({ id: crypto.randomUUID(), name, exact: $('#a-exact').checked, maxPrice: $('#a-max').value ? Number($('#a-max').value) : null, rarity: $('#a-rar').value || null });
  await store.set({ watches: s.watches });
  $('#a-name').value = '';
  $('#a-max').value = '';
  render();
  send('checkNow').then(render);
});

// Suggestions de noms tirées du marché
let t;
$('#a-name').addEventListener('input', () => {
  clearTimeout(t);
  const q = $('#a-name').value.trim();
  if (q.length < 2) return;
  t = setTimeout(async () => {
    try {
      const r = await fetch(`https://poseidon-scans.net/api-game/v1/market/listings?sort=new&q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!r.ok) return;
      const names = [...new Set(((await r.json()).listings || []).map((l) => l.card?.name).filter(Boolean))].slice(0, 15);
      $('#a-sugg').replaceChildren(...names.map((n) => el('option', { value: n })));
    } catch {}
  }, 350);
});

$('#a-interval').addEventListener('change', async (e) => {
  await store.set({ intervalSec: Number(e.target.value) });
  send('reschedule');
});
$('#a-now').addEventListener('click', async () => {
  $('#a-status').textContent = 'Vérification…';
  await send('checkNow');
  render();
});
$('#a-pause').addEventListener('click', async () => {
  const { paused } = await load();
  await store.set({ paused: !paused });
  send('reschedule');
  render();
});

store.onChanged(render);
render();
