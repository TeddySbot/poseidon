# Poseidon TCG — dossier de compréhension (relevé du 6 nov. 2026)

Relevé fait sur https://poseidon-scans.net/jeu, connecté au compte **TeddyS** (`cmn90652b00c2s00wh88gb8cw`).
Sources : appels réseau des pages + code JS du site (aucune action d'écriture faite pendant le relevé).

Base de l'API : `https://poseidon-scans.net/api-game/v1` — session par cookie (`fetch(..., {credentials:'include'})`).
Le site interdit les robots : espacer les appels (≥ 0,7 s entre deux, cache côté extension).

---

## 1. Pages

| Page | URL | Appels au chargement |
| --- | --- | --- |
| Accueil | `/jeu` | `/me`, `/missions`, `/shop`, `/rarities`, `/feed` |
| Saison | `/jeu/saison` | — |
| Boutique | `/jeu/boutique` | `/shop` |
| Collection | `/jeu/collection` | `/series`, `/albums`, `/cards?owned=1` |
| Échanges | `/jeu/echanges` (`?onglet=envoyes|historique|suggestions`) | `/trades?box=incoming` |
| Marché | `/jeu/marche` | `/market/listings?sort=new` |

Paramètres d'URL de la page Échanges : `?avec=<playerId>` ouvre une proposition vers ce joueur,
`?contre=<tradeId>` ouvre une contre-offre.

---

## 2. Profil et référentiel

### `GET /me`
```json
{ "perles": 8492, "owned": 3365, "total": 4142, "boosterPrice": 150,
  "timer": { "every": 600, "reserve": 7, "nextAt": "...", "full": false },
  "pending": [{ "id": "...", "source": "timer", "grantedAt": "..." }],
  "trust": { "confirmed": true, "frozen": false, ... },
  "season": { "id": "...", "name": "Halloween", "startsAt": "...", "endsAt": "...", "newThisWeek": 26 } }
```
`owned`/`total` = cartes **uniques** possédées / existantes → **777 cartes manquantes** au 6/11.

### `GET /rarities`
| code | nom | rang | recycleValue |
| --- | --- | --- | --- |
| N | Commune | 1 | 2 |
| R | Rare | 2 | 6 |
| SR | Épique | 3 | 40 |
| SSR | Légendaire | 4 | 300 |
| UR | Mythique | 5 | 600 |
| SEC | Secrète | 6 | 2000 |

### `GET /series` → `{ series: [{ id, title, slug, cover, total, owned, eventTotal, eventOwned }] }`
348 séries. `total - owned` = cartes manquantes de la série → **ne charger que les séries incomplètes**.

### `GET /albums` → `{ albums: [{ series, owned, total, claimed, reward, rewardCards }] }`
Récompense de série complète : `POST /albums/{seriesId}/claim`.

### `GET /cards?manga=<seriesId>&rarity=&type=&q=&owned=1`
`{ cards: [{ id, name, image, rarity, maxCopies, minted, types, variant, baseId, seasonId, groupId, groupKind, series, owned }] }`
- `owned` = **nombre d'exemplaires que j'ai** (0 = manquante).
- Plafond **1000 cartes** par réponse : passer série par série (`manga=`).
- `GET /cards?q=<nom>&limit=6` : recherche par nom. `GET /groups?manga=<id>` : groupes de cartes.

Image : `https://poseidon-scans.net/api-game/v1/content/...` ou `/media-library/...` (champ `image`).

---

## 3. Exemplaires (copies) — la base des échanges

### `GET /copies` (les miens) et `GET /players/{playerId}/copies` (n'importe quel joueur)
```json
{ "copies": [{
  "copyId": "01a1b289-...", "serial": 37,
  "locked": false, "bound": false, "protected": false,
  "value": 1451,      // valeur officielle en Perles, sert à l'équilibre des échanges
  "wants": 37,        // nb de joueurs qui recherchent cette carte
  "wanted": true,     // (dans les suggestions) je la recherche
  "card": { "id": "...", "name": "...", "rarity": "UR", "minted": 37, "series": {...}, ... }
}]}
```
- **Plafond 2000 exemplaires**, triés par valeur décroissante, **pas de pagination** (`offset`, `cursor` ignorés).
  Les N/R de faible valeur peuvent manquer → pour les comptes exacts, utiliser `/cards?manga=` (`owned`).
- Liste « échangeable » côté site = exemplaires **non** `locked` / `bound` / `protected`.
  Le filtre « Doublons » du site : non bloqué ET ≥ 2 exemplaires de la carte.
- Mon relevé : 27 locked, 2 bound, 52 protected ; 452 cartes en double parmi les 2000 premiers exemplaires.
- Valeurs observées (mes exemplaires) : R 5–54 (méd. 20) · SR 20–599 (méd. 40) · SSR 319–2000 (méd. 600) · UR 1450–3500 (méd. 2200).
- `/players/{id}/copies` donne bien la `value` ; `/trades/suggestions` renvoie `value: 0` → relire les copies du joueur.

`GET /players/{id}` → `{ id, name, image, isPremium }`. `GET /users/search?q=<pseudo>` (API sociale) pour trouver un id.

---

## 4. Échanges

### Listes
- `GET /trades?box=incoming|outgoing|history` → `{ trades: [Trade] }`
- `GET /trades/{id}` → `Trade`
- `GET /trades/suggestions` → `{ suggestions: [{ player, theyOffer: [Copy], theyWant: [Copy] }] }`
  Le jeu calcule lui-même : joueurs qui ont **en double** des cartes qui me manquent (`theyOffer`, `wanted:true`)
  et ce qu'ils voudraient de moi (`theyWant`, 6 au plus). 10 suggestions observées.

```text
Trade = { id, from{id,name,image,isPremium}, to{...},
          give:[{copyId, serial, card, available, value}],   // ce que "from" donne
          take:[{copyId, serial, card, available, value}],   // ce que "from" reçoit
          givePerles, takePerles, message, parentId, status }
status : open | accepted | declined | cancelled | countered | expired
```

### Créer — `POST /trades`
```json
{ "to": "<playerId>",
  "give": ["<copyId>", ...],      // mes exemplaires, 10 au plus
  "take": ["<copyId>", ...],      // ses exemplaires, 10 au plus
  "givePerles": 0, "takePerles": 0,
  "message": "≤ 200 caractères",
  "parentId": null }              // id de l'échange d'origine pour une contre-offre
```
Réponse : le `Trade` créé (`id`). Le site envoie ensuite un message privé au joueur (API sociale, `shareTrade`).

### Répondre — `POST /trades/{id}/accept` · `/decline` · `/cancel`
À l'acceptation, tout s'échange d'un bloc, ou rien ne bouge.

### Règle d'équilibre (code du site)
```js
isBalanced = (a, b) => Math.max(a, b) <= 3 * Math.min(a, b) + 30
// a = somme des value données (+ Perles données), b = somme des value reçues (+ Perles reçues)
```
Exemples : 600 contre 200 → OK (600 ≤ 630) ; 2200 contre 600 → refusé (2200 > 1830).
Au moins une carte d'un côté ; 10 cartes au plus de chaque côté.

Mission du jour liée : « Conclure un échange » (50 Perles).

---

## 5. Marché, enchères, recherches

- `GET /market/listings?sort=new&q=<nom>` → `{ listings: [{ id, card, copyId, serial, price, seller, ... }] }`
- `GET /market/cards/{cardId}` → `{ ...card, last, lastSaleAt, change, volume, bestBid, bestAsk, estimate, value,
  limits{market{min,max},auction{min,max}}, circulation, wants, seriesTrend, bids[], asks[{price,orders}],
  sales[{price,source,soldAt}], history[{day,close,volume}], mine[] }`
  → `estimate` (estimation du prix) et `value` (valeur officielle) : bonnes références de prix.
- Écritures (jamais sans accord) : `POST /market/orders {cardId, side:"sell", price, copyId}`,
  `DELETE /market/orders/{id}`, `POST /market/listings/{id}/buy`, `POST /auctions {copyId, startPrice, buyout, hours}`.
- `GET /auctions?sort=hot`.
- `GET /wants` → `{ wants: [{ card, since, wants, cheapest, listings, auctions }] }` (mes cartes recherchées) ;
  `DELETE /cards/{cardId}/want`.

## 6. Divers

- `GET /missions`, `POST /missions/{id}/claim` ; `GET /feed` (beaux tirages) ; `GET /shop`,
  `POST /shop/booster {kindId}` ; `POST /boosters/{id}/open` ; `POST /recycle`, `GET /recycle/limits` ; `GET /showcase`.
- API sociale (amis, messages) : `/friends`, `/friends/requests`, `/conversations`, `/messages/...`, `/users/search`,
  `/presence?ids=`, `/relationships/{id}`, `/blocks`.

---

## 7. Serveur Aquaman (relais public, lecture seule)

`https://aquaman-relay.finch-arhold-git.workers.dev` — GET sans cookie, 6 s max, coupable par `relayRead: false`.
- `GET /holdings?card=<cardId>` → `{ owners, scanned }` : joueurs connus pour avoir la carte.
- `GET /players?limit=N` → `{ players: [{ id, name }] }` : joueurs vus récemment.
- `GET /pulls?q=&limit=` : beaux tirages ; `GET /packs` : taux des boosters.
Déjà branché dans `aquaman-perso/src/lib/aquaman.js` (`relayHoldings`, `knownPlayers`, `ownersAmong`).

---

## 8. Conséquences pour « Compléter ma collection »

1. **Manquantes** : `/series` → séries où `owned < total` → `/cards?manga=` → cartes `owned: 0`.
2. **Mes doubles échangeables** : `/copies`, grouper par `card.id`, garder **le plus petit serial**,
   ignorer `locked/bound/protected`, proposer en premier les **plus gros serials**.
3. **Détenteurs** : d'abord `/trades/suggestions` (le jeu les a déjà trouvés), puis relais `/holdings?card=`,
   puis `/players/{id}/copies` pour vérifier qu'ils l'ont **en double** et lire les `value`.
4. **Offre** : `take` = sa carte ; `give` = mes doubles jusqu'à une valeur proche, en respectant
   `isBalanced` et 10 cartes max. Prix de contrôle : `/market/cards/{id}` (`estimate`).
5. **Envoi** : `POST /trades` uniquement après validation manuelle ; suivi par `/trades?box=outgoing|history`.
