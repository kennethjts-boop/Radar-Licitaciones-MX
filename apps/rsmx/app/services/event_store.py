from app.models.schemas import SocialEvent


class InMemoryEventStore:
    def __init__(self) -> None:
        self._events: dict[str, SocialEvent] = {}

    def upsert(self, event: SocialEvent) -> SocialEvent:
        self._events[event.canonical_hash] = event
        return event

    def recent(self, limit: int = 20, category: str | None = None) -> list[SocialEvent]:
        events = list(self._events.values())
        if category:
            events = [event for event in events if event.category.value == category]
        return sorted(events, key=lambda event: event.occurred_at, reverse=True)[:limit]

    def top(self, limit: int = 5) -> list[SocialEvent]:
        return sorted(self._events.values(), key=lambda event: event.score.final_score, reverse=True)[:limit]

    def known_hashes(self) -> set[str]:
        return set(self._events)
