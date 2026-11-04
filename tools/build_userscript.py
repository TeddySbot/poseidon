#!/usr/bin/env python3
"""Construit la version téléphone d'Aquaman perso : un script pour Tampermonkey (Android, Firefox) ou Userscripts (iPhone).

    python3 tools/build_userscript.py            ->  dist/aquaman-perso.user.js

Même code de page que l'extension (src/content, src/lib/aquaman.js), avec à la place des fonctions d'extension :
  src/userscript/shim.js    stockage (localStorage du site) et messages
  src/userscript/bridge.js  le travail du service de fond, fait dans la page
  src/userscript/panel.js   réglages dans le menu « Plus » (synchro entre appareils)
Méthode reprise de build.py d'Aquaman (A-Finch13, MIT).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'aquaman-perso'
SRC = EXT / 'src'
DIST = ROOT / 'dist'
REPO = 'TeddySbot/poseidon'


def read(p):
    return (SRC / p).read_text(encoding='utf-8').replace('\r\n', '\n')


def build():
    version = json.loads((EXT / 'manifest.json').read_text(encoding='utf-8'))['version']
    lib = re.sub(r'^export (const|let|async function|function|class) ', r'\1 ', read('lib/aquaman.js'), flags=re.M)
    if re.search(r'^\s*(export|import)\b', lib, flags=re.M):
        raise SystemExit('src/lib/aquaman.js : un import/export n’est pas pris en charge par le script')
    css = read('content/content.css').replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    latest = f'https://github.com/{REPO}/releases/latest/download/aquaman-perso.user.js'
    header = f"""// ==UserScript==
// @name         Aquaman perso
// @namespace    https://github.com/{REPO}
// @version      {version}
// @description  Compagnon du jeu de cartes de poseidon-scans.net : classement entre amis, boosters rentables, cartes possédées dans les échanges, garantie anti-malchance synchronisée entre tes appareils. Sans serveur externe.
// @author       Teddy (d'après Aquaman de A-Finch13, MIT)
// @license      MIT
// @match        https://poseidon-scans.net/*
// @icon         https://raw.githubusercontent.com/{REPO}/main/aquaman-perso/icons/icon128.png
// @homepageURL  https://teddysbot.github.io/poseidon/
// @supportURL   https://github.com/{REPO}/issues
// @updateURL    {latest}
// @downloadURL  {latest}
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Aquaman perso — version téléphone (script)
 *
 * Les fonctions d'Aquaman sur le site (onglet « Plus », boosters rentables, échanges, collection, vitrine, garantie
 * anti-malchance…), comme l'extension pour PC. Pas d'Alertes Marché ni de Vente auto : elles ont besoin de l'extension.
 *
 * Ne contacte que https://poseidon-scans.net, et api.github.com (version publiée ; synchro par ton Gist privé si tu
 * l'actives dans Plus → Réglages). Ta session reste dans ton navigateur.
 *
 * Fichier généré par tools/build_userscript.py (https://github.com/{REPO}) : ne pas le modifier à la main.
 */
"""
    body = f"""(() => {{
'use strict';
if (window.__aquamanUserscript) return;
window.__aquamanUserscript = true;
const VERSION = '{version}';

// ---------- 1. shim.js : stockage et messages, à la place des fonctions d'extension ----------
{read('userscript/shim.js')}
// ---------- 2. lib/aquaman.js : API du jeu, collections, boosters, synchro ----------
{lib}
// ---------- 3. bridge.js : le travail du service de fond, dans la page ----------
{read('userscript/bridge.js')}
// ---------- 4. content/inject.js : lit les réponses que le site reçoit déjà ----------
{read('content/inject.js')}
const start = () => {{
  const style = document.createElement('style');
  style.id = 'aquaman-style';
  style.textContent = `{css}`;
  document.head.appendChild(style);
  // ---------- 5. content/tutorial.js et content.js : visite, nouveautés, tout ce qui s'affiche sur le site ----------
{read('content/tutorial.js')}
{read('content/content.js')}
  // ---------- 6. panel.js : réglages ----------
  if (document.documentElement.dataset.aqmOwner === OWNER) {{
{read('userscript/panel.js')}
  }} else style.remove();
}};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {{ once: true }});
else start();
}})();
"""
    DIST.mkdir(exist_ok=True)
    out = DIST / 'aquaman-perso.user.js'
    out.write_text(header + body, encoding='utf-8', newline='\n')
    print(f'Aquaman perso {version} (script) -> {out}')


if __name__ == '__main__':
    build()
