import html

from app.models.schemas import SocialEvent


def format_event_alert(event: SocialEvent) -> str:
    title = html.escape(event.title.strip())
    category = html.escape(event.category.value)
    region = html.escape(event.region)
    score = event.score.final_score
    confidence = round(event.confidence * 100)
    sources = ", ".join(html.escape(source) for source in event.sources[:3]) or "fuente publica"
    url_line = f"\nFuente: {html.escape(event.urls[0])}" if event.urls else ""

    return (
        f"<b>RSmx alerta</b>\n"
        f"{title}\n"
        f"Categoria: {category}\n"
        f"Region: {region}\n"
        f"Score: {score}/100 | Confianza: {confidence}%\n"
        f"Fuentes: {sources}"
        f"{url_line}"
    )
