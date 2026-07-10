"""Adaptateur Leboncoin.

Leboncoin protège fortement son site (DataDome). Le scraping direct depuis
une IP de datacenter (comme les runners GitHub) est souvent bloqué.

Cet adaptateur :
  1. construit une URL de recherche filtrée 100 % fiable ;
  2. tente une récupération via l'API interne, et échoue proprement si bloqué.

Pour une récupération robuste en production, branchez ici un proxy
résidentiel ou un service d'API tiers (voir README).
"""
from __future__ import annotations

import logging
from urllib.parse import urlencode

from .base import SiteAdapter, Listing, build_range

log = logging.getLogger("leboncoin")

CATEGORY = {"location": "10", "vente": "9"}
REAL_ESTATE_TYPE = {"maison": "1", "appartement": "2"}
API = "https://api.leboncoin.fr/finder/search"


class Leboncoin(SiteAdapter):
    name = "leboncoin"

    def search_url(self, c: dict) -> str:
        p = {"category": CATEGORY.get(c.get("transaction"), "10")}
        if c.get("villes"):
            p["locations"] = ",".join(c["villes"])
        for key, (lo, hi) in {
            "price": ("prixMin", "prixMax"),
            "square": ("surfaceMin", "surfaceMax"),
            "rooms": ("piecesMin", "piecesMax"),
        }.items():
            r = build_range(c.get(lo), c.get(hi))
            if r:
                p[key] = r
        types = [REAL_ESTATE_TYPE[t] for t in c.get("typeBien", []) if t in REAL_ESTATE_TYPE]
        if types:
            p["real_estate_type"] = ",".join(types)
        if c.get("ownerType") in ("private", "pro"):
            p["owner_type"] = c["ownerType"]
        p["sort"] = "time"
        p["order"] = "desc"
        return "https://www.leboncoin.fr/recherche?" + urlencode(p)

    def fetch(self, c: dict, session) -> list[Listing]:
        payload = self._build_api_payload(c)
        try:
            r = session.post(API, json=payload, timeout=20)
            if r.status_code != 200:
                log.warning("Leboncoin a répondu %s (probable blocage anti-bot). "
                            "Utilisez l'URL de recherche filtrée : %s",
                            r.status_code, self.search_url(c))
                return []
            data = r.json()
        except Exception as e:  # réseau, JSON, blocage…
            log.warning("Leboncoin indisponible (%s). URL de secours : %s", e, self.search_url(c))
            return []

        out: list[Listing] = []
        for ad in data.get("ads", []):
            out.append(self._parse_ad(ad))
        log.info("Leboncoin : %d annonces", len(out))
        return out

    def _build_api_payload(self, c: dict) -> dict:
        filt: dict = {"category": {"id": CATEGORY.get(c.get("transaction"), "10")},
                      "enums": {}, "ranges": {}, "location": {}}
        types = [REAL_ESTATE_TYPE[t] for t in c.get("typeBien", []) if t in REAL_ESTATE_TYPE]
        if types:
            filt["enums"]["real_estate_type"] = types
        if c.get("ownerType") in ("private", "pro"):
            filt["owner_type"] = c["ownerType"]
        for field_name, lo, hi in [
            ("price", c.get("prixMin"), c.get("prixMax")),
            ("square", c.get("surfaceMin"), c.get("surfaceMax")),
            ("rooms", c.get("piecesMin"), c.get("piecesMax")),
        ]:
            rng = {}
            if lo is not None:
                rng["min"] = lo
            if hi is not None:
                rng["max"] = hi
            if rng:
                filt["ranges"][field_name] = rng
        if c.get("villes"):
            filt["location"]["city_zipcodes"] = [{"city": v} for v in c["villes"]]
        return {"filters": filt, "limit": 35, "sort_by": "time", "sort_order": "desc"}

    def _parse_ad(self, ad: dict) -> Listing:
        attrs = {a.get("key"): a.get("value") for a in ad.get("attributes", [])}
        images = ad.get("images", {}) or {}
        loc = ad.get("location", {}) or {}
        return Listing(
            source=self.name,
            title=ad.get("subject", ""),
            url=ad.get("url", ""),
            price=(f"{ad['price'][0]} €" if ad.get("price") else ""),
            surface=_to_int(attrs.get("square")),
            rooms=_to_int(attrs.get("rooms")),
            location=" ".join(filter(None, [loc.get("city"), loc.get("zipcode")])),
            image=images.get("thumb_url", "") or (images.get("urls", [""])[0] if images.get("urls") else ""),
            postedAt=ad.get("first_publication_date", ""),
        )


def _to_int(v):
    try:
        return int(str(v).split()[0])
    except (TypeError, ValueError):
        return None
