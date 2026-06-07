# Radar-Social-MX (RSmx)

RSmx es un proyecto aislado dentro de este repositorio para alertas tempranas OSINT/SOCMINT con fuentes publicas y uso legal.

No comparte dependencias, configuracion, variables, Railway, Supabase ni codigo con Radar-Licitaciones-MX.

## Alcance

Detecta eventos publicos relevantes en Morelos y Mexico:

- bloqueos carreteros y casetas cerradas
- accidentes graves
- incendios e inundaciones
- protestas y manifestaciones
- balaceras, homicidios, posibles feminicidios, posibles secuestros y desapariciones
- alertas oficiales
- riesgos de movilidad, seguridad publica, politica y servicios publicos

## Reglas legales y eticas

- Solo informacion publica.
- Sin perfiles privados ni grupos cerrados.
- Sin evadir captchas, bloqueos o controles de acceso.
- Sin proxies para evasion.
- Sin scraping agresivo.
- Sin doxxing ni datos sensibles.
- Sin domicilios particulares, telefonos personales o placas privadas.
- Sin identificar victimas menores de edad.
- Rumores y reportes no confirmados se tratan con nivel de confianza, no como hechos.
- Todo evento conserva fuentes rastreables.

## Ejecutar API

```bash
cd apps/rsmx
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

## Ejecutar worker

```bash
cd apps/rsmx
source .venv/bin/activate
python scripts/run_worker.py
```

## Endpoints

- `GET /health`
- `POST /telegram/webhook`
- `GET /events/recent`
- `GET /events/top`
- `GET /sources`

## Comandos Telegram

- `/estado`
- `/top5 ahora`
- `/hoy morelos`
- `/ultimos 30min`
- `/ultimos 2h`
- `/buscar <consulta>`
- `/seguridad morelos`
- `/carreteras morelos`
- `/alertas on`
- `/alertas off`

## Variables

Todas las variables son exclusivas de RSmx y usan prefijo `RSMX_`. Ver `.env.example`.
