from app.bot.telegram import format_event_alert
from app.models.schemas import AlertPayload, SocialEvent


def should_alert(event: SocialEvent) -> bool:
    return event.score.final_score >= event.score.min_alert_score


def build_alert_payload(event: SocialEvent, chat_id: str | None = None) -> AlertPayload | None:
    if not should_alert(event):
        return None
    return AlertPayload(event=event, chat_id=chat_id, sent=False)


def render_alert_message(payload: AlertPayload) -> str:
    return format_event_alert(payload.event)
