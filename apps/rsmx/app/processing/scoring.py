from datetime import UTC, datetime

from app.models.schemas import EventCategory, EventScore, NormalizedItem
from app.processing.classifier import Classification
from app.processing.text import fold_text

HIGH_INTENT_TERMS = {
    "alerta",
    "autopista cerrada",
    "bloqueo",
    "caseta cerrada",
    "cierre",
    "evacuan",
    "manifestacion",
    "protesta",
    "reporte oficial",
}

HIGH_SEVERITY_TERMS = {
    "balacera",
    "desaparicion",
    "feminicidio",
    "homicidio",
    "incendio",
    "inundacion",
    "secuestro",
}

LOW_SIGNAL_TERMS = {
    "celebracion",
    "cultura",
    "deportivo",
    "entrega simbolica",
    "felicitacion",
    "inauguracion sin afectacion",
    "reconocimiento",
}

OFFICIAL_SOURCE_TERMS = {
    "capufe",
    "fiscalia",
    "gobierno",
    "proteccion civil",
    "sict",
    "seguridad publica",
}


def score_event(item: NormalizedItem, classification: Classification, min_alert_score: int = 75) -> EventScore:
    now = datetime.now(UTC)
    age_seconds = max(0, (now - item.published_at).total_seconds())
    recency_score = 25 if age_seconds <= 3600 else 18 if age_seconds <= 7200 else 10 if age_seconds <= 86400 else 3

    text = fold_text(f"{item.title} {item.text}")
    intent_hits = sum(1 for term in HIGH_INTENT_TERMS if term in text)
    severity_hits = sum(1 for term in HIGH_SEVERITY_TERMS if term in text)
    source_hits = sum(1 for term in OFFICIAL_SOURCE_TERMS if term in fold_text(item.source_name))
    penalty_hits = sum(1 for term in LOW_SIGNAL_TERMS if term in text)

    category_base = {
        EventCategory.MOVILIDAD: 18,
        EventCategory.SEGURIDAD: 20,
        EventCategory.RIESGO_CIVIL: 18,
        EventCategory.ALERTA_OFICIAL: 18,
        EventCategory.POLITICA: 12,
        EventCategory.SERVICIOS_PUBLICOS: 12,
        EventCategory.GENERAL: 4,
    }[classification.category]

    intent_score = min(25, category_base + (5 * intent_hits))
    severity_score = min(20, 8 + (6 * severity_hits))
    source_score = 12 if source_hits else 7
    confidence_score = round(classification.confidence * 15)
    penalties = min(20, penalty_hits * 8)

    raw_score = recency_score + intent_score + severity_score + source_score + confidence_score - penalties
    final_score = max(0, min(100, raw_score))
    reasons = [
        f"category={classification.category.value}",
        f"intent_hits={intent_hits}",
        f"severity_hits={severity_hits}",
        f"source_quality={'official' if source_hits else 'public'}",
    ]
    if penalties:
        reasons.append(f"low_signal_penalty={penalties}")

    return EventScore(
        final_score=final_score,
        min_alert_score=min_alert_score,
        recency_score=recency_score,
        intent_score=intent_score,
        severity_score=severity_score,
        source_score=source_score,
        confidence_score=confidence_score,
        penalties=penalties,
        reasons=reasons,
    )
