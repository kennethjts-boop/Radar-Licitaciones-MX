from dataclasses import dataclass

from app.models.schemas import EventCategory
from app.processing.text import fold_text

MOVILIDAD_TERMS = {
    "accidente",
    "autopista",
    "bloqueo",
    "carretera",
    "caseta",
    "cerrada",
    "cerrado",
    "cierre",
    "cierres",
    "circulacion",
    "trafico",
    "vialidad",
}

SEGURIDAD_TERMS = {
    "balacera",
    "desaparicion",
    "desaparecida",
    "desaparecido",
    "feminicidio",
    "homicidio",
    "secuestro",
    "seguridad publica",
    "violencia",
}

RIESGO_CIVIL_TERMS = {
    "derrumbe",
    "emergencia",
    "explosion",
    "incendio",
    "inundacion",
    "lluvia intensa",
    "proteccion civil",
}

POLITICA_TERMS = {
    "cabildo",
    "congreso",
    "crisis politica",
    "gobernador",
    "manifestacion",
    "planton",
    "protesta",
}

SERVICIOS_TERMS = {
    "agua potable",
    "apagones",
    "corte de agua",
    "drenaje",
    "luz",
    "recoleccion de basura",
    "servicio publico",
}

OFICIAL_TERMS = {
    "alerta oficial",
    "boletin oficial",
    "comunicado oficial",
    "proteccion civil informa",
}


@dataclass(frozen=True)
class Classification:
    category: EventCategory
    confidence: float
    tags: list[str]


def classify_text(title: str, text: str = "") -> Classification:
    folded = fold_text(f"{title} {text}")
    candidates: list[tuple[EventCategory, set[str]]] = [
        (EventCategory.ALERTA_OFICIAL, OFICIAL_TERMS),
        (EventCategory.SEGURIDAD, SEGURIDAD_TERMS),
        (EventCategory.MOVILIDAD, MOVILIDAD_TERMS),
        (EventCategory.RIESGO_CIVIL, RIESGO_CIVIL_TERMS),
        (EventCategory.POLITICA, POLITICA_TERMS),
        (EventCategory.SERVICIOS_PUBLICOS, SERVICIOS_TERMS),
    ]

    matches: list[tuple[EventCategory, list[str]]] = []
    for category, terms in candidates:
        found = sorted(term for term in terms if term in folded)
        if found:
            matches.append((category, found))

    if not matches:
        return Classification(EventCategory.GENERAL, 0.35, [])

    category, tags = max(matches, key=lambda item: len(item[1]))
    confidence = min(0.95, 0.55 + (0.1 * len(tags)))
    return Classification(category, confidence, tags)
