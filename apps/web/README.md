# Panel web — PROTOTIPO NO DESPLEGADO

> **Estado: prototipo.** Este panel **no forma parte del producto desplegado
> actualmente**. No hay configuración de despliegue para él (`railway.toml` sólo
> construye `apps/worker`), por lo que no debe publicarse tal cual.

## Advertencias de seguridad conocidas

Antes de exponerlo hay que corregir, como mínimo:

1. **El login es del lado del cliente y no es control de acceso.**
   `src/App.tsx` asigna `role: "admin"` y `tokens: 999999` si el correo
   coincide con `admin@radar.com`; la contraseña no se valida y el resultado se
   guarda en `localStorage`. Cualquiera puede suplantar esa sesión desde el
   navegador. Debe reemplazarse por Supabase Auth (`signInWithPassword`) y el
   rol/los permisos deben resolverse en el servidor.
2. **Las credenciales de demostración se imprimen en la pantalla de login.**
   Deben desaparecer.
3. **El panel lee `procurements` con la clave `anon`.** Tras la migración
   `20260707_lock_public_rls.sql` los privilegios de `anon`/`authenticated`
   fueron revocados, así que estas lecturas ya no funcionan con el esquema
   bloqueado: el panel está hoy roto contra la base de datos real, no sólo
   inseguro.
4. **El contrato con la Edge Function es incorrecto.** El panel envía
   `procurementId`, pero `analyze-procurement` espera `procurement_id`.
5. **`analyze-procurement` exige autenticación** (secreto compartido o sesión
   de Supabase Auth). El panel debe enviar la credencial correspondiente.

## Reglas de esta estabilización (2026-10-19)

No se corrigió el panel: está fuera del alcance operativo actual. No se
publicó, no se añadieron endpoints y no se tocaron sus contratos más allá de
documentar los problemas verificables. Ver
`docs/production-fixes/20261019_estabilizacion_integral.md`.
