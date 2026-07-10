"""Adaptateur Bien'ici — LA source réellement fonctionnelle en veille automatique.

Contrairement à Leboncoin/PAP/SeLoger (protégés par DataDome et bloqués depuis
les IP de datacenter comme les runners GitHub), l'API publique de Bien'ici
répond correctement sans anti-bot :

  - résolution de lieu :  https://res.bienici.com/suggest.json?q=<ville>
  - recherche d'annonces : https://www.bienici.com/realEstateAds.json?filters=<json>

Bien'ici agrège une grande partie du marché français (agences + particuliers),
locations et ventes. C'est donc la source par défaut de la veille.
"""
from __future__ import annotations

import json
import logging
from urllib.parse import quote, urlencode

from .base import SiteAdapter, Listing, slugify

log = logging.getLogger("bienici")

SUGGEST = "https://res.bienici.com/suggest.json"
SEARCH = "https://www.bienici.com/realEstateAds.json"

FILTER_TYPE = {"location": "rent", "vente": "buy"}
PROPERTY_TYPE = {"appartement": "flat", "maison": "house"}


class Bienici(SiteAdapter):
    name = "bienici"

    # ---- résolution de lieu (ville -> zoneIds internes Bien'ici) ----
    def _zone_ids(self, villes: list[str], session) -> list[str]:
        zones: list[str] = []
        for ville in villes:
            try:
                r = session.get(SUGGEST, params={"q": ville}, timeout=15)
                if r.status_code != 200:
                    continue
                for item in r.json():
                    # on privilégie la correspondance ville/commune exacte
                    if item.get("type") in ("city", "arrondissement", "department", "postalCode") \
                            and item.get("name", "").lower().startswith(ville.lower()[:4]):
                        zones.extend(item.get("zoneIds", []))
                        break
                else:
                    # à défaut, on prend le 1er résultat
                    data = r.json()
                    if data:
                        zones.extend(data[0].get("zoneIds", []))
            except Exception as e:
                log.warning("Résolution de '%s' impossible : %s", ville, e)
        # dédup en gardant l'ordre
        return list(dict.fromkeys(zones))

    def _build_filters(self, c: dict, zone_ids: list[str]) -> dict:
        types = [PROPERTY_TYPE[t] for t in c.get("typeBien", []) if t in PROPERTY_TYPE] or ["flat"]
        f: dict = {
            "size": 50,
            "from": 0,
            "page": 1,
            "filterType": FILTER_TYPE.get(c.get("transaction"), "rent"),
            "propertyType": types,
            "sortBy": "publicationDate",
            "sortOrder": "desc",
        }
        if zone_ids:
            f["zoneIdsByTypes"] = {"zoneIds": zone_ids}
        if c.get("prixMin") is not None:
            f["minPrice"] = c["prixMin"]
        if c.get("prixMax") is not None:
            f["maxPrice"] = c["prixMax"]
        if c.get("surfaceMin") is not None:
            f["minArea"] = c["surfaceMin"]
        if c.get("surfaceMax") is not None:
            f["maxArea"] = c["surfaceMax"]
        if c.get("piecesMin") is not None:
            f["minRooms"] = c["piecesMin"]
        if c.get("piecesMax") is not None:
            f["maxRooms"] = c["piecesMax"]
        owner = c.get("ownerType")
        if owner == "private":
            f["onTheMarketTypes"] = ["by-individuals"]
        elif owner == "pro":
            f["onTheMarketTypes"] = ["with-agencies"]
        else:
            f["onTheMarketTypes"] = ["with-agencies", "by-individuals"]
        return f

    def search_url(self, c: dict) -> str:
        # Lien "humain" pour l'onglet Recherches (page de résultats Bien'ici).
        kind = "location" if c.get("transaction") != "vente" else "achat"
        bien = "maison" if (c.get("typeBien") == ["maison"]) else "appartement"
        slug = slugify(c["villes"][0]) if c.get("villes") else ""
        base = f"https://www.bienici.com/recherche/{kind}/{slug or 'france'}/{bien}"
        params = {}
        if c.get("prixMax"):
            params["prix-max"] = c["prixMax"]
        if c.get("surfaceMin"):
            params["surface-min"] = c["surfaceMin"]
        if c.get("piecesMin"):
            params["pieces-min"] = c["piecesMin"]
        return base + ("?" + urlencode(params) if params else "")

    def fetch(self, c: dict, session) -> list[Listing]:
        zone_ids = self._zone_ids(c.get("villes", []), session)
        if c.get("villes") and not zone_ids:
            log.warning("Aucune zone résolue pour %s : recherche nationale.", c.get("villes"))
        filters = self._build_filters(c, zone_ids)
        url = SEARCH + "?filters=" + quote(json.dumps(filters))
        try:
            r = session.get(url, timeout=25)
            if r.status_code != 200:
                log.warning("Bien'ici a répondu %s", r.status_code)
                return []
            data = r.json()
        except Exception as e:
            log.warning("Bien'ici indisponible (%s)", e)
            return []

        out: list[Listing] = []
        for ad in data.get("realEstateAds", []):
            out.append(self._parse(ad, c))
        log.info("Bien'ici : %d annonces (sur %s correspondances)",
                 len(out), data.get("total"))
        return out

    def _parse(self, ad: dict, c: dict) -> Listing:
        photos = ad.get("photos") or []
        image = ""
        if photos and isinstance(photos[0], dict):
            image = photos[0].get("url_photo") or photos[0].get("url") or ""
        price = ad.get("price")
        unit = " €/mois" if c.get("transaction") != "vente" else " €"
        city = ad.get("city", "")
        cp = ad.get("postalCode", "")
        return Listing(
            source=self.name,
            title=ad.get("title") or ad.get("description", "")[:80] or "Annonce Bien'ici",
            url=f"https://www.bienici.com/annonce/{ad.get('id')}",
            price=(f"{int(price):,}".replace(",", " ") + unit) if isinstance(price, (int, float)) else "",
            surface=_to_int(ad.get("surfaceArea")),
            rooms=_to_int(ad.get("roomsQuantity")),
            location=" ".join(filter(None, [city, cp])),
            image=image,
            postedAt=ad.get("publicationDate", "") or ad.get("modificationDate", ""),
        )


def _to_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None
