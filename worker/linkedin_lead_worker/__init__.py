"""LinkedIn Lead Finder scraper worker.

A long-running service that claims scraping jobs from Supabase, drives a
Playwright browser against LinkedIn, and writes deduplicated leads back.

Runs outside Vercel by design: Vercel Functions cap out well below the runtime
a conservative scrape needs, and cannot ship a Chromium binary inside the
function bundle. See the project README for the full reasoning.
"""

__version__ = "1.0.0"
