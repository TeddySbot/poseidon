// Lecture de l'API du jeu, partagée par « Compléter ma collection » et « Ma progression ».
// Une seule file : jamais plus d'une lecture toutes les 0,9 s, même si les deux outils tournent en même temps.

export const SITE = 'https://poseidon-scans.net';
export const API = SITE + '/api-game/v1';
const READ_DELAY = 900;

export class ApiError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

export async function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(end - Date.now(), 5000)));
    await chrome.runtime.getPlatformInfo(); // garde le service éveillé
  }
}

let queue = Promise.resolve();
let lastReq = 0;

// GET /api-game/v1<path>. `stop()` peut interrompre une longue lecture entre deux requêtes.
export function get(path, stop = () => false) {
  const run = async () => {
    if (stop()) throw new ApiError(0, 'Arrêté.');
    const wait = lastReq + READ_DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    let r;
    try {
      r = await fetch(API + path, { credentials: 'include', cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'Connexion impossible : ' + (e.message || e));
    }
    if (r.status === 401) throw new ApiError(401, 'Non connecté : connecte-toi sur poseidon-scans.net dans Chrome.');
    if (r.status === 429 || r.status >= 500) throw new ApiError(r.status, `Le site freine (${r.status}) : réessaie dans quelques minutes.`);
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, j?.error?.message || `Erreur ${r.status}`);
    return j;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
