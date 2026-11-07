// Celestial : barre du haut commune aux pages complètes (logo, liens entre pages, Perles).
// Ajoutée en tête de <body> ; ne touche à rien d'autre dans la page.
const PAGES = [
  ['progression.html', 'Ma progression'],
  ['doubles.html', 'Mes doubles'],
  ['completer.html', 'Compléter'],
  ['stats.html', 'Stats de vente']
];


function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids.filter((k) => k != null));
  return e;
}

const here = location.pathname.split('/').pop();
const logo = el('span', { class: 'cel-logo' }, el('img', { src: '../../icons/icon128.png', alt: '', width: '24', height: '24' }));
const perles = el('span', { class: 'cel-perles', title: 'Perles (dernier relevé)' });
const bar = el(
  'nav',
  { class: 'cel-top', 'aria-label': 'Pages Celestial' },
  el(
    'div',
    { class: 'cel-top-in' },
    el('span', { class: 'cel-brand' }, logo, 'Celestial'),
    el('div', { class: 'cel-nav' }, ...PAGES.map(([href, label]) => el('a', { href, 'aria-current': href === here ? 'page' : null }, label))),
    perles
  )
);
document.body.prepend(bar);

const fmt = (n) => Number(n).toLocaleString('fr-FR');
async function paintPerles() {
  try {
    const { 'progression:view': view } = await chrome.storage.local.get('progression:view');
    if (view?.perles != null) perles.textContent = `${fmt(view.perles)} Perles`;
  } catch {}
}
paintPerles();
chrome.storage?.onChanged?.addListener((ch, area) => area === 'local' && ch['progression:view'] && paintPerles());
