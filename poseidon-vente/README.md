# Poseidon – Vente auto

Met en vente automatiquement tes **doubles recherchés** sur le marché de Poseidon Scans.

## Installation
1. `chrome://extensions` → activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir ce dossier `poseidon-vente`.
3. Être connecté sur poseidon-scans.net dans Chrome.

Après une modification des fichiers : cliquer sur **↻** sur la carte de l'extension.

## Règles appliquées
- Seulement les **Communes, Rares et Épiques possédées en 2 exemplaires ou plus**, avec **au moins 1 joueur qui les recherche**.
- **Une seule vente par carte** à la fois. On vend **le serial le plus haut**, on garde les autres.
- Jamais d'exemplaire protégé, lié, ni déjà en vente ou aux enchères.
- Ordre : Communes et Rares d'abord (les plus recherchées en premier), **Épiques en dernier** s'il reste de la place.
- **Prix** = vente la moins chère − 1. S'il n'y en a pas, l'estimation du site.
  - Jamais sous le plancher : Commune 6, Rare 13, Épique 51 (modifiable dans la fenêtre).
  - Jamais sous une offre d'achat existante.
  - Toujours dans les limites min/max du site. Si le max du site est sous ton plancher, la carte est ignorée pendant 1 h.
- **50 emplacements** au maximum. Les enchères en cours comptent dedans.
- **25 actions au maximum par tranche de 35 s** (ventes et retraits), pour rester sous la limite du site (30 en 30 s).

## Déroulement
1. **Inventaire** au démarrage, puis toutes les 24 h : une lecture toutes les 3 s, compter 30 à 60 min.
   - Pendant ce temps, l'extension remplit déjà les places libres avec ce qu'elle connaît.
   - Elle ne retire rien avant la fin du premier inventaire.
2. **Toutes les 2 min** : vérifie tes ventes. Une carte vendue est remplacée tout de suite par le double suivant.
3. **Toutes les heures** : retire **toutes** tes ventes à prix fixe (pas les enchères), puis remet en vente avec des prix recalculés.
4. **Rien à vendre** : l'extension attend. Elle relit doucement tes doubles non recherchés (1 toutes les 30 s) et vend dès qu'un devient recherché.

## Fenêtre
- **⏹ TOUT ARRÊTER** : coupe tout immédiatement, même au milieu d'un cycle. Les ventes déjà en cours restent en place. Décocher « Activer » fait la même chose.
- **Arrêt automatique** après 5 erreurs de suite : l'extension s'arrête toute seule au lieu d'insister.
- **Cases Commune / Rare / Épique** : décocher une rareté pour ne plus la mettre en vente. Ses ventes en cours partent à la rotation suivante.
- **Activer** et **Mode simulation**. La simulation est cochée par défaut : l'extension montre ce qu'elle vendrait et à quel prix, sans rien faire.
- Activer, ou changer de mode, lance tout de suite un cycle complet.
- **Cycle complet maintenant** : retire tout et remet en vente.
- **Refaire l'inventaire** : relit toute la collection.
- **Tout retirer et arrêter** (deux clics) : coupe l'automatisation et retire toutes les ventes à prix fixe.
- Badge : `SIM` = simulation, chiffre = ventes en cours, `!` = erreur.

## Statistiques (bouton 📊 dans la fenêtre)
Ouvre une page dans un onglet :
- **Rapporté par le script** : Perles nettes (après la commission de 5 %), nombre de cartes vendues, prix moyen. Filtres : aujourd'hui, 7 jours, depuis le départ, tout. Seules les ventes mises en ligne par le script comptent, pas tes ventes à la main.
- **Graphique** des Perles nettes par jour, sur 14 jours.
- **Ventes du script par rareté** et **historique**, avec export CSV pour Excel.
- **Ma collection, départ → maintenant** : exemplaires, cartes en double et exemplaires en trop par rareté. Compté série par série, donc sans la limite des 2000 du site.
- **Recompter ma collection** prend environ 3 min et marche même extension arrêtée. **Remettre à zéro** prend une nouvelle photo de départ.

## Adresses du site utilisées
| Rôle | Adresse |
|---|---|
| Exemplaires (2000 max) | `GET /api-game/v1/copies` |
| Séries | `GET /api-game/v1/series` |
| Cartes possédées d'une série | `GET /api-game/v1/cards?owned=1&manga=<id série>` |
| Exemplaires d'une carte + recherches | `GET /api-game/v1/cards/<id carte>` |
| Prix, limites, recherches | `GET /api-game/v1/market/cards/<id carte>` |
| Mes ventes | `GET /api-game/v1/market/listings?mine=1`, `GET /api-game/v1/market/orders` |
| Mes enchères | `GET /api-game/v1/auctions?mine=selling&sort=new` |
| Mettre en vente | `POST /api-game/v1/market/orders` `{cardId, side:"sell", price, copyId}` |
| Retirer | `DELETE /api-game/v1/market/orders/<id>` |

Le site refuse les ventes et retraits envoyés directement par une extension (« Origine de la requête refusée »). Ils passent donc par un onglet poseidon-scans.net. Si aucun n'est ouvert, l'extension ouvre un onglet épinglé en arrière-plan : laisse-le ouvert. Les lectures (collection, prix) restent directes.

⚠️ Les règles du site interdisent les robots : utilisation à tes risques.
