#!/usr/bin/env python3
"""Aquaman perso : compte dans la garantie anti-malchance les boosters ouverts par ton serveur.

Le script de ton serveur ouvre les boosters avec l'API du jeu. Aquaman ne les voit donc pas, et ses compteurs SSR/UR/SEC
seraient faux. Cet outil écrit ces ouvertures dans le fichier « pity-server.json » de ton Gist de synchro : l'extension
et la version téléphone l'additionnent à ce qu'elles ont vu elles-mêmes.

Python 3.8+, sans dépendance. Réglages (variables d'environnement) :
    AQUAMAN_TOKEN   jeton GitHub avec l'accès « Gists » (le même que dans l'extension, ou un autre du même compte)
    AQUAMAN_PLAYER  ton identifiant de joueur (Aquaman le montre dans Réglages → Synchro entre appareils)
    AQUAMAN_GIST    (facultatif) l'id du Gist ; sinon il est trouvé par sa description « aquaman-perso-sync »

Trois façons de l'utiliser :

  1. Le plus simple : passe-lui la réponse JSON du jeu à l'ouverture (POST /api-game/v1/boosters/.../open ou open-many)
         curl ... | python3 aquaman_sync.py --json
         python3 aquaman_sync.py --json reponse.json

  2. Les raretés des cartes, un argument par booster ouvert
         python3 aquaman_sync.py N,R,R,N,SR  SSR,N,N,R,R

  3. Depuis un script Python
         from aquaman_sync import record, boosters_from_response
         record(boosters_from_response(reponse_du_jeu))        # ou record([["N", "R", "SSR", "N", "R"]])

Il ne contacte que api.github.com.
"""
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.request

RARITIES = ["N", "R", "SR", "SSR", "UR", "SEC"]
RANK = {r: i + 1 for i, r in enumerate(RARITIES)}
DESCRIPTION = "aquaman-perso-sync"
FILE = "pity-server.json"
KEEP = 500  # comme Aquaman : plus que la plus longue garantie
API = "https://api.github.com"


def _gh(token, method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "aquaman-perso-sync",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise SystemExit("aquaman_sync : jeton GitHub refusé (expiré ou faux).")
        if e.code in (403, 404):
            raise SystemExit("aquaman_sync : le jeton n'a pas l'accès « Gists », ou le Gist n'existe plus.")
        raise


def _gist_id(token):
    gid = os.environ.get("AQUAMAN_GIST")
    if gid:
        return gid
    for page in range(1, 6):
        gists = _gh(token, "GET", f"/gists?per_page=100&page={page}") or []
        for g in gists:
            if g.get("description") == DESCRIPTION:
                return g["id"]
        if len(gists) < 100:
            break
    raise SystemExit("aquaman_sync : Gist de synchro introuvable. Active d'abord la synchro dans Aquaman (elle le crée).")


def boosters_from_response(body):
    """Les boosters d'une réponse d'ouverture du jeu, chacun comme la liste des raretés de ses cartes."""
    def rarities(pulls):
        out = []
        for p in pulls:
            r = (p.get("card") or {}).get("rarity") if isinstance(p, dict) else None
            r = r or (p.get("rarity") if isinstance(p, dict) else None)
            if r in RANK:
                out.append(r)
        return out

    if isinstance(body, dict) and isinstance(body.get("pulls"), list):
        return [rarities(body["pulls"])]
    lst = None
    if isinstance(body, dict):
        lst = body.get("boosters") or body.get("results") or body.get("opened")
    elif isinstance(body, list):
        lst = body
    if isinstance(lst, list):
        return [rarities(b["pulls"]) for b in lst if isinstance(b, dict) and isinstance(b.get("pulls"), list)]
    return []


def record(boosters, token=None, player=None):
    """Ajoute ces boosters (listes de raretés) au fichier du serveur dans le Gist. Retourne le nombre ajouté."""
    boosters = [b for b in boosters if b]
    if not boosters:
        return 0
    token = token or os.environ.get("AQUAMAN_TOKEN")
    player = player or os.environ.get("AQUAMAN_PLAYER")
    if not token or not player:
        raise SystemExit("aquaman_sync : il faut AQUAMAN_TOKEN et AQUAMAN_PLAYER.")
    gid = _gist_id(token)
    gist = _gh(token, "GET", f"/gists/{gid}")
    f = (gist.get("files") or {}).get(FILE)
    current = {}
    if f:
        text = f.get("content")
        if f.get("truncated") and f.get("raw_url"):
            with urllib.request.urlopen(f["raw_url"], timeout=20) as r:
                text = r.read().decode()
        try:
            current = json.loads(text or "{}")
        except ValueError:
            current = {}
    events = current.get("events", []) if current.get("player") == player else []
    now = int(time.time() * 1000)
    for i, b in enumerate(boosters):
        rid = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
        events.append({"id": f"srv-{now + i:x}-{rid}", "at": now + i, "top": max(RANK.get(r, 0) for r in b)})
    events = sorted(events, key=lambda e: e["at"])[-KEEP:]
    data = {"player": player, "device": "server", "name": "Serveur Linux", "events": events, "at": now}
    _gh(token, "PATCH", f"/gists/{gid}", {"files": {FILE: {"content": json.dumps(data)}}})
    return len(boosters)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--json":
        text = open(argv[1], encoding="utf-8").read() if len(argv) > 1 else sys.stdin.read()
        boosters = boosters_from_response(json.loads(text))
    else:
        boosters = [[r.strip().upper() for r in a.split(",") if r.strip()] for a in argv]
        bad = {r for b in boosters for r in b if r not in RANK}
        if bad:
            raise SystemExit(f"aquaman_sync : rareté inconnue {sorted(bad)} (attendu : {', '.join(RARITIES)})")
    n = record(boosters)
    best = max((max(RANK[r] for r in b) for b in boosters if b), default=0)
    print(f"aquaman_sync : {n} booster(s) compté(s)" + (f", meilleure carte {RARITIES[best - 1]}" if best else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
