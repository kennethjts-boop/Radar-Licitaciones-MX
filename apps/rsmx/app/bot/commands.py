from dataclasses import dataclass


@dataclass(frozen=True)
class CommandResponse:
    text: str
    alert_setting: bool | None = None


def route_command(text: str) -> CommandResponse:
    normalized = " ".join((text or "").strip().lower().split())

    if normalized == "/estado":
        return CommandResponse("RSmx activo. Monitoreo publico y legal en ejecucion.")
    if normalized == "/top5 ahora":
        return CommandResponse("Top 5 actual: sin datos locales en memoria para esta instancia.")
    if normalized == "/hoy morelos":
        return CommandResponse("Eventos de hoy en Morelos: consulta el endpoint /events/recent.")
    if normalized == "/ultimos 30min":
        return CommandResponse("Ultimos 30 min: consulta el endpoint /events/recent.")
    if normalized == "/ultimos 2h":
        return CommandResponse("Ultimas 2h: consulta el endpoint /events/recent.")
    if normalized.startswith("/buscar "):
        query = normalized.removeprefix("/buscar ").strip()
        return CommandResponse(f"Busqueda registrada: {query}")
    if normalized == "/seguridad morelos":
        return CommandResponse("Filtro seguridad Morelos activado para la consulta.")
    if normalized == "/carreteras morelos":
        return CommandResponse("Filtro carreteras Morelos activado para la consulta.")
    if normalized == "/alertas on":
        return CommandResponse("Alertas RSmx activadas para este chat.", alert_setting=True)
    if normalized == "/alertas off":
        return CommandResponse("Alertas RSmx desactivadas para este chat.", alert_setting=False)

    return CommandResponse("Comando RSmx no reconocido.")
