from fastapi import FastAPI

from app.api.routes import build_router
from app.config import get_settings
from app.services.event_store import InMemoryEventStore

settings = get_settings()
store = InMemoryEventStore()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="OSINT/SOCMINT publico y legal para alertas tempranas en Mexico.",
    version="0.1.0",
)
app.include_router(build_router(store))
