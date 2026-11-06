"""Bot Discord : /recap résume les boosters postés par le webhook depuis le dernier récap.

Le bot ne touche pas au jeu : il relit seulement les messages du salon (ceux du webhook)
entre le dernier /recap et maintenant. Il n'a donc pas besoin de tourner en continu :
il suffit qu'il soit lancé au moment où tu tapes la commande.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import discord
from discord import app_commands

ICI = Path(__file__).resolve().parent
CONFIG = ICI / "config.json"
ETAT = ICI / "recap_etat.json"

RARETES = ["N", "R", "SR", "SSR", "UR", "SEC"]
NOMS = {"N": "Commune", "R": "Rare", "SR": "Épique", "SSR": "Légendaire", "UR": "Mythique", "SEC": "Secrète"}
EMOJI = {"N": "⚪", "R": "🔵", "SR": "🟣", "SSR": "🟡", "UR": "🔴", "SEC": "🌈"}
ALIAS = {**{r.lower(): r for r in RARETES}, **{n.lower(): r for r, n in NOMS.items()},
         "epique": "SR", "legendaire": "SSR", "secrete": "SEC"}
ENTETE = re.compile(r"\[([^\]\n]+)\][\s*_]*Booster", re.I)


def rarete(texte):
    """« N », « **SR** », « Épique »… → code de rareté, sinon None."""
    t = re.sub(r"[*_`|]", "", texte or "").strip()
    if not t:
        return None
    return ALIAS.get(t.split()[0].lower())


def lire_message(msg):
    """Un message du webhook → (compte, [(nom, rareté), …]) ou None si ce n'est pas un booster."""
    textes = [msg.content or ""]
    cartes = []
    for e in msg.embeds:
        textes += [e.title or "", e.description or "", getattr(e.author, "name", None) or "",
                   getattr(e.footer, "text", None) or ""]
        r = rarete(e.description)
        if e.title and r:
            cartes.append((e.title.strip(), r))
            continue
        for f in e.fields:  # au cas où les cartes seraient en champs
            r = rarete(f.value)
            if f.name and r:
                cartes.append((f.name.strip(), r))
    if not cartes:
        return None
    m = ENTETE.search("\n".join(textes))
    return (m.group(1).strip() if m else msg.author.display_name), cartes


def charger(chemin, defaut):
    try:
        return json.loads(chemin.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defaut


def couper(texte, maxi=1024):
    return texte if len(texte) <= maxi else texte[: maxi - 2] + " …"


def bloc(boosters, compteur, detail, mini):
    """Texte d'un compte : totaux par rareté puis les cartes à partir de la rareté choisie."""
    lignes = [" · ".join(f"{EMOJI[r]} {r} **{compteur[r]}**" for r in RARETES if compteur[r]) or "—"]
    for r in reversed(RARETES[RARETES.index(mini):]):
        noms = Counter({n: k for (n, rr), k in detail.items() if rr == r})
        if noms:
            liste = ", ".join(f"{n} ×{k}" if k > 1 else n for n, k in sorted(noms.items(), key=lambda x: (-x[1], x[0])))
            lignes.append(f"{EMOJI[r]} **{NOMS[r]}** : {liste}")
    return couper("\n".join(lignes))


cfg = charger(CONFIG, None)
if not cfg or not cfg.get("token") or "COLLE" in cfg["token"]:
    sys.exit("Remplis d'abord config.json (copie de config.exemple.json) avec le token du bot.")

intents = discord.Intents.default()
intents.message_content = True  # nécessaire pour lire le contenu et les embeds du webhook


class Bot(discord.Client):
    def __init__(self):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        if cfg.get("serveur_id"):
            g = discord.Object(int(cfg["serveur_id"]))
            self.tree.copy_global_to(guild=g)
            await self.tree.sync(guild=g)  # immédiat sur ton serveur
        else:
            await self.tree.sync()  # global : peut mettre jusqu'à 1 h à apparaître

    async def on_ready(self):
        print(f"Connecté en tant que {self.user}. Tape /recap dans Discord.")


bot = Bot()


@bot.tree.command(name="recap", description="Ce que tu as tiré depuis le dernier récap")
@app_commands.describe(
    apercu="Voir le récap sans remettre le compteur à zéro",
    detail="À partir de quelle rareté lister les cartes une par une (Épique par défaut)",
    compte="Seulement ce compte (ex. principal)",
)
@app_commands.choices(detail=[app_commands.Choice(name=f"{NOMS[r]} ({r})", value=r) for r in RARETES])
async def recap(inter: discord.Interaction, apercu: bool = False,
                detail: Optional[app_commands.Choice[str]] = None, compte: Optional[str] = None):
    await inter.response.defer(thinking=True)
    salon = inter.channel
    if cfg.get("salon_id"):
        salon = bot.get_channel(int(cfg["salon_id"])) or await bot.fetch_channel(int(cfg["salon_id"]))

    etat = charger(ETAT, {})
    maintenant = inter.created_at
    if str(salon.id) in etat:
        depuis = datetime.fromisoformat(etat[str(salon.id)])
    else:
        depuis = maintenant - timedelta(hours=float(cfg.get("premiere_fois_heures", 24)))
    mini = detail.value if detail else cfg.get("detail_par_defaut", "SR")

    boosters = Counter()
    raretes = defaultdict(Counter)
    cartes = defaultdict(Counter)
    async for msg in salon.history(after=depuis, before=maintenant, limit=None, oldest_first=True):
        if msg.author.id == bot.user.id:
            continue
        lu = lire_message(msg)
        if not lu:
            continue
        c, liste = lu
        if compte and c.lower() != compte.lower():
            continue
        boosters[c] += 1
        for nom, r in liste:
            raretes[c][r] += 1
            if RARETES.index(r) >= RARETES.index(mini):
                cartes[c][(nom, r)] += 1

    t0, t1 = int(depuis.timestamp()), int(maintenant.timestamp())
    em = discord.Embed(title="📊 Récap boosters", colour=0x8B5CF6,
                       description=f"Du <t:{t0}:f> au <t:{t1}:t> (<t:{t0}:R>)")
    ordre = sorted(boosters, key=lambda c: (c.lower() != "principal", c.lower()))
    for c in ordre[:24]:
        n = sum(raretes[c].values())
        em.add_field(name=f"[{c}] — {boosters[c]} booster{'s' * (boosters[c] > 1)} · {n} cartes",
                     value=bloc(boosters[c], raretes[c], cartes[c], mini), inline=False)
    if len(ordre) > 1:
        tot_r = sum(raretes.values(), Counter())
        tot_c = sum(cartes.values(), Counter())
        em.add_field(name=f"Total — {sum(boosters.values())} boosters · {sum(tot_r.values())} cartes",
                     value=bloc(0, tot_r, tot_c, mini), inline=False)
    if not ordre:
        em.description += "\n\nAucun booster depuis."
    if apercu:
        em.set_footer(text="Aperçu : le compteur n'a pas été remis à zéro.")
    else:
        etat[str(salon.id)] = maintenant.isoformat()
        ETAT.write_text(json.dumps(etat, indent=2), encoding="utf-8")
        em.set_footer(text="Compteur remis à zéro : le prochain /recap partira d'ici.")
    await inter.followup.send(embed=em)


bot.run(cfg["token"])
