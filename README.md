<p align="center"><img src="aquaman-perso/icons/icon128.png" alt="Aquaman" width="96"></p>

<h1 align="center">Aquaman (perso)</h1>

<p align="center"><b>Poseidon Scans · jeu de cartes</b><br>
Classement entre amis, boosters rentables, alertes du marché, vente auto des doublons… dans une seule extension.<br>
Installation : 5 minutes.</p>

> Aquaman perso, c'est l'extension Aquaman de A‑Finch13 (licence MIT) **nettoyée** : plus aucun serveur externe, plus de télémétrie, plus d'installateur sur le PC. On y a ajouté nos deux outils : **Alertes Marché** et **Vente auto**.
> Elle ne parle qu'à `poseidon-scans.net`, et à `api.github.com` toutes les 6 h pour savoir si une nouvelle version existe.
>
> **Page d'installation : https://teddysbot.github.io/poseidon/**

---

## 💻 Installer sur PC

Navigateurs : **Chrome, Brave, Edge, Opera, Vivaldi**. Téléphone : voir plus bas.

### 1. Récupérer l'extension

**Option A : avec le zip (le plus simple)**

1. Télécharge [**aquaman-perso.zip**](https://github.com/TeddySbot/poseidon/releases/latest/download/aquaman-perso.zip).
2. Clic droit → **Extraire tout…**, puis range le dossier dans un endroit où il restera (par exemple `Documents`). L'extension en a besoin pour fonctionner.

**Option B : avec Git (les mises à jour se font avec `git pull`)**

```bash
git clone https://github.com/TeddySbot/poseidon.git
```

Le dossier de l'extension est `poseidon/aquaman-perso`.


### 2. Ouvrir la page des extensions

Tape `chrome://extensions` (Edge : `edge://extensions`, Brave : `brave://extensions`), puis active le **Mode développeur** en haut à droite.

### 3. Charger Aquaman

Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`aquaman-perso`** (celui qui contient `manifest.json`).
Épingle ensuite l'icône (pièce de puzzle 🧩 → punaise 📌) : le badge montre tes boosters à ouvrir et tes alertes.

> ⚠️ Ne charge **pas** `aquaman-chromium` (l'original, qui envoie des données à son auteur) ni les anciens `poseidon-alertes` et `poseidon-vente`. Tout est déjà dans `aquaman-perso` : les avoir en double ferait tout en double.

### 4. Ouvrir le jeu

Va sur [poseidon-scans.net/jeu](https://poseidon-scans.net/jeu) et connecte-toi. La visite guidée démarre toute seule.

### 5. Mises à jour

Toutes les 6 h, l'extension regarde sur ce dépôt si une version plus récente existe. Si oui, tu reçois une notification et un bandeau s'affiche dans sa fenêtre. **Rien ne s'installe tout seul** : voir « Comment se font les mises à jour ? » plus bas.

### Comment savoir que ça marche ?

- Sur le site, un onglet **Plus** apparaît à droite de **Marché**. Si rien ne s'affiche, recharge la page.
- La fenêtre de l'extension a trois onglets : **Accueil**, **Alertes**, **Vente auto**.

---

## 📱 Installer sur téléphone

Sur téléphone, Aquaman est un **script** : mêmes fonctions sur le site, sans les Alertes Marché ni la Vente auto (elles ont besoin de l'extension pour PC).

**Android : Firefox**
1. Installe **Firefox** depuis le Play Store.
2. Menu ⋮ → **Modules complémentaires** → **Tampermonkey** → **Ajouter à Firefox**.
3. Ouvre [**aquaman-perso.user.js**](https://github.com/TeddySbot/poseidon/releases/latest/download/aquaman-perso.user.js) dans Firefox : Tampermonkey propose de l'installer → **Installer**.
4. Ouvre [poseidon-scans.net/jeu](https://poseidon-scans.net/jeu).

**iPhone / iPad : Safari**
1. Installe l'app gratuite **Userscripts** depuis l'App Store.
2. Réglages → **Safari** → **Extensions** → **Userscripts** : active-la et autorise-la sur poseidon-scans.net.
3. Ouvre [**aquaman-perso.user.js**](https://github.com/TeddySbot/poseidon/releases/latest/download/aquaman-perso.user.js) dans Safari, touche l'icône **Userscripts** → **Installer**.
4. Ouvre [poseidon-scans.net/jeu](https://poseidon-scans.net/jeu).

Chrome sur téléphone n'accepte ni extensions ni scripts. Le script se met à jour tout seul : il cherche une nouvelle version toutes les 10 minutes et te la propose en bas de l'écran. Ses réglages sont dans **Plus** → **Réglages**.

---

## 🔗 Relier tes appareils (PC, téléphone, serveur)

La **garantie anti-malchance** et les **séries favorites** peuvent être les mêmes partout. Aucun serveur à installer : tout passe par un **Gist privé de ton compte GitHub**, où chaque appareil écrit son propre fichier.

1. Crée un jeton GitHub : **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**. Dans **Account permissions** → **Gists** : *Read and write*. Rien d'autre.
2. PC : fenêtre d'Aquaman → **Accueil** → **Synchro entre appareils**, colle le jeton → **Relier**. Le Gist `aquaman-perso-sync` est créé.
3. Téléphone : **Plus** → **Réglages** → colle le **même** jeton → **Relier**.
4. Sous la synchro s'affichent ton identifiant joueur et le nombre de boosters comptés par appareil.

**Un script ouvre tes boosters sur un serveur ?** Ajoute une ligne à ton script pour qu'il envoie ses ouvertures avec [`tools/aquaman_sync.py`](tools/README.md). Elles comptent alors partout.

> Un Gist secret ne s'affiche nulle part, mais quiconque a son lien peut le lire. Il ne contient que ton identifiant joueur, l'heure de tes ouvertures et leur meilleure rareté, et tes séries favorites. Utilise un jeton qui n'a que l'accès « Gists ».

---

## ✨ Ce que ça ajoute

**Sur le site (Aquaman)**
- 🏆 **Classement des amis** : cartes uniques et séries complètes (onglet **Plus**).
- 🎁 **Quel booster ouvrir ?** : taux de drop et prix par rareté, personnage, série ou cartes manquantes.
- 🛡 **Garantie anti-malchance** : boosters restants avant la SSR (60) et l'UR (190), suivi de la SEC.
- 🟢 **Échanges** : pastille verte si tu as déjà la carte, rouge sinon.
- 🔎 **Qui a cette carte ?** : détenteurs publiés par le jeu, vendeurs au marché, tes amis.
- ⭐ **Séries favorites**, onglet **Manquantes**, tri des séries **les plus avancées**.
- 🖼 **Vitrine en glisser-déposer**.
- 💸 **Offres sur la page d'une carte** : les 5 moins chères, avec achat en **deux clics** (confirmation).

**Dans la fenêtre de l'extension**
- 🔔 **Alertes Marché** : tu listes des cartes (prix max et rareté en option). Dès qu'une est en vente, une notification Windows apparaît et reste affichée jusqu'à la fin de la vente. Un clic ouvre la carte sur le marché. Vérification réglable de 2 s à 1 min, avec ralentissement automatique si le site freine. Ventes à prix fixe uniquement, **aucun achat automatique**.
- 🤖 **Vente auto** : met en vente tes Communes, Rares et Épiques **en double et recherchées**. Une vente par carte, le serial le plus haut, un prix plancher par rareté, 50 places au maximum, rotation toutes les heures. **Démarre en mode Simulation** : rien n'est vendu tant que tu ne passes pas en **Réel**.
- 📊 **Statistiques de la vente auto** : Perles nettes, graphique sur 14 jours, historique, export CSV.

---

## ❓ Questions

**Comment se font les mises à jour ?**
Avec Git : `git pull` dans le dossier, puis **↻** sous Aquaman dans `chrome://extensions`. Avec le zip : télécharge le nouveau zip, remplace le contenu du dossier, puis **↻**. Tes réglages et tes listes sont gardés.

**Quelles données sont envoyées ?**
Aucune, à personne. L'extension lit le jeu avec ta session sur `poseidon-scans.net`, comme le site lui-même. Tes listes, statistiques et réglages restent sur ton PC. Le seul autre contact est GitHub : lecture de la version publiée et, si tu l'actives, ta synchro dans **ton propre** Gist privé.

**C'est autorisé par le site ?**
Les règles de Poseidon Scans interdisent les robots. Les Alertes (selon la fréquence) et la Vente auto font des requêtes automatiques avec ton compte : **à utiliser à tes risques**, avec une fréquence raisonnable (5 s ou plus pour les alertes, vitesse « Normal » pour la vente auto).

**Pourquoi un onglet poseidon-scans.net épinglé s'ouvre ?**
Le site refuse les ventes envoyées directement par une extension. La Vente auto les envoie donc depuis un onglet du site. Laisse cet onglet ouvert pendant qu'elle tourne.

**Désinstaller ?**
`chrome://extensions` → **Supprimer** sous Aquaman (perso). Rien d'autre n'a été installé sur le PC.

---

## 🛠 Pour Teddy : publier une version

1. Monte la version dans `aquaman-perso/manifest.json` (par exemple `1.4.1`).
2. Pousse sur `main`.
3. Le workflow **Release Aquaman** voit la nouvelle version, crée le tag `aquaman-v1.4.1`, construit le zip et le script téléphone, puis publie la release. Si la version n'a pas changé, il ne fait rien.

Les extensions installées voient la nouvelle version dans les 6 h (ou tout de suite avec **Vérifier**).

---

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `aquaman-perso/` | **L'extension à installer** (et les sources de la version téléphone, `src/userscript/`). |
| `tools/` | `aquaman_sync.py` (boosters ouverts par un serveur) et `build_userscript.py` (version téléphone). |
| `docs/` | La page d'installation (GitHub Pages). |
| `poseidon-alertes/`, `poseidon-vente/` | Anciennes versions séparées des deux outils (remplacées par `aquaman-perso`). |
| `aquaman-chromium/` | Aquaman d'origine (A‑Finch13), gardé pour référence. **Ne pas installer.** |

Extension non officielle, sans lien avec l'équipe de Poseidon Scans. Aquaman : © 2026 A‑Finch13, licence MIT (voir `aquaman-perso/LICENSE`).
