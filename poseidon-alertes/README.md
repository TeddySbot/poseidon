# Poseidon – Alertes Marché

Extension Chrome qui surveille le **marché** du jeu de cartes [Poseidon Scans](https://poseidon-scans.net/jeu) et t'envoie une **notification sur ton bureau** dès qu'une carte que tu recherches est mise en vente.

Version : 1.1.0

---

## Ce qu'elle fait

- Tu crées une liste de cartes à surveiller (avec prix max et rareté en option).
- Elle vérifie le marché en continu (toutes les 2 s à 1 min, au choix).
- Quand une carte de ta liste est en vente, une notification Windows apparaît et **reste affichée** :
  - elle indique le nombre d'annonces, le prix le plus bas, la rareté, le numéro et le vendeur ;
  - elle **disparaît toute seule** quand la carte n'est plus en vente ;
  - si tu la fermes avec la **croix**, elle ne revient que si une **nouvelle** annonce apparaît ;
  - **un clic dessus** ouvre directement la page de la carte sur le marché.
- Le badge sur l'icône affiche le nombre de cartes actuellement en vente (`!` en rouge en cas de problème).

> ⚠️ Seules les **ventes à prix fixe** sont surveillées, **pas les enchères**.
> L'extension **n'achète jamais** à ta place : c'est toi qui cliques sur « Acheter ».

---

## Installation

1. Ouvre Chrome et va sur `chrome://extensions`.
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier qui contient `manifest.json`.
4. Épingle l'icône : pièce de puzzle 🧩 → punaise 📌.
5. **Connecte-toi à poseidon-scans.net dans ce Chrome** (connexion Google). L'extension utilise ta session ; sans connexion, elle t'envoie une notification « connexion nécessaire ».

### Réglages conseillés

- **Chrome en arrière-plan** : Paramètres Chrome → Système → active « Continuer d'exécuter les applications en arrière-plan lorsque Google Chrome est fermé ». Sinon les alertes s'arrêtent quand tu fermes Chrome.
- **Notifications Windows** : Paramètres Windows → Système → Notifications → autorise **Google Chrome**. Désactive le mode « Ne pas déranger » / « Assistant de concentration » si rien ne s'affiche.

---

## Utilisation

Clique sur l'icône de l'extension pour ouvrir le menu.

| Champ | Rôle |
|---|---|
| **Carte à surveiller** | Nom de la carte. Des suggestions apparaissent pendant que tu tapes (issues du marché). |
| **Prix max** | Optionnel. Ignore les annonces plus chères. |
| **Rareté** | Optionnel. N, R, SR, SSR, UR ou SEC. |
| **Nom exact** | Coché : nom identique (ex. « Rosa » ne trouve pas « Rosalyn »). Décoché : le nom *contient* le texte. |

- **Ma liste** : point vert = en vente en ce moment (avec le nombre d'annonces). `×` pour retirer une carte.
- **Fréquence** (en bas) : 2 s, 3 s, 5 s, 10 s, 15 s, 30 s ou 1 min.
- **Vérifier** : lance une vérification complète tout de suite.

---

## Comment ça marche

L'extension interroge l'API interne du marché, avec ta session connectée :

- **Vérification rapide** (à la fréquence choisie) : **une seule requête** qui récupère les 200 dernières annonces, comparées à toute ta liste. Le nombre de cartes surveillées ne change donc rien à la charge.
- **Vérification complète** (toutes les 60 s) : une recherche par carte surveillée, pour savoir quelles annonces ont été vendues ou retirées, et faire disparaître les notifications.
- **Ralentissement automatique** : si le site répond 429, 403 ou 5xx, l'extension fait une pause (15 s, puis 30 s, 60 s… jusqu'à 5 min) et revient à la normale dès que tout va bien.

API utilisée : `GET https://poseidon-scans.net/api-game/v1/market/listings?sort=new&q=<nom>`

---

## Fréquence et risque de blocage

Le site est protégé par Cloudflare et ses règles interdisent les robots. Aucune limite de requêtes n'est annoncée, mais :

- **5 s** : bon équilibre (défaut).
- **2–3 s** : détection plus rapide pour les cartes très demandées, mais risque plus élevé d'être freiné.
- Si le menu affiche souvent « Le site freine les requêtes », remonte à 5 ou 10 s.

Le vrai facteur limitant reste le temps de réaction (voir la notif, cliquer, acheter) : clique directement sur la notification pour gagner du temps.

---

## Dépannage

| Problème | Solution |
|---|---|
| Aucune notification | Vérifie les notifications Windows pour Chrome et le mode Ne pas déranger. |
| « Non connecté » / badge `!` | Reconnecte-toi sur poseidon-scans.net dans Chrome. |
| « Le site freine les requêtes » | Normal de temps en temps ; sinon augmente l'intervalle. |
| Les alertes s'arrêtent quand Chrome est fermé | Active « Continuer d'exécuter les applications en arrière-plan ». |
| Une carte n'est jamais trouvée | Décoche « Nom exact » ou vérifie l'orthographe avec les suggestions. |
| Après une modification des fichiers | `chrome://extensions` → bouton ↻ de l'extension. |

Pour voir les journaux : `chrome://extensions` → l'extension → « service worker » → onglet Console.

---

## Fichiers

```
poseidon-alertes/
├── manifest.json   # déclaration de l'extension (Manifest V3)
├── background.js   # boucle de surveillance, notifications
├── popup.html      # menu de l'extension
├── popup.js        # logique du menu (liste, réglages)
├── icons/          # icônes 16, 48, 128 px
└── README.md
```

Données stockées localement dans Chrome (`chrome.storage.local`) : ta liste de cartes, la fréquence, l'état des alertes. Rien n'est envoyé ailleurs que sur poseidon-scans.net.

---

## Historique

- **1.1.0** : vérification toutes les 2 s à 1 min, requête unique pour toute la liste, ralentissement automatique.
- **1.0.0** : première version (vérification toutes les 1 à 10 min).
