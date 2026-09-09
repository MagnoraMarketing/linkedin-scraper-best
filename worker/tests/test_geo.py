"""Location resolution, including the honest fallback for unverified cities."""

from linkedin_lead_worker.geo import (
    COUNTRY_GEO_URNS,
    location_text_matches,
    resolve_location,
)


def test_denmark_filters_server_side():
    resolved = resolve_location("DK", "all")

    assert resolved.geo_urn == "104514075"
    assert resolved.filters_server_side is True
    assert resolved.country_name == "Denmark"
    # Nothing further to filter: the geo id already narrowed the search.
    assert resolved.text_matches == ()


def test_unverified_city_falls_back_to_country_plus_text_match():
    resolved = resolve_location("DK", "copenhagen")

    # Still narrowed to Denmark server-side...
    assert resolved.geo_urn == "104514075"
    # ...then filtered by the profile's own location text.
    assert "copenhagen" in resolved.text_matches
    assert "københavn" in resolved.text_matches


def test_free_text_location_is_matched_literally():
    resolved = resolve_location("DK", "Esbjerg")
    assert resolved.text_matches == ("esbjerg",)


def test_country_without_a_verified_id_does_not_guess_one():
    # A wrong geo id would silently search the wrong country, which is worse
    # than not filtering server-side at all.
    assert COUNTRY_GEO_URNS["SE"] is None
    resolved = resolve_location("SE", "all")
    assert resolved.geo_urn is None
    assert resolved.filters_server_side is False
    assert resolved.country_name == "Sweden"


def test_unknown_country_code_is_handled():
    resolved = resolve_location("ZZ", "all")
    assert resolved.geo_urn is None
    assert resolved.country_name == "ZZ"


def test_location_text_matching():
    assert location_text_matches("Copenhagen, Denmark", ("copenhagen", "københavn")) is True
    assert location_text_matches("København, Danmark", ("copenhagen", "københavn")) is True
    assert location_text_matches("Aarhus, Denmark", ("copenhagen",)) is False
    assert location_text_matches(None, ("copenhagen",)) is False
    # No filter configured means everything passes.
    assert location_text_matches(None, ()) is True
    assert location_text_matches("Anywhere", ()) is True
