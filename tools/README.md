# Outils

## `aquaman_sync.py` : compter les boosters ouverts par ton serveur

Si un script ouvre tes boosters sur un serveur, Aquaman ne voit pas ces ouvertures. Ses compteurs de garantie
(SSR tous les 60 boosters, UR tous les 190, suivi de la SEC) seraient donc faux. Cet outil ajoute ces ouvertures dans ton
Gist de synchro, et tous tes appareils les comptent.

### Mise en place (une fois)

1. Active la **synchro entre appareils** dans Aquaman (fenêtre de l'extension → Accueil, ou Plus → Réglages sur
   téléphone). Elle crée le Gist privé `aquaman-perso-sync`.
2. Note **ton identifiant joueur**, affiché sous la synchro (bouton « copier »).
3. Sur le serveur, place `aquaman_sync.py` à côté de ton script (Python 3.8+, aucune dépendance), et définis :
   ```bash
   export AQUAMAN_TOKEN=github_pat_…     # jeton GitHub avec l'accès « Gists »
   export AQUAMAN_PLAYER=ton_identifiant
   ```
   Pour cron ou systemd, mets ces deux lignes dans le fichier d'environnement du service.

### Brancher ton script

Après chaque ouverture, passe à l'outil **la réponse JSON du jeu** (celle de `POST /api-game/v1/boosters/…/open` ou
`…/open-many`). Il en lit les raretés tout seul.

**Script Python**
```python
from aquaman_sync import record, boosters_from_response

reponse = session.post(URL_OUVERTURE).json()        # ce que ton script fait déjà
record(boosters_from_response(reponse))            # une ligne en plus
```

**Script Node.js**
```js
const { execFileSync } = require('node:child_process');
const reponse = await (await fetch(URL_OUVERTURE, { method: 'POST', headers })).json();
execFileSync('python3', ['aquaman_sync.py', '--json'], { input: JSON.stringify(reponse) });
```

**Script shell (curl)**
```bash
curl -s -X POST "$URL_OUVERTURE" -H "Cookie: $COOKIE" | tee /tmp/ouverture.json | python3 aquaman_sync.py --json
```

**Sans la réponse JSON**, passe les raretés à la main, un argument par booster :
```bash
python3 aquaman_sync.py N,R,R,N,SR  SSR,N,N,R,R
```

### Vérifier

- L'outil affiche `aquaman_sync : 1 booster(s) compté(s), meilleure carte …`.
- Dans Aquaman, sous la synchro : « Boosters comptés : … Serveur Linux N ».
- Les compteurs de garantie, sur l'accueil du jeu, incluent les ouvertures du serveur.

L'outil ne contacte que `api.github.com`. Si une écriture échoue (réseau, jeton), il s'arrête avec un message
clair et ne touche pas aux autres fichiers du Gist. Pour que ton script continue malgré tout, appelle-le dans un
`try` / `|| true`.

## `build_userscript.py` : construire la version téléphone

```bash
python3 tools/build_userscript.py      # -> dist/aquaman-perso.user.js
```

Le workflow de release le lance tout seul à chaque nouvelle version.
