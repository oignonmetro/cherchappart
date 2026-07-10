"""Adaptateur PAP (Particulier à Particulier).

PAP est plus léger que Leboncoin et parse-able en HTML, mais la structure
de la page peut changer : le parsing est défensif et échoue proprement.
"""
from __future__ import annotations

import logging
import re

from .base import SiteAdapter, Listing, slugify

log = logging.getLogger("pap")


class Pap(SiteAdapter):
    name = "pap"

    def search_url(self, c: dict) -> str:
        t = "ventes" if c.get("transaction") == "vente" else "locations"
        types = c.get("typeBien", [])
        bien = "maison" if (types == ["maison"]) else "appartement"
        url = f"https://www.pap.fr/annonce/{t}-{bien}"
        if c.get("villes"):
            slug = slugify(c["villes"][0])
            if slug:
                url += f"-{slug}"
        return url

    def fetch(self, c: dict, session) -> list[Listing]:
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            log.error("beautifulsoup4 manquant : pip install -r requirements.txt")
            return []

        url = self.search_url(c)
        try:
            r = session.get(url, timeout=20)
            if r.status_code != 200:
                log.warning("PAP a répondu %s pour %s", r.status_code, url)
                return []
        except Exception as e:
            log.warning("PAP indisponible (%s). URL : %s", e, url)
            return []

        soup = BeautifulSoup(r.text, "html.parser")
        out: list[Listing] = []
        max_price = c.get("prixMax")
        min_surface = c.get("surfaceMin")

        for card in soup.select(".search-list-item-alt, .item-body"):
            a = card.select_one("a.item-title, a[href*='/annonces/']")
            if not a:
                continue
            href = a.get("href", "")
            if href.startswith("/"):
                href = "https://www.pap.fr" + href
            title = a.get_text(strip=True)
            price_el = card.select_one(".item-price")
            price = price_el.get_text(strip=True) if price_el else ""
            text = card.get_text(" ", strip=True)
            surface = _extract(r"(\d+)\s*m", text)
            rooms = _extract(r"(\d+)\s*pi[eè]ce", text)
            img_el = card.select_one("img")
            image = (img_el.get("data-original") or img_el.get("src") or "") if img_el else ""

            # Filtrage local (PAP ne filtre pas fiablement par URL).
            if max_price and _price_value(price) and _price_value(price) > max_price:
                continue
            if min_surface and surface and surface < min_surface:
                continue

            out.append(Listing(
                source=self.name, title=title, url=href, price=price,
                surface=surface, rooms=rooms, image=image,
                location=c["villes"][0] if c.get("villes") else "",
            ))

        log.info("PAP : %d annonces", len(out))
        return out


def _extract(pattern: str, text: str):
    m = re.search(pattern, text, re.I)
    return int(m.group(1)) if m else None


def _price_value(price: str):
    digits = re.sub(r"[^\d]", "", price or "")
    return int(digits) if digits else None
