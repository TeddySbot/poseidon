# Récap boosters Discord

Bot Discord qui répond à **/recap** : il relit les messages de ton webhook dans le salon et résume
ce que tu as tiré **depuis le dernier /recap** (boosters, cartes par rareté, liste des Épiques et plus).

Un webhook ne peut qu'envoyer des messages : pour recevoir une commande, il faut un bot. Ce bot ne touche
pas au jeu, il lit seulement le salon. Ton script d'ouverture et ton webhook ne changent pas.

## Installation (une fois, ~5 min)
1. https://discord.com/developers/applications → **New Application** (ex. « Récap Poseidon »).
2. Onglet **Bot** :
   - **Reset Token** → copie le token (ne le partage jamais) ;
   - active **Message Content Intent** → Save.
3. Onglet **OAuth2 → URL Generator** : coche `bot` et `applications.commands`,
   puis les permissions **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**.
   Ouvre l'URL générée et ajoute le bot à ton serveur.
4. Double-clique **lancer.bat** : il crée `config.json` et l'ouvre. Colle le token, enregistre, relance `lancer.bat`.

## config.json
| Clé | Rôle |
|---|---|
| `token` | token du bot (obligatoire) |
| `serveur_id` | ID de ton serveur : la commande apparaît tout de suite (sinon jusqu'à 1 h). Clic droit sur le serveur → Copier l'identifiant (mode développeur Discord activé). |
| `salon_id` | ID du salon du webhook : tu peux alors taper /recap n'importe où. Vide = le salon où tu tapes. |
| `premiere_fois_heures` | période couverte par le tout premier /recap (24 par défaut) |
| `detail_par_defaut` | rareté à partir de laquelle les cartes sont listées : N, R, SR, SSR, UR, SEC |

## Utilisation
- `/recap` : récap depuis le dernier, puis remise à zéro.
- `/recap apercu:True` : voir sans remettre à zéro.
- `/recap detail:Rare (R)` : lister aussi les Rares.
- `/recap compte:principal` : un seul compte.

Le bot doit être lancé quand tu tapes la commande, mais pas entre deux : il relit l'historique.
Pour le lancer avec Windows : `Win+R` → `shell:startup` → mets-y un raccourci vers `lancer.bat`.

`config.json` (token) et `recap_etat.json` (date du dernier récap) sont exclus de git.
