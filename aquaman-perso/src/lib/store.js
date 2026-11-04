// Stockage séparé par outil : chaque module (alertes, vente) range ses clés sous un préfixe ("alertes:", "vente:")
// pour ne pas écraser celles d'Aquaman (qui a déjà "settings", "status"…). Même usage que chrome.storage.local.
export function nsStore(prefix) {
  const keysOf = (arg) => (typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg ?? {}));
  return {
    // get({ clé: défaut }) | get([clés]) | get('clé')
    async get(arg) {
      const keys = keysOf(arg);
      const defs = arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : {};
      const raw = await chrome.storage.local.get(keys.map((k) => prefix + k));
      const out = {};
      for (const k of keys) {
        const v = raw[prefix + k];
        if (v !== undefined) out[k] = v;
        else if (k in defs) out[k] = defs[k];
      }
      return out;
    },
    set(obj) {
      return chrome.storage.local.set(Object.fromEntries(Object.entries(obj).map(([k, v]) => [prefix + k, v])));
    },
    remove(keys) {
      return chrome.storage.local.remove(keysOf(keys).map((k) => prefix + k));
    },
    // cb(changes) avec les clés sans préfixe, seulement si une clé de ce module a changé
    onChanged(cb) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local') return;
        const out = {};
        let any = false;
        for (const [k, v] of Object.entries(ch))
          if (k.startsWith(prefix)) {
            out[k.slice(prefix.length)] = v;
            any = true;
          }
        if (any) cb(out);
      });
    }
  };
}

export const RARITY_NAMES = { N: 'Commune', R: 'Rare', SR: 'Épique', SSR: 'Légendaire', UR: 'Mythique', SEC: 'Secrète' };
