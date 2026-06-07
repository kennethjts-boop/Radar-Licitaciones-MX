from app.models.schemas import RawItem, SocialEvent
from app.processing.classifier import classify_text
from app.processing.normalizer import normalize_raw_item
from app.processing.scoring import score_event
from app.services.event_store import InMemoryEventStore


def process_raw_items(
    raw_items: list[RawItem],
    store: InMemoryEventStore,
    min_alert_score: int = 75,
) -> list[SocialEvent]:
    events: list[SocialEvent] = []
    known = store.known_hashes()

    for raw in raw_items:
        normalized = normalize_raw_item(raw)
        if normalized.canonical_hash in known:
            continue

        classification = classify_text(normalized.title, normalized.text)
        score = score_event(normalized, classification, min_alert_score=min_alert_score)
        event = SocialEvent(
            title=normalized.title,
            description=normalized.text,
            category=classification.category,
            region=normalized.region,
            confidence=classification.confidence,
            score=score,
            sources=[normalized.source_name],
            urls=[normalized.url] if normalized.url else [],
            canonical_hash=normalized.canonical_hash,
            occurred_at=normalized.published_at,
            tags=classification.tags,
        )
        store.upsert(event)
        known.add(event.canonical_hash)
        events.append(event)

    return events
