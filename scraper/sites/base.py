"""Socle commun aux adaptateurs de site."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field, asdict


UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


@dataclass
class Listing:
    source: str
    title: str
    url: str
    price: str = ""
    surface: int | None = None
    rooms: int | None = None
    bedrooms: int | None = None
    location: str = ""
    image: str = ""
    contactEmail: str = ""
    postedAt: str = ""
    id: str = field(default="")

    def __post_init__(self):
        if not self.id:
            # id stable dérivé de l'URL : évite les doublons entre exécutions.
            self.id = self.source + "-" + hashlib.sha1(self.url.encode()).hexdigest()[:12]

    def to_dict(self) -> dict:
        return asdict(self)


def build_range(lo, hi) -> str | None:
    if lo is None and hi is None:
        return None
    return f"{lo if lo is not None else 'min'}-{hi if hi is not None else 'max'}"


def slugify(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return text


class SiteAdapter:
    """Interface d'un adaptateur de site."""

    name: str = "base"

    def search_url(self, criteria: dict) -> str:
        raise NotImplementedError

    def fetch(self, criteria: dict, session) -> list[Listing]:
        """Retourne les annonces. Doit échouer proprement (liste vide + log)."""
        raise NotImplementedError
