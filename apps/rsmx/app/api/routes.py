from fastapi import APIRouter, Query

from app.bot.commands import route_command
from app.services.event_store import InMemoryEventStore


def build_router(store: InMemoryEventStore) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "Radar-Social-MX"}

    @router.post("/telegram/webhook")
    async def telegram_webhook(payload: dict) -> dict[str, str]:
        message = payload.get("message") or payload.get("edited_message") or {}
        text = message.get("text", "")
        response = route_command(text)
        return {"status": "ok", "reply": response.text}

    @router.get("/events/recent")
    def recent_events(limit: int = Query(default=20, ge=1, le=100), category: str | None = None) -> list[dict]:
        return [event.model_dump(mode="json") for event in store.recent(limit=limit, category=category)]

    @router.get("/events/top")
    def top_events(limit: int = Query(default=5, ge=1, le=25)) -> list[dict]:
        return [event.model_dump(mode="json") for event in store.top(limit=limit)]

    @router.get("/sources")
    def sources() -> list[dict[str, str | bool]]:
        return [
            {"id": "rss_public_media", "name": "RSS medios publicos", "kind": "rss", "enabled": True},
            {"id": "gdelt", "name": "GDELT", "kind": "api", "enabled": True},
            {"id": "official", "name": "Fuentes oficiales configurables", "kind": "official", "enabled": True},
        ]

    return router
