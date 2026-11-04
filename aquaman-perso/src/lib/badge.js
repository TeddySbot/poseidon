// Un seul badge sur l'icône pour les trois outils. Chacun annonce son état, le plus important s'affiche :
//   1. carte surveillée en vente (orange, nombre)   2. erreur d'un outil (rouge, "!")
//   3. boosters à ouvrir (bleu, nombre)             4. vente auto en marche (vert = nombre de ventes, jaune = SIM)
const state = { alertes: null, vente: null, boosters: null };

export function setBadge(source, value) {
  state[source] = value; // { text, color, error } ou null
  const a = state.alertes, v = state.vente, b = state.boosters;
  const pick =
    (a?.text && !a.error && a) ||
    (a?.error && a) ||
    (v?.error && v) ||
    (b?.text && b) ||
    (v?.text && v) ||
    b ||
    null;
  chrome.action.setBadgeText({ text: pick?.text ?? '' });
  if (pick?.color) chrome.action.setBadgeBackgroundColor({ color: pick.color });
}

export const COLORS = { alert: '#ea580c', error: '#dc2626', boosters: '#2563eb', sim: '#a16207', real: '#16a34a', grey: '#71717a' };
