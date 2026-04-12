# Fase 3 — Plan de Arquitectura de IA (Inteligencia Documental)

## 0) Contexto Técnico Actual (base para decisiones)

- El pipeline principal (`runCollectJob`) ya hace: colecta, upsert de expediente, descarga/subida de adjuntos y matching/alerta en una sola corrida síncrona.  
- Actualmente los adjuntos se guardan en `attachments` con metadatos de archivo (nombre, hash, size, ruta en storage), pero sin un estado formal de análisis LLM.  
- El scheduler hoy ya está orientado a jobs desacoplados por cron (`collect`, `recheck`, `daily summary`), lo cual facilita agregar un job nuevo de análisis documental sin romper el core.

---

## 1) PDF Parsing en Railway (worker con RAM limitada)

### Recomendación principal

**Usar `pdfjs-dist` como parser base (por página y con límites de extracción), en vez de `pdf-parse` como primera opción.**

### Razón arquitectónica

- `pdf-parse` es muy cómodo, pero normalmente abstrae todo el documento y tiende a trabajar “all-at-once”, lo que complica controlar memoria en PDFs grandes.
- `pdfjs-dist` permite estrategia **page-by-page** y controles finos (máximo de páginas, timeout, truncado de texto), que es justo lo que se necesita en Railway con recursos acotados.
- Para la Fase 3 el objetivo no es OCR perfecto, sino **texto suficiente para scoring OSINT**. Ese objetivo favorece un parser controlable y predecible en consumo.

### Política propuesta de uso (guardrails)

1. **Límite duro por tamaño de archivo** (ej. 20–25 MB para parsing automático).
2. **Límite duro por páginas** (ej. primeras 40 páginas para scoring inicial).
3. **Límite duro por caracteres extraídos** (ej. 120k chars, luego truncar).
4. **Timeout de parsing** (ej. 20–30 s por documento).
5. Si falla parsing: marcar estado `parse_failed`, registrar error y continuar con la cola (no bloquear job).

### Fallback recomendado

- Si en validación real encuentras PDFs escaneados sin texto (caso frecuente), considerar una **segunda etapa opcional OCR** desacoplada y más cara (no en el camino crítico inicial).

---

## 2) Punto de Inyección del Pipeline de Análisis

## Decisión recomendada

**Crear un job separado asíncrono (`analyze.job.ts`) que lea `attachments` pendientes.**

### Por qué NO hacerlo inline inmediatamente tras `uploadAttachment` en `runCollectJob`

- `runCollectJob` ya concentra scraping + matching + alertas. Meter parsing+LLM inline incrementa latencia total y riesgo de timeouts del ciclo.
- Si una llamada LLM falla o se degrada, afectaría la ingestión completa (acoplamiento fuerte).
- En picos de adjuntos, el collect job quedaría “secuestrado” por CPU/I/O de parsing en vez de seguir descubriendo nuevas oportunidades.

### Patrón propuesto (escalable)

**Patrón Outbox / Queue por DB**:

1. `collect.job.ts` solo inserta adjunto en `attachments`.
2. En inserción se marca estado inicial de análisis (`analysis_status='pending'`) o se crea fila en `document_analysis`.
3. `analyze.job.ts` corre cada N minutos y toma lotes (`FOR UPDATE SKIP LOCKED` o estrategia equivalente con estado `processing`).
4. Procesa: descargar archivo -> parse -> prompt LLM -> persistir resultado estructurado.
5. Publica resumen al canal de Telegram (o marca para `daily-summary.job.ts`).

### Concurrencia recomendada

- **Batch pequeño + concurrencia controlada** (ej. 3–5 docs por corrida).
- Retry con backoff para fallas transitorias de red/LLM.
- Idempotencia por `attachment_id` + versión de prompt/modelo.

### Integración con scheduler actual

Agregar cuarto job en `scheduler.ts`:

- `analyzeCron`: cada 5–10 min (o continuo con “loop corto + sleep” si prefieres worker dedicado).
- Mantener separación clara de responsabilidades:
  - `collect/recheck`: adquisición de datos.
  - `analyze`: inteligencia documental.
  - `daily-summary`: resumen operativo.

---

## 3) Esquema de Base de Datos propuesto

## Opción recomendada: tabla nueva `document_analysis`

Mantener `attachments` como tabla de almacenamiento/archivo y separar resultados de IA en una entidad propia. Esto evita sobrecargar `attachments` y permite historial por reanálisis.

### SQL propuesto (PostgreSQL / Supabase)

```sql
-- Extensión opcional para vector o búsquedas avanzadas en el futuro
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,

  -- Control de pipeline
  analysis_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,

  -- Metadata técnica del parsing y LLM
  parser_name TEXT,                 -- e.g. 'pdfjs-dist'
  parser_version TEXT,
  parsed_pages INTEGER,
  parsed_chars INTEGER,
  model_provider TEXT,              -- e.g. 'openai'
  model_name TEXT,                  -- e.g. 'gpt-5-mini'
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  input_tokens INTEGER,
  output_tokens INTEGER,
  llm_latency_ms INTEGER,

  -- Resultado de inteligencia
  opportunity_score NUMERIC(5,2),   -- 0.00 - 100.00
  risk_score NUMERIC(5,2),          -- 0.00 - 100.00
  confidence_score NUMERIC(5,2),    -- 0.00 - 100.00
  executive_summary TEXT,
  opportunities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_response_json JSONB,          -- respuesta completa del modelo

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un análisis vigente por adjunto y versión de prompt/modelo.
  CONSTRAINT uq_doc_analysis_attachment_prompt_model
    UNIQUE (attachment_id, prompt_version, model_name)
);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_status
  ON document_analysis (analysis_status, queued_at);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_procurement
  ON document_analysis (procurement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_opportunity_score
  ON document_analysis (opportunity_score DESC);
```

### ¿Por qué tabla separada y no solo columnas en `attachments`?

- Permite **reanálisis** cuando cambie prompt/modelo sin sobrescribir histórico.
- Facilita auditoría (qué modelo decidió qué, cuándo y con cuánta confianza).
- Evita crecimiento desordenado de `attachments` con JSONs pesados.

### Ajuste adicional recomendado

Si necesitas visibilidad rápida desde `attachments`, agrega solo columnas ligeras de estado:

- `analysis_status` (mirror opcional)
- `last_analysis_at`

Pero el payload semántico debe quedar en `document_analysis`.

---

## 4) Prompting Strategy (System Prompt Borrador)

> Objetivo: Forzar salida **estrictamente JSON**, centrada en oportunidades y riesgos de licitaciones gubernamentales en México.

```text
Eres un analista senior de inteligencia documental para licitaciones públicas en México.
Tu tarea es evaluar documentos de contratación pública y producir un análisis estructurado y accionable para una empresa proveedora.

REGLAS CRÍTICAS:
1) Responde EXCLUSIVAMENTE en JSON válido UTF-8, sin markdown ni texto adicional.
2) Si falta evidencia en el documento, usa "evidence": [] y reduce "confidence_score".
3) No inventes datos. Si algo no aparece, marca "unknown".
4) Prioriza hallazgos sobre: requisitos técnicos, umbrales económicos, experiencia mínima, garantías, fechas críticas, causales de descalificación, penas y riesgos legales.
5) Evalúa oportunidad y riesgo en escala 0-100.
6) Incluye trazabilidad: cada hallazgo debe citar fragmentos textuales cortos del documento en "evidence".

FORMATO JSON OBLIGATORIO:
{
  "document_type": "bases|convocatoria|anexo_tecnico|contrato|fallo|acta_junta|otro",
  "opportunity_score": 0,
  "risk_score": 0,
  "confidence_score": 0,
  "executive_summary": "string breve (max 1200 chars)",
  "opportunities": [
    {
      "title": "string",
      "impact": "high|medium|low",
      "why_it_matters": "string",
      "evidence": ["string", "..."]
    }
  ],
  "risks": [
    {
      "title": "string",
      "severity": "high|medium|low",
      "category": "tecnico|legal|financiero|operativo|competencia|tiempos",
      "mitigation": "string",
      "evidence": ["string", "..."]
    }
  ],
  "keywords_found": ["string", "..."],
  "critical_dates": [
    {
      "label": "string",
      "date_text": "string",
      "iso_date": "YYYY-MM-DD|unknown"
    }
  ],
  "estimated_contract_value": {
    "amount": "number|unknown",
    "currency": "MXN|USD|unknown",
    "evidence": ["string", "..."]
  },
  "recommended_actions": ["string", "..."],
  "red_flags": ["string", "..."]
}

CRITERIOS DE SCORING:
- opportunity_score alto cuando hay encaje claro de capacidades, monto atractivo y barreras razonables.
- risk_score alto cuando hay requisitos restrictivos, plazos inviables, penalizaciones altas o incertidumbre legal/técnica.
- confidence_score depende de completitud y claridad del texto disponible.
```

### Recomendaciones de prompting operativo

- Enviar también contexto del expediente (título, dependencia, estado, monto detectado) como `user prompt` estructurado.
- Usar `response_format` tipo JSON schema (si el proveedor LLM lo soporta) para endurecer validez.
- Versionar prompt (`prompt_version`) y guardar respuesta cruda para auditoría.

---

## 5) Flujo End-to-End objetivo (Fase 3)

1. `collect.job.ts` detecta y guarda adjuntos.
2. Se encola análisis (`document_analysis` en `pending`).
3. `analyze.job.ts` consume pendientes en lotes.
4. Parser PDF (`pdfjs-dist`) extrae texto con guardrails.
5. LLM analiza y devuelve JSON estructurado.
6. Persistencia de scoring + hallazgos + riesgos.
7. Publicación a Telegram:
   - inmediata por documento crítico, o
   - consolidada por corrida.

---

## 6) KPIs de esta arquitectura (para validar en producción)

- **Tiempo medio de análisis por documento**.
- **Tasa de fallos de parsing**.
- **Tasa de JSON inválido LLM**.
- **Costo tokens por documento**.
- **Precisión percibida** (validación humana de oportunidades/riesgos).
- **Backlog size** (`pending` vs throughput del job).

---

## 7) Decisiones finales sugeridas

1. Parser base: **`pdfjs-dist`** con límites estrictos.
2. Inyección: **job asíncrono separado `analyze.job.ts`** (no inline en `runCollectJob`).
3. Persistencia: **tabla `document_analysis`** + índices de cola/consulta.
4. Prompt: salida JSON estricta, trazable, con scoring oportunidad/riesgo y evidencia.
5. Rollout: iniciar con “MVP robusto” (sin OCR avanzado), medir, luego iterar.
