import re
from datetime import UTC, datetime

from app.models.schemas import NormalizedItem, RawItem
from app.processing.classifier import classify_text
from app.processing.deduplicator import build_event_hash

PHONE_RE = re.compile(r"(?<!\d)(?:\+?52\s*)?(?:\d[\s-]?){10,12}(?!\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PRIVATE_PLATE_RE = re.compile(r"\b[A-Z]{2,3}[-\s]?\d{3,4}[-\s]?[A-Z]?\b")


def redact_sensitive_data(value: str) -> str:
    redacted = PHONE_RE.sub("[telefono omitido]", value or "")
    redacted = EMAIL_RE.sub("[correo omitido]", redacted)
    return PRIVATE_PLATE_RE.sub("[placa omitida]", redacted)


def normalize_raw_item(raw: RawItem, default_region: str = "morelos") -> NormalizedItem:
    title = redact_sensitive_data(raw.title).strip()
    text = redact_sensitive_data(raw.text or raw.title).strip()
    published_at = raw.published_at or datetime.now(UTC)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=UTC)

    classification = classify_text(title, text)
    canonical_hash = build_event_hash(title=title, region=default_region, category=classification.category.value)

    return NormalizedItem(
        source_id=raw.source_id,
        source_name=raw.source_name,
        title=title,
        url=raw.url,
        text=text,
        region=default_region,
        published_at=published_at,
        canonical_hash=canonical_hash,
        raw_payload=raw.raw_payload,
    )
