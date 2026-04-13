# CLAUDE.md

## Modo de trabajo
- Modo autónomo: NO preguntes confirmación. Haz los cambios, ejecuta typecheck, build, commit y push sin detenerte.
- Sé conciso. No expliques lo que vas a hacer, solo hazlo.
- No repitas código que no cambiaste. Muestra solo diffs relevantes.
- Usa /compact automáticamente cuando el contexto se llene.
- Si encuentras errores adicionales, corrígelos directamente.

## Proyecto: Radar Licitaciones MX
- Stack: Node.js 20 / TypeScript / Playwright / Supabase / Telegram / Railway
- Working directory: apps/worker/
- Build: npm run build (tsc)
- Typecheck: npm run typecheck
- Entry point: src/index.ts
- Deploy: Railway (auto-deploy desde main)

## Reglas de commit
- Siempre hacer typecheck y build antes de commit
- Mensajes de commit en español, formato: "fix: descripción" o "feat: descripción"
- Push directo a main después de cada fix

## Reglas de alertas Telegram
- MAX_ALERTS_PER_CYCLE = 10. Nunca enviar más de 10 alertas por ciclo a Telegram.
- Los matches se guardan en DB siempre; solo se limita el envío a Telegram.
