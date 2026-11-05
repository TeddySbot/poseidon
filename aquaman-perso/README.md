# Aquaman (perso) — v1.4.2

Guide d'installation complet : voir le [README du dépôt](../README.md).

## Ce que contient ce dossier

| Partie | Fichiers | Origine |
| --- | --- | --- |
| Aquaman (fonctions sur le site) | `src/content/`, `src/lib/aquaman.js` | Aquaman 1.3.1 de A‑Finch13 (MIT), nettoyé |
| Alertes Marché | `src/modules/alertes.js`, `src/popup/popup-alertes.js` | « Poseidon – Alertes Marché » 1.1.0 |
| Vente auto | `src/modules/vente.js`, `vente-logic.js`, `src/popup/popup-vente.js`, `src/pages/stats.*` | « Poseidon – Vente auto » 1.5.1 |
| Fenêtre commune | `src/popup/popup.html`, `popup.css`, `popup.js` | nouvelle, au style Aquaman |
| Service de fond | `src/background.js`, `src/lib/badge.js`, `src/lib/store.js`, `src/lib/update.js` | nouveau |

## Retiré d'Aquaman d'origine

- **Relais de l'auteur** (`aquaman-relay…workers.dev`) : plus aucun envoi (identifiant, pseudo, boosters, favoris, recherches, achats, beaux tirages, collections des autres joueurs). Les envois sont neutralisés (`offline()` dans `src/lib/aquaman.js`) ; depuis la 1.4.2, seule la lecture de la base publique est rebranchée (voir plus haut).
- **Installateur de mises à jour** : plus de `installer-mises-a-jour.bat`, de `updater/` (PowerShell) ni de permission `nativeMessaging`.
- **Télémétrie** et menus réservés à l'auteur.
- **Relevé des beaux tirages chaque minute** en arrière-plan, et lecture automatique des collections des autres joueurs.
- Permission `browsingData`.
- Réglages de partage : forcés à « non » dans le code.

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

- `https://poseidon-scans.net/*` : le jeu, avec ta session.
- `https://api.github.com/repos/TeddySbot/poseidon/contents/aquaman-perso/manifest.json` : toutes les 6 h, sans compte ni jeton (seule ton adresse IP est vue par GitHub, comme pour toute page web).

## Après une modification

`chrome://extensions` → **↻** sous Aquaman (perso).
