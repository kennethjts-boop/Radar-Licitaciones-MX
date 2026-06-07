from datetime import UTC, datetime

from app.models.schemas import EventCategory, RawItem
from app.processing.classifier import classify_text
from app.processing.deduplicator import build_event_hash
from app.processing.normalizer import normalize_raw_item
from app.processing.scoring import score_event


def test_classifies_tlalpan_toll_closure_as_mobility() -> None:
    result = classify_text("caseta Tlalpan cerrada por bloqueo")
    assert result.category == EventCategory.MOVILIDAD


def test_classifies_possible_feminicide_as_security() -> None:
    result = classify_text("posible feminicidio en Morelos")
    assert result.category == EventCategory.SEGURIDAD


def test_classifies_fire_as_civil_risk() -> None:
    result = classify_text("incendio en Cuernavaca")
    assert result.category == EventCategory.RIESGO_CIVIL


def test_recent_closed_highway_scores_high() -> None:
    raw = RawItem(
        source_id="capufe",
        source_name="CAPUFE oficial",
        title="Autopista Mexico-Cuernavaca cerrada por bloqueo en caseta",
        text="Reporte oficial de cierre a la circulacion por manifestacion.",
        published_at=datetime.now(UTC),
    )
    item = normalize_raw_item(raw)
    classification = classify_text(item.title, item.text)
    score = score_event(item, classification)
    assert score.final_score >= 75


def test_deduplication_hash_is_stable() -> None:
    first = build_event_hash("Caseta Tlalpan cerrada por bloqueo", "morelos", "movilidad")
    second = build_event_hash("caseta tlalpan cerrada por bloqueo", "Morelos", "movilidad")
    assert first == second
