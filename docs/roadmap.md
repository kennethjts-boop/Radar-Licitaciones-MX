# Roadmap — Radar Licitaciones MX

## Fases de Desarrollo

---

## ✅ FASE 0 — Base Técnica (actual)
**Estado: COMPLETADA**

- [x] Estructura de carpetas completa
- [x] Tipos TypeScript — contratos de datos
- [x] Config con Zod validada
- [x] Core: logger, fingerprints, text, time, errors, healthcheck, lock
- [x] Storage: cliente Supabase + repos
- [x] 8 radares configurados con expansión semántica
- [x] Matcher con scoring y explicabilidad
- [x] Normalizer con canon text y fingerprint
- [x] Enricher básico
- [x] Alerts: formato HTML Telegram
- [x] Commands: /prueba, /buscar, /debug_resumen
- [x] Jobs: collect.job, scheduler, daily-summary
- [x] Esquema SQL Supabase (14 tablas)
- [x] Dockerfile + railway.toml
- [x] GitHub Actions CI
- [x] Documentación completa

---

## FASE 1 — Infraestructura Viva
**Objetivo: sistema corriendo con /prueba funcional**

- [ ] Crear repo en GitHub
- [ ] Configurar proyecto en Supabase (producción)
- [ ] Ejecutar `supabase-schema.sql`
- [ ] Crear bot Telegram con @BotFather
- [ ] Configurar variables en Railway
- [ ] Deploy inicial en Railway
- [ ] Verificar /prueba responde correctamente
- [ ] Verificar DB conecta (healthcheck en logs)

**Duración estimada: 1-2 días**

---

## FASE 2 — Collector Real Compras MX
**Objetivo: scraping real con Playwright**

- [ ] Investigar estructura del portal Compras MX
- [ ] Implementar navegación de listado (paginación)
- [ ] Implementar extracción de detalle por expediente
- [ ] Implementar extracción de adjuntos y sus URLs
- [ ] Detectar número de licitación (campo, título, o PDF)
- [ ] Manejo de errores de red y timeouts
- [ ] Rate limiting respetuoso (2-5s entre páginas)
- [ ] Prueba de una corrida completa
- [ ] Verificar primera alerta de Telegram llega

**Duración estimada: 3-5 días**
**Riesgo: ALTO** — el portal puede cambiar o tener anti-bot

---

## FASE 3 — Fuentes Complementarias
**Objetivo: cobertura multi-fuente**

- [ ] Collector DOF (RSS + parsing)
- [ ] Collector sitios institucionales (CAPUFE.gob.mx, etc.)
- [ ] Fallback search para dependencias sin ComprasMX completo
- [ ] Consolidación: deduplicar entre fuentes por expediente_id

**Duración estimada: 1 semana**

---

## FASE 4 — Matcher Robusto + Entity Helpers
**Objetivo: matching preciso con semántica aumentada**

- [ ] Entity helpers: expansión de aliases institucionales
- [ ] Stemming español básico
- [ ] Reglas geográficas avanzadas
- [ ] Reglas institucionales (buyer_unit matching)
- [ ] Scores calibrados por radar con datos reales
- [ ] Configurar radar habitat_morelos con precisión

**Duración estimada: 1 semana**

---

## FASE 5 — Radares Especializados Activos
**Objetivo: todos los radares producen matches reales**

- [ ] Verificar cada radar contra datos reales
- [ ] Ajustar minScore por radar según falsos positivos
- [ ] Añadir radares según nuevas oportunidades detectadas
- [ ] Radar de monitoreo de competidores (opcional)

**Duración estimada: 3-5 días**

---

## FASE 6 — Alertas Enriquecidas + Antecedentes
**Objetivo: alertas con contexto histórico completo**

- [ ] Enricher: resumen ejecutivo del expediente
- [ ] Enricher: antecedentes (versiones previas)
- [ ] Enricher: términos relacionados detectados
- [ ] Enricher: contexto de dependencia (entity_memory)
- [ ] Alertas de nuevo documento adjunto
- [ ] Alertas de cambio de monto

**Duración estimada: 3-5 días**

---

## FASE 7 — Comandos Operativos Completos
**Objetivo: `/buscar` y `/debug_resumen` totalmente funcionales**

- [ ] `/buscar` con fuentes y radar filter
- [ ] `/debug_resumen` con estado por collector
- [ ] `/radar <key>` para ver estado de radar específico
- [ ] `/ultimas` para ver últimas 5 alertas

**Duración estimada: 2-3 días**

---

## FASE 8 — Hardening 24/7
**Objetivo: sistema estable sin intervención manual**

- [ ] Watchdog: reinicia collector si lleva >2h sin corrida
- [ ] Anti-duplicados fino: no alertar si alerta ≤24h para mismo expediente
- [ ] Resumen diario completo con incidencias
- [ ] Monitoreo de errores repetidos por colector
- [ ] Alertas de sistema caído a Telegram
- [ ] Logs estructurados para observabilidad

**Duración estimada: 1 semana**
