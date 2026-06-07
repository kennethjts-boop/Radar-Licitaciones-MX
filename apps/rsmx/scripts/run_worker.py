from datetime import UTC, datetime

from app.models.schemas import RawItem
from app.services.event_store import InMemoryEventStore
from app.workers.monitor import process_raw_items


def main() -> None:
    store = InMemoryEventStore()
    sample = RawItem(
        source_id="manual",
        source_name="RSmx worker bootstrap",
        title="Worker RSmx iniciado sin fuentes configuradas",
        text="Configure RSS, GDELT o fuentes oficiales publicas para iniciar monitoreo.",
        published_at=datetime.now(UTC),
    )
    events = process_raw_items([sample], store)
    print(f"RSmx worker listo. Eventos procesados en arranque: {len(events)}")


if __name__ == "__main__":
    main()
