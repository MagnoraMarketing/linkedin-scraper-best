"""Tests for the HTML extraction rules ported from the upstream scraper."""

from bs4 import BeautifulSoup

from linkedin_lead_worker import parsing

from . import fixtures


# ---------------------------------------------------------------------------
#  Search URL construction
# ---------------------------------------------------------------------------


def test_search_url_quotes_the_title():
    url = parsing.build_people_search_url("Finance Director", geo_urn="104514075")
    # Quoting makes LinkedIn match the phrase rather than the loose word union.
    assert "keywords=%22Finance+Director%22" in url
    assert "geoUrn=%5B%22104514075%22%5D" in url


def test_search_url_omits_geo_urn_when_unknown():
    url = parsing.build_people_search_url("CFO", geo_urn=None)
    assert "geoUrn" not in url
    assert "keywords=%22CFO%22" in url


def test_search_url_adds_page_number_only_after_the_first():
    assert "&page=" not in parsing.build_people_search_url("CFO", page=1)
    assert parsing.build_people_search_url("CFO", page=3).endswith("&page=3")


def test_search_url_appends_extra_keywords():
    url = parsing.build_people_search_url("CFO", extra_keywords=["Copenhagen"])
    assert "%22CFO%22+%22Copenhagen%22" in url


# ---------------------------------------------------------------------------
#  Search result parsing
# ---------------------------------------------------------------------------


def test_extract_profile_urls_deduplicates_and_canonicalises():
    urls = parsing.extract_profile_urls(fixtures.SEARCH_RESULTS_HTML)

    assert "https://www.linkedin.com/in/jens-hansen-123" in urls
    assert "https://www.linkedin.com/in/mette-nielsen-456" in urls
    # The same profile linked twice, with and without a query string.
    assert len([u for u in urls if "jens-hansen-123" in u]) == 1


def test_extract_profile_urls_skips_company_and_placeholder_links():
    urls = parsing.extract_profile_urls(fixtures.SEARCH_RESULTS_HTML)
    assert not any("/company/" in u for u in urls)
    assert not any(u.endswith("/in/unavailable") for u in urls)


def test_extract_profile_urls_on_empty_page():
    assert parsing.extract_profile_urls("<html><body></body></html>") == []


def test_has_no_results():
    assert parsing.has_no_results(fixtures.SEARCH_NO_RESULTS_HTML) is True
    assert parsing.has_no_results(fixtures.SEARCH_RESULTS_HTML) is False


# ---------------------------------------------------------------------------
#  Block detection — these must never try to work around the block
# ---------------------------------------------------------------------------


def test_detect_challenge_from_url():
    assert parsing.detect_block("https://www.linkedin.com/checkpoint/challenge", "") == "challenge"
    assert parsing.detect_block("https://www.linkedin.com/uas/verification", "") == "challenge"


def test_detect_challenge_from_page_body():
    assert parsing.detect_block("https://www.linkedin.com/feed/", fixtures.CHECKPOINT_HTML) == "challenge"


def test_detect_challenge_with_escaped_apostrophe():
    # LinkedIn escapes the apostrophe in some responses and not others.
    assert (
        parsing.detect_block("https://www.linkedin.com/feed/", fixtures.CHECKPOINT_HTML_ESCAPED)
        == "challenge"
    )


def test_detect_auth_wall():
    assert parsing.detect_block("https://www.linkedin.com/authwall", "") == "auth_wall"
    assert parsing.detect_block("https://www.linkedin.com/feed/", fixtures.AUTH_WALL_HTML) == "auth_wall"


def test_normal_page_is_not_blocked():
    assert parsing.detect_block(
        "https://www.linkedin.com/in/jens-hansen", fixtures.PROFILE_HTML
    ) is None


# ---------------------------------------------------------------------------
#  Profile field extraction
# ---------------------------------------------------------------------------


def test_parse_profile_extracts_every_supported_field():
    fields = parsing.parse_profile(
        fixtures.PROFILE_HTML, "https://www.linkedin.com/in/jens-hansen"
    )

    assert fields["full_name"] == "Jens Hansen"
    assert fields["job_title"] == "CFO"
    assert fields["company_name"] == "Acme A/S"
    assert fields["location"] == "Copenhagen, Capital Region, Denmark"
    assert fields["email"] == "jens.hansen@acme.dk"
    assert fields["phone"] == "+4511223344"
    assert fields["company_website"] == "https://acme.dk"
    assert fields["company_linkedin_url"] == "https://www.linkedin.com/company/acme-as"


def test_parse_profile_handles_danish_headline_separator():
    fields = parsing.parse_profile(fixtures.PROFILE_HTML_DANISH_TITLE, "https://x/in/soren")

    assert fields["full_name"] == "Søren Ø. Bak"
    # "hos" is the Danish "at".
    assert fields["job_title"] == "Administrerende direktør"
    assert fields["company_name"] == "Bak & Co. A/S"


def test_missing_fields_are_none_not_empty_string():
    # A missing value must stay missing all the way into the database, rather
    # than becoming an empty string that looks like a real answer.
    fields = parsing.parse_profile(fixtures.PROFILE_HTML_MINIMAL, "https://x/in/mette")

    assert fields["full_name"] == "Mette Nielsen"
    assert fields["email"] is None
    assert fields["phone"] is None
    assert fields["company_name"] is None
    assert fields["job_title"] is None


def test_parse_profile_without_a_name_returns_none_rather_than_raising():
    fields = parsing.parse_profile(fixtures.PROFILE_HTML_NO_NAME, "https://x/in/ghost")
    assert fields["full_name"] is None


def test_location_extraction_ignores_connection_counts():
    soup = BeautifulSoup(fixtures.PROFILE_HTML, "html.parser")
    assert "connections" not in (parsing.extract_location(soup) or "")


# ---------------------------------------------------------------------------
#  Contact extraction — no invented data
# ---------------------------------------------------------------------------


def test_email_extraction_filters_out_asset_and_vendor_addresses():
    soup = BeautifulSoup(fixtures.PROFILE_HTML_EMAIL_NOISE, "html.parser")
    email = parsing.extract_email(soup)

    assert email == "peter@delta.dk"
    assert email != "support@linkedin.com"


def test_email_extraction_rejects_image_hashes():
    soup = BeautifulSoup(
        '<html><body><span>12345678@2x.png</span></body></html>', "html.parser"
    )
    assert parsing.extract_email(soup) is None


def test_phone_requires_an_explicit_tel_link():
    # Upstream scanned free text with a US number pattern and matched post
    # counts and dates. A wrong number in a dialer is worse than no number.
    soup = BeautifulSoup(
        "<html><body><p>Posted 555 123 4567 times since 2019</p></body></html>",
        "html.parser",
    )
    assert parsing.extract_phone(soup) is None


def test_phone_is_read_from_a_tel_link():
    soup = BeautifulSoup('<a href="tel:+4520304050">Call</a>', "html.parser")
    assert parsing.extract_phone(soup) == "+4520304050"


# ---------------------------------------------------------------------------
#  Post-filtering
# ---------------------------------------------------------------------------


def test_title_matches_is_case_insensitive_and_substring_based():
    assert parsing.title_matches("Group CFO", ["CFO"]) is True
    assert parsing.title_matches("cfo & co-founder", ["CFO"]) is True
    assert parsing.title_matches("Software Engineer", ["CFO", "CEO"]) is False
    assert parsing.title_matches(None, ["CFO"]) is False


def test_location_matches_accepts_everything_when_unfiltered():
    assert parsing.location_matches("Anywhere", "all") is True
    assert parsing.location_matches(None, "all") is True
    assert parsing.location_matches("Copenhagen, Denmark", "copenhagen") is True
    assert parsing.location_matches("Aarhus, Denmark", "copenhagen") is False
    assert parsing.location_matches(None, "copenhagen") is False
