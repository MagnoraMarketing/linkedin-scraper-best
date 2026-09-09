# Scraper worker image.
#
# Based on Playwright's official image, which already carries Chromium and the
# system libraries it needs — the exact combination that cannot be shipped
# inside a Vercel Function bundle.

FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SCRAPER_HEADLESS=true \
    SCRAPER_SESSION_DIR=/data/session

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY linkedin_lead_worker ./linkedin_lead_worker

# The LinkedIn session cache lives here. Mount a volume so a restart does not
# force a fresh sign-in (which is what triggers verification challenges).
RUN mkdir -p /data/session

# Run as the non-root user the base image provides.
USER pwuser

CMD ["python", "-m", "linkedin_lead_worker.main"]
