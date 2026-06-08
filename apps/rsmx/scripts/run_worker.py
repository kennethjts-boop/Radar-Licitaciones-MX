import sys
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import get_settings  # noqa: E402
from app.database import SupabaseConfig, is_configured  # noqa: E402
from app.models.schemas import RawItem  # noqa: E402
from app.services.event_store import InMemoryEventStore  # noqa: E402
from app.workers.monitor import process_raw_items  # noqa: E402


def main() -> None:
    settings = get_settings()
    supabase_ready = is_configured(
        SupabaseConfig(
            url=settings.SUPABASE_URL,
            service_role_key=settings.SUPABASE_SERVICE_ROLE_KEY,
            anon_key=settings.SUPABASE_ANON_KEY,
        )
    )
    telegram_ready = bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_DEFAULT_CHAT_ID)

    if not supabase_ready:
        print("RSmx Supabase no configurado; usando modo local sin persistencia remota.")
    if not telegram_ready:
        print("RSmx Telegram no configurado; omitiendo envio de alertas externas.")

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
