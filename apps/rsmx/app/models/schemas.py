from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class EventCategory(StrEnum):
    MOVILIDAD = "movilidad"
    SEGURIDAD = "seguridad"
    RIESGO_CIVIL = "riesgo_civil"
    POLITICA = "politica"
    SERVICIOS_PUBLICOS = "servicios_publicos"
    ALERTA_OFICIAL = "alerta_oficial"
    GENERAL = "general"


class RawItem(BaseModel):
    source_id: str
    source_name: str
    title: str
    url: str | None = None
    text: str = ""
    published_at: datetime | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class NormalizedItem(BaseModel):
    source_id: str
    source_name: str
    title: str
    url: str | None = None
    text: str
    region: str = "morelos"
    published_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    canonical_hash: str
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class EventScore(BaseModel):
    final_score: int
    min_alert_score: int = 75
    recency_score: int
    intent_score: int
    severity_score: int
    source_score: int
    confidence_score: int
    penalties: int = 0
    reasons: list[str] = Field(default_factory=list)


class SocialEvent(BaseModel):
    title: str
    description: str
    category: EventCategory
    region: str = "morelos"
    confidence: float = Field(ge=0, le=1)
    score: EventScore
    sources: list[str] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)
    canonical_hash: str
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    tags: list[str] = Field(default_factory=list)


class AlertPayload(BaseModel):
    event: SocialEvent
    chat_id: str | None = None
    sent: bool = False


class Source(BaseModel):
    id: str
    name: str
    kind: str
    url: HttpUrl | None = None
    enabled: bool = True
