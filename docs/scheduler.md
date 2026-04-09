# Scheduler — Estrategia de Ejecución

## Ciclos de Ejecución

### Ciclo de Colección — cada 30 minutos
```
Cron: */30 * * * *
Timezone: America/Mexico_City
Lock timeout: 25 minutos
```

**Flujo:**
1. Intento de adquirir lock `collect-job`
2. Si lock ocupado → skip (cycle overlap prevention)
3. Si lock libre → ejecutar `runCollectJob()`
4. Al terminar → liberar lock + registrar en `collect_runs`

### Resumen Diario — una vez al día
```
Cron: 0 7 * * *
Timezone: America/Mexico_City
```

**Flujo:**
1. Agregar métricas de las últimas 24h desde Supabase
2. Construir `DailySummary`
3. Guardar en `daily_summaries`
4. Enviar mensaje a Telegram

---

## Manejo de Errores del Scheduler

| Escenario | Comportamiento |
|-----------|---------------|
| Collector timeout (25min) | `TimeoutError` → status='timeout' en `collect_runs` |
| Error de red en Playwright | Re-intento con backoff (3 intentos) |
| Error de Supabase | Log error, continuar con siguiente item |
| Error de Telegram | Log error, marcar alerta como 'failed' |
| Lock activo (ciclo solapado) | Skip silencioso, log 'warn' |
| Error no manejado (crash) | Railway reinicia el proceso automáticamente |

---

## Corrida Manual de Emergencia

Para forzar una corrida sin esperar el cron:
```bash
# En Railway → Run Command
node -e "require('./dist/jobs/collect.job').runCollectJob()"
```

O temporalmente cambiar la variable:
```env
COLLECT_INTERVAL_MINUTES=1
```

---

## Tiempos Típicos Esperados (Fase 2+)

| Operación | Tiempo estimado |
|-----------|----------------|
| Carga de página listado ComprasMX | 3-8 segundos |
| Extracción de detalle por expediente | 2-5 segundos |
| Ciclo de 10 páginas (~100 items) | 5-15 minutos |
| Ciclo completo incluyendo matching | 10-20 minutos |
| Margen antes del próximo ciclo | 10-20 minutos |

---

## Watchdog (Fase 8)

En Fase 8 se implementará un watchdog que:
- Detecta si no hay corrida exitosa en las últimas 2 horas
- Envía alerta a Telegram: "⚠️ Sin corridas recientes"
- Reinicia el collector si es posible
