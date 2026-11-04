<p align="center"><img src="aquaman-perso/icons/icon128.png" alt="Aquaman" width="96"></p>

<h1 align="center">Aquaman (perso)</h1>

<p align="center"><b>Poseidon Scans · jeu de cartes</b><br>
Classement entre amis, boosters rentables, alertes du marché, vente auto des doublons… dans une seule extension.<br>
Installation : 5 minutes.</p>

> Aquaman perso, c'est l'extension Aquaman de A‑Finch13 (licence MIT) **nettoyée** : plus aucun serveur externe, plus de télémétrie, plus d'installateur sur le PC. On y a ajouté nos deux outils : **Alertes Marché** et **Vente auto**.
> Elle ne parle qu'à `poseidon-scans.net`, et à `api.github.com` seulement si tu lui donnes un jeton pour vérifier les mises à jour.

---

## 💻 Installer sur PC

Navigateurs : **Chrome, Brave, Edge, Opera, Vivaldi**. Firefox et les téléphones ne sont pas gérés.

### 1. Récupérer l'extension

**Option A : avec Git (conseillé, les mises à jour se font avec `git pull`)**

```bash
git clone https://github.com/TeddySbot/poseidon.git
```

Le dossier de l'extension est `poseidon/aquaman-perso`.

**Option B : avec le zip**

1. Ouvre la page [**Releases**](https://github.com/TeddySbot/poseidon/releases/latest) et télécharge `aquaman-perso-<version>.zip`.
2. Clic droit → **Extraire tout…**, puis range le dossier dans un endroit où il restera (par exemple `Documents`). L'extension en a besoin pour fonctionner.

### 2. Ouvrir la page des extensions

Tape `chrome://extensions` (Edge : `edge://extensions`, Brave : `brave://extensions`), puis active le **Mode développeur** en haut à droite.

### 3. Charger Aquaman

Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`aquaman-perso`** (celui qui contient `manifest.json`).
Épingle ensuite l'icône (pièce de puzzle 🧩 → punaise 📌) : le badge montre tes boosters à ouvrir et tes alertes.

> ⚠️ Ne charge **pas** `aquaman-chromium` (l'original, qui envoie des données à son auteur) ni les anciens `poseidon-alertes` et `poseidon-vente`. Tout est déjà dans `aquaman-perso` : les avoir en double ferait tout en double.

### 4. Ouvrir le jeu

Va sur [poseidon-scans.net/jeu](https://poseidon-scans.net/jeu) et connecte-toi. La visite guidée démarre toute seule.

### 5. (Conseillé) Être prévenu des nouvelles versions

Le dépôt est privé, donc l'extension a besoin d'un jeton GitHub **en lecture seule** pour vérifier les versions :

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Repository access** : *Only select repositories* → `TeddySbot/poseidon`.
3. **Permissions** → *Repository permissions* → **Contents : Read-only**. Rien d'autre.
4. Copie le jeton, ouvre la fenêtre d'Aquaman → **Accueil** → **Mises à jour**, colle-le, puis **OK**.

Le jeton reste dans ton navigateur et n'est envoyé qu'à `api.github.com`. Toutes les 6 h, l'extension compare sa version à celle du dépôt. Si une version plus récente existe, tu reçois une notification. **Rien ne s'installe tout seul.**

### Comment savoir que ça marche ?

- Sur le site, un onglet **Plus** apparaît à droite de **Marché**. Si rien ne s'affiche, recharge la page.
- La fenêtre de l'extension a trois onglets : **Accueil**, **Alertes**, **Vente auto**.

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
Aucune, à personne. L'extension lit le jeu avec ta session sur `poseidon-scans.net`, comme le site lui-même. Tout le reste (listes, statistiques, réglages) reste dans `chrome.storage` sur ton PC. Le seul autre contact possible est GitHub, si tu as mis un jeton.

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
3. Le workflow **Release Aquaman** voit la nouvelle version, crée le tag `aquaman-v1.4.1`, construit `aquaman-perso-1.4.1.zip` et publie la release. Si la version n'a pas changé, il ne fait rien.

Les extensions qui ont un jeton voient la nouvelle version dans les 6 h (ou tout de suite avec **Vérifier**).

---

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `aquaman-perso/` | **L'extension à installer.** |
| `poseidon-alertes/`, `poseidon-vente/` | Anciennes versions séparées des deux outils (remplacées par `aquaman-perso`). |
| `aquaman-chromium/` | Aquaman d'origine (A‑Finch13), gardé pour référence. **Ne pas installer.** |

Extension non officielle, sans lien avec l'équipe de Poseidon Scans. Aquaman : © 2026 A‑Finch13, licence MIT (voir `aquaman-perso/LICENSE`).
