# Aquaman (perso) — v1.8.0

Guide d'installation complet : voir le [README du dépôt](../README.md).

## Ce que contient ce dossier

| Partie | Fichiers | Origine |
| --- | --- | --- |
| Aquaman (fonctions sur le site) | `src/content/`, `src/lib/aquaman.js` | Aquaman 1.3.1 de A‑Finch13 (MIT), nettoyé |
| Alertes Marché | `src/modules/alertes.js`, `src/popup/popup-alertes.js` | « Poseidon – Alertes Marché » 1.1.0 |
| Vente auto | `src/modules/vente.js`, `vente-logic.js`, `src/popup/popup-vente.js`, `src/pages/stats.*` | « Poseidon – Vente auto » 1.5.1 |
| Ma progression | `src/modules/progression.js`, `src/pages/progression.*`, `src/lib/gameapi.js` | nouveau (1.6.0) |
| Compléter ma collection | `src/modules/completer.js`, `completer-logic.js`, `src/pages/completer.*` | nouveau (1.5.0) |
| Fenêtre commune | `src/popup/popup.html`, `popup.css`, `popup.js` | nouvelle, au style Aquaman |
| Service de fond | `src/background.js`, `src/lib/badge.js`, `src/lib/store.js`, `src/lib/update.js` | nouveau |

## Retiré d'Aquaman d'origine

- **Relais de l'auteur** (`aquaman-relay…workers.dev`) : plus aucun envoi (identifiant, pseudo, boosters, favoris, recherches, achats, beaux tirages, collections des autres joueurs). Les envois sont neutralisés (`offline()` dans `src/lib/aquaman.js`) ; depuis la 1.4.2, seule la lecture de la base publique est rebranchée (voir plus haut).
- **Installateur de mises à jour d'origine** (qui suivait le dépôt de l'auteur) : remplacé en 1.7.0 par notre propre assistant, voir plus bas.
- **Télémétrie** et menus réservés à l'auteur.
- **Relevé des beaux tirages chaque minute** en arrière-plan, et lecture automatique des collections des autres joueurs.
- Permission `browsingData`.
- Réglages de partage : forcés à « non » dans le code.

## Nouveau en 1.7.0 : mise à jour en un clic

- **Une fois** : double-clic sur `installer-mises-a-jour.bat` (Windows), puis ↻ dans `chrome://extensions`.
  Il copie `updater/host.ps1` dans `%LOCALAPPDATA%\AquamanPersoUpdater` et déclare l'assistant
  `com.teddysbot.aquaman_perso` (native messaging) pour Chrome, Brave, Edge, Opera, Vivaldi, Chromium.
- **Ensuite** : bouton **Mettre à jour** dans le bandeau de la fenêtre. L'assistant télécharge
  `releases/download/aquaman-vX.Y.Z/aquaman-perso-X.Y.Z.zip` du dépôt (adresse construite par l'assistant, jamais reçue
  de l'extension), vérifie `….zip.sha256`, le nom et la version du paquet, sauvegarde l'ancienne version (3 gardées),
  copie, puis l'extension se recharge. Échec de copie → l'ancienne version est remise.
- Dossier Git : `git pull --ff-only`. **Revenir à la version précédente** : lien dans la fenêtre (installations zip).
- Le workflow de release publie maintenant l'empreinte `aquaman-perso-X.Y.Z.zip.sha256`.
- Permission ajoutée : `nativeMessaging`.

## Nouveau en 1.6.0 : Ma progression

Fenêtre d'Aquaman → Accueil → **Ma progression** :

- **Vue d'ensemble** : cartes possédées / total, manquantes, séries complètes, cartes d'événement, gain depuis hier et
  sur 7 jours, albums complets dont la récompense n'est pas réclamée.
- **Par rareté** : possédées, total, manquantes, % et barre, part des cartes d'événement.
- **Par série** : avancement, détail par rareté (ex. `SR 12/15`), tri (plus proches d'être finies, plus incomplètes…),
  filtres (incomplètes, complètes, album à réclamer, rareté manquante), recherche ; un clic montre les cartes
  manquantes avec un lien vers le marché.
- **Courbe** : une photo par jour (365 jours gardés).
- **Lecture** : `/series` puis `/cards?manga=` par série. Une série n'est relue que si ton nombre de cartes y a changé,
  ou une fois par jour. Première fois ≈ 5 min, ensuite quelques secondes ; mise à jour automatique toutes les 3 h.
- Le catalogue est partagé avec « Compléter ma collection », et les deux outils passent par la même file de lecture
  (`src/lib/gameapi.js`, 0,9 s entre deux requêtes).

## Nouveau en 1.5.0 : Compléter ma collection

Fenêtre d'Aquaman → Accueil → **Compléter ma collection (échanges)**. La page :

- **Analyser** : liste les cartes qui te manquent (séries incomplètes), tes doubles échangeables, puis les joueurs qui
  ont en double ce qui te manque (suggestions du jeu + serveur Aquaman, `/holdings?card=` en lecture seule), et
  calcule des propositions d'échange.
- **Règles** : tu gardes toujours ton exemplaire au plus petit #serial ; seuls les autres partent, plus gros serial
  d'abord. Jamais d'exemplaire bloqué, lié ou protégé. Le joueur garde aussi son plus petit serial.
- **Équilibre** : valeur officielle du jeu ; ton offre vise la valeur demandée jusqu'à +20 % (réglable), plusieurs
  doubles pour une carte plus chère si besoin. Règle du site respectée : `max ≤ 3 × min + 30`, 10 cartes par côté.
- **Envoi** : uniquement par **Envoyer** puis **Confirmer l'envoi** (5 s). Le joueur est relu juste avant l'envoi.
- **Suivi** : échanges envoyés (en cours, acceptés, refusés, expirés), relus toutes les 15 min tant qu'il y en a en
  cours, avec une notification quand un échange est accepté. Statistiques : progression, manquantes par rareté,
  séries les plus incomplètes, taux d'acceptation, valeur reçue contre donnée.
- **Rythme** : une lecture toutes les 0,9 s, arrêt dès que le site freine. Première analyse : 2 à 4 min.
- Référence de l'API du jeu : `../JEU-API.md`.

## Nouveau en 1.4.2

- **Lecture plus rapide** : ta collection, tes cartes recherchées et les séries sont gardées dans le navigateur. Elles
  s'affichent tout de suite, puis sont relues en arrière-plan. Après un booster, un achat, une vente, un échange ou une
  recherche modifiée (et au-delà de 15 min), Aquaman attend de nouveau la réponse du site.
- **Base du relais en lecture seule** : « Qui a cette carte ? », l'historique des beaux tirages, les joueurs vus et les
  taux des boosters relisent la base publique de l'auteur (`/packs`, `/pulls`, `/holdings?card=`, `/players`, en GET,
  sans cookie, 6 s au plus). **Rien n'y est envoyé.** Le relais voit ton adresse IP et la carte cherchée.
  Pour couper : réglage `relayRead: false`.

## Modifié

- Bouton **Acheter** sur la page d'une carte : deux clics (confirmation du prix).
- Les ventes de la Vente auto sont marquées (`aqmVente`) pour que la « file de doublons » d'Aquaman ne les reprenne pas si le jeu les refuse.

## Fonctionnement interne

- **Stockage** : chaque outil a ses clés avec un préfixe (`alertes:…`, `vente:…`), pour ne pas écraser celles d'Aquaman (`settings`, `status`…).
- **Badge** (`src/lib/badge.js`) : par ordre de priorité, carte surveillée en vente (orange), erreur (rouge `!`), boosters à ouvrir (bleu), vente auto (vert = ventes en cours, jaune `SIM`).
- **Messages** : `alertes:<action>` et `vente:<action>` sont routés vers chaque module, le reste va à Aquaman.
- **Mises à jour** (`src/lib/update.js`) : lecture de `aquaman-perso/manifest.json` sur `main` (dépôt public, sans jeton) toutes les 6 h, puis notification. Aucune installation automatique.

## Adresses contactées

- `https://github.com/TeddySbot/poseidon/releases/download/…` : seulement par l'assistant de mise à jour, quand tu cliques sur **Mettre à jour**.

- `https://poseidon-scans.net/*` : le jeu, avec ta session.
- `https://api.github.com/repos/TeddySbot/poseidon/contents/aquaman-perso/manifest.json` : toutes les 6 h, sans compte ni jeton (seule ton adresse IP est vue par GitHub, comme pour toute page web).

## Après une modification

`chrome://extensions` → **↻** sous Aquaman (perso).
