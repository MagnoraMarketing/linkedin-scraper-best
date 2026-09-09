"""LinkedIn location ids.

LinkedIn filters people search on numeric geo ids. Only ids verified against a
real LinkedIn search URL are listed here; anything unverified is None, and the
scraper falls back to matching the location text on each profile rather than
guessing an id and silently searching the wrong place.

To add one: run the search in a browser with the location filter applied, and
read `geoUrn=%5B"104514075"%5D` out of the address bar.
"""

from __future__ import annotations

from dataclasses import dataclass

# Country code -> LinkedIn geo id.
COUNTRY_GEO_URNS: dict[str, str | None] = {
    "DK": "104514075",   # Denmark
    "GB": "101165590",   # United Kingdom
    "DE": "101282230",   # Germany
    "SE": None,
    "NO": None,
    "NL": None,
    "ES": None,
}

COUNTRY_NAMES: dict[str, str] = {
    "DK": "Denmark",
    "SE": "Sweden",
    "NO": "Norway",
    "DE": "Germany",
    "NL": "Netherlands",
    "GB": "United Kingdom",
    "ES": "Spain",
}

# City slug -> LinkedIn geo id. None means "filter by text instead".
CITY_GEO_URNS: dict[str, str | None] = {
    "copenhagen": None,
    "aarhus": None,
    "odense": None,
    "aalborg": None,
}

# City slug -> the words to look for in a profile's location line.
CITY_TEXT_MATCHES: dict[str, tuple[str, ...]] = {
    "copenhagen": ("copenhagen", "københavn", "kobenhavn", "kbh"),
    "aarhus": ("aarhus", "århus"),
    "odense": ("odense",),
    "aalborg": ("aalborg", "ålborg"),
}


@dataclass(frozen=True)
class ResolvedLocation:
    """How one job's location should be applied."""

    geo_urn: str | None
    #: Substrings to match against a profile's location when geo_urn is None.
    text_matches: tuple[str, ...]
    #: Human-readable country name, stored on each lead.
    country_name: str

    @property
    def filters_server_side(self) -> bool:
        return self.geo_urn is not None


def resolve_location(country_code: str, location: str) -> ResolvedLocation:
    """Works out the tightest filter available for a country/location pair.

    A city with a known geo id filters server-side. A city without one falls
    back to the country's geo id plus a text match on each profile — narrower
    results than no filter at all, and honest about what it can do.
    """
    country_code = (country_code or "DK").upper()
    country_urn = COUNTRY_GEO_URNS.get(country_code)
    country_name = COUNTRY_NAMES.get(country_code, country_code)

    slug = (location or "all").strip().lower()

    if slug in ("", "all"):
        return ResolvedLocation(country_urn, (), country_name)

    city_urn = CITY_GEO_URNS.get(slug)
    if city_urn:
        return ResolvedLocation(city_urn, (), country_name)

    # Known city without a verified id, or a free-text location the user typed.
    matches = CITY_TEXT_MATCHES.get(slug, (slug,))
    return ResolvedLocation(country_urn, matches, country_name)


def location_text_matches(location: str | None, matches: tuple[str, ...]) -> bool:
    """True when no text filter applies, or the profile's location satisfies it."""
    if not matches:
        return True
    if not location:
        return False
    lowered = location.lower()
    return any(match in lowered for match in matches)
