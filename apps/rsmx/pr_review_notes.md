# PR Review Notes — Radar-Social-MX

## Rama

feature/rsmx-isolated-module

## Commit

6cffc2a29ff96473f3b3c469917d1c7c596931d7

## Propósito

Agregar RSmx como módulo aislado dentro del repo Radar-Licitaciones-MX.

## Rutas agregadas

* apps/rsmx/
* docs/rsmx/
* infra/supabase/rsmx/

## Confirmación de aislamiento

No se tocaron archivos del radar de licitaciones. No se modificaron `apps/worker/`, `apps/api/`, configuraciones raíz, Railway raíz, Procfile raíz, README raíz, Supabase existente ni infraestructura de licitaciones.

## Validaciones

* pytest: 6 passed
* ruff: All checks passed
* git status: limpio

## Resumen técnico del PR

El PR agrega Radar-Social-MX, abreviado RSmx, como un módulo Python/FastAPI autocontenido para monitoreo OSINT/SOCMINT público y legal. Incluye API, comandos Telegram, procesamiento básico, scoring, deduplicación, SQL con tablas prefijadas `rsmx_`, documentación, pruebas y configuración Railway aislada dentro de `apps/rsmx/`.

El módulo no comparte dependencias, imports, variables de entorno, scheduler, worker, Supabase, Telegram ni configuración con Radar-Licitaciones-MX.

## Riesgos pendientes

* Falta prueba real con Supabase.
* Falta prueba real con Telegram.
* Falta prueba real del worker con fuentes reales.
* Falta validar Railway en servicio separado.
* Falta verificar que no genere falsos positivos.

## Pasos para Fase 1.5

* Crear entorno Railway separado para RSmx.
* Configurar únicamente variables con prefijo `RSMX_`.
* Ejecutar SQL de `apps/rsmx/sql/` en una base controlada para RSmx.
* Probar `/health`, `/events/recent`, `/events/top` y `/sources`.
* Probar webhook Telegram con bot/chat de pruebas.
* Ejecutar worker con fuentes públicas reales y volumen bajo.
* Auditar falsos positivos, deduplicación, score y redacción de datos sensibles.
* Confirmar que no hay interacción con Radar-Licitaciones-MX.

## Recomendación

No hacer merge a main hasta completar Fase 1.5 de auditoría real.
