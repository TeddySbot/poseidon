# Aquaman (perso)

Copie personnelle de l'extension **Aquaman** de A-Finch13 (licence MIT, voir LICENSE), nettoyée pour ne parler
**qu'à poseidon-scans.net**.

## Retiré par rapport à l'original (v1.3.1)

- **Relais de l'auteur** (`aquaman-relay…workers.dev`) : plus aucun envoi (identifiant, pseudo, ouvertures de boosters,
  favoris, recherches, achats, beaux tirages, collections des autres joueurs). Les appels sont neutralisés dans le code
  (`offline()` dans `src/lib/aquaman.js`), sans réseau, et le domaine n'est plus dans les permissions.
- **Mise à jour automatique** : plus de `installer-mises-a-jour.bat`, plus de dossier `updater/` (programme PowerShell),
  plus de permission `nativeMessaging`, plus de recherche de version sur GitHub.
- **Télémétrie** « joueurs avec Aquaman » et menus réservés à l'auteur.
- **Relevé des beaux tirages chaque minute en arrière-plan** et lecture automatique des collections des autres joueurs.
- Permission `browsingData` (vidage du cache du site).
- Réglages de partage : supprimés de la fenêtre et forcés à « non » dans le code.

## Modifié

- Bouton **Acheter** sur la page d'une carte : il faut maintenant **deux clics** (le 1er affiche « Confirmer X Perles ? »).

## Ce qui reste

Toutes les fonctions locales : boosters rentables, compteur anti-malchance (sur ce navigateur seulement), pastilles
dans les échanges, vitrine, favoris, onglet Manquantes, file de doublons, retrait des ventes, offres sur la page d'une
carte, badge des boosters en attente (lecture de /api-game/v1/me toutes les 5 min).
« Qui a cette carte ? » ne voit plus que : détenteurs publiés par le jeu, vendeurs, tes amis, et les tirages vus dans
ton navigateur.

## Mettre à jour

Pas de mise à jour automatique : pour reprendre une nouvelle version de l'original, il faut refaire ce nettoyage.
