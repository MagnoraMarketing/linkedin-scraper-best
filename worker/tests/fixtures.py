"""Fixture HTML approximating the LinkedIn markup the extractors target.

Kept minimal and focused on the selectors under test, rather than a full page
dump: the point is to pin the extraction rules, not LinkedIn's whole DOM.
"""

PROFILE_HTML = """
<html><body>
  <h1 class="text-heading-xlarge">Jens Hansen</h1>
  <div class="text-body-medium break-words">CFO at Acme A/S</div>
  <span class="text-body-small inline t-black--light break-words">Copenhagen, Capital Region, Denmark</span>
  <span class="text-body-small inline t-black--light break-words">500+ connections</span>
  <section id="experience">
    <div class="pv-entity__secondary-title">Acme A/S</div>
  </section>
  <a href="mailto:jens.hansen@acme.dk">Email</a>
  <a href="tel:+4511223344">Call</a>
  <a href="https://acme.dk">Company site</a>
  <a href="https://www.linkedin.com/company/acme-as/">Acme A/S</a>
</body></html>
"""

PROFILE_HTML_DANISH_TITLE = """
<html><body>
  <h1 class="text-heading-xlarge">Søren Ø. Bak</h1>
  <div class="text-body-medium break-words">Administrerende direktør hos Bak &amp; Co. A/S</div>
  <span class="text-body-small inline t-black--light break-words">Aarhus, Denmark</span>
</body></html>
"""

PROFILE_HTML_MINIMAL = """
<html><body>
  <h1>Mette Nielsen</h1>
</body></html>
"""

PROFILE_HTML_NO_NAME = "<html><body><div>Nothing useful here</div></body></html>"

# A page whose text contains email-shaped strings that are not contact details.
PROFILE_HTML_EMAIL_NOISE = """
<html><body>
  <h1 class="text-heading-xlarge">Peter Sorensen</h1>
  <div class="text-body-medium break-words">Partner at Delta</div>
  <img src="https://media.licdn.com/dms/image/12345678@2x.png">
  <script>Sentry.init({dsn:"https://abc@o12345.sentry.io/1"})</script>
  <span>support@linkedin.com</span>
  <span>peter@delta.dk</span>
</body></html>
"""

SEARCH_RESULTS_HTML = """
<html><body>
  <ul>
    <li><a href="https://www.linkedin.com/in/jens-hansen-123?trk=search">Jens Hansen</a></li>
    <li><a href="https://www.linkedin.com/in/jens-hansen-123/">Jens Hansen (again)</a></li>
    <li><a href="/in/mette-nielsen-456/">Mette Nielsen</a></li>
    <li><a href="https://www.linkedin.com/company/acme">Acme</a></li>
    <li><a href="https://www.linkedin.com/in/unavailable">Hidden member</a></li>
  </ul>
</body></html>
"""

SEARCH_NO_RESULTS_HTML = """
<html><body><h2>No results found</h2></body></html>
"""

CHECKPOINT_HTML = """
<html><body><h1>Let's do a quick security check</h1></body></html>
"""

# LinkedIn serves the apostrophe HTML-escaped in some responses.
CHECKPOINT_HTML_ESCAPED = """
<html><body><h1>Let&#x27;s do a quick security check</h1></body></html>
"""

AUTH_WALL_HTML = """
<html><body><div class="authwall">Sign in to LinkedIn</div></body></html>
"""
