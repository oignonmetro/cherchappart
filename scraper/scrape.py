#!/usr/bin/env python3
"""Orchestrateur de la veille ChercheAppart.

Lit data/criteria.json, interroge chaque site sélectionné, fusionne les
résultats avec l'historique data/listings.json (sans doublon) et réécrit
le fichier. Conçu pour tourner dans GitHub Actions (cron).

Usage :
    python scraper/scrape.py                # chemins par défaut
    python scraper/scrape.py --dry-run      # n'écrit rien, affiche le résumé
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from sites import get_adapter
from sites.base import UA

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scrape")

ROOT = pathlib.Path(__file__).resolve().parent.parent
CRITERIA_PATH = ROOT / "scraper" / "criteria.example.json"
LISTINGS_PATH = ROOT / "listings.json"
MAX_KEEP = 500  # taille max de l'historique conservé


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as e:
        log.warning("Impossible de lire %s (%s), valeur par défaut.", path, e)
        return default


def make_session():
    try:
        import requests
    except ImportError:
        log.error("Le module 'requests' est requis : pip install -r scraper/requirements.txt")
        raise
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
    })
    return s


def excluded(listing: dict, mots: list[str]) -> bool:
    hay = f"{listing.get('title','')} {listing.get('location','')}".lower()
    return any(m and m in hay for m in mots)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--criteria", default=str(CRITERIA_PATH))
    ap.add_argument("--out", default=str(LISTINGS_PATH))
    args = ap.parse_args()

    criteria = load_json(pathlib.Path(args.criteria), {})
    if not criteria:
        log.error("Aucun critère : créez data/criteria.json (exportable depuis l'interface).")
        return 1

    sites = criteria.get("sites", [])
    mots_exclus = [m.lower() for m in criteria.get("motsExclus", [])]
    log.info("Critères : sites=%s villes=%s", sites, criteria.get("villes"))

    session = make_session()
    fresh: list[dict] = []
    for site in sites:
        adapter = get_adapter(site)
        if not adapter:
            log.warning("Aucun adaptateur pour '%s' (ignoré).", site)
            continue
        try:
            for listing in adapter.fetch(criteria, session):
                d = listing.to_dict()
                if not excluded(d, mots_exclus):
                    fresh.append(d)
        except Exception as e:  # un site ne doit jamais casser les autres
            log.exception("Erreur sur %s : %s", site, e)

    # Fusion avec l'historique (dédup par id, nouveaux en tête).
    previous = load_json(pathlib.Path(args.out), {}).get("listings", [])
    known = {l["id"]: l for l in previous}
    added = 0
    for d in fresh:
        if d["id"] not in known:
            added += 1
        known[d["id"]] = d  # met à jour prix/infos si déjà connu

    merged = sorted(known.values(),
                    key=lambda l: l.get("postedAt", ""), reverse=True)[:MAX_KEEP]

    result = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "count": len(merged),
        "listings": merged,
    }

    log.info("Récupéré %d annonces (%d nouvelles). Total conservé : %d",
             len(fresh), added, len(merged))

    if args.dry_run:
        log.info("[dry-run] Rien écrit.")
        return 0

    pathlib.Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Écrit dans %s", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
