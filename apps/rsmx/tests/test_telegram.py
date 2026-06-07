from datetime import UTC, datetime

from app.bot.telegram import format_event_alert
from app.models.schemas import EventCategory, EventScore, SocialEvent


def test_telegram_format_is_not_empty() -> None:
    event = SocialEvent(
        title="Autopista cerrada por bloqueo",
        description="Cierre reportado por fuente publica.",
        category=EventCategory.MOVILIDAD,
        confidence=0.9,
        score=EventScore(
            final_score=88,
            recency_score=25,
            intent_score=25,
            severity_score=12,
            source_score=12,
            confidence_score=14,
            reasons=["test"],
        ),
        sources=["CAPUFE"],
        urls=["https://example.com/evento"],
        canonical_hash="abc",
        occurred_at=datetime.now(UTC),
    )

    message = format_event_alert(event)

    assert message.strip()
    assert "RSmx alerta" in message
