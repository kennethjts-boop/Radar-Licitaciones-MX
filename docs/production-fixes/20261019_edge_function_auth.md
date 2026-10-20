# 2026-10-19 — Autenticación y control de gasto en la Edge Function `analyze-procurement`

Rama: `security/analyze-procurement-auth` (base: `origin/main` @ `3be523a`).

## Problema

`supabase/functions/analyze-procurement/index.ts` era un endpoint público:

- **no verificaba ninguna identidad** (ni JWT de Supabase, ni secreto) y
  respondía con `Access-Control-Allow-Origin: *`;
- llamaba al modelo **antes** de comprobar que el expediente existiera, por lo
  que un `procurement_id` inventado **gastaba una llamada de OpenRouter**
  sin límite (la FK de PostgreSQL sólo fallaba después de la llamada);
- devolvía el texto crudo del error del proveedor y de PostgreSQL al llamador;
- no tenía límite de peticiones;
- interpolaba **crudos** los campos controlados por el llamador en el prompt,
  junto con el análisis documental almacenado (superficie de inyección de
  prompt con capacidad de exfiltrar ese contenido).

## Corrección

- **Autenticación y autorización obligatorias** (revisión de cierre): secreto
  compartido `ANALYZE_PROCUREMENT_SECRET` en `x-analyze-secret` (comparación
  en tiempo constante) **o** sesión de Supabase Auth **no anónima** cuyo
  `user.id` figure en `ANALYZE_PROCUREMENT_ALLOWED_USER_IDS`. Una sesión de
  Supabase Auth por sí sola **no** autoriza: no existe relación usuario ↔
  expediente, así que cualquier cuenta registrada tendría acceso a todos los
  expedientes y al gasto de IA. Sin secreto ni lista blanca la función
  responde **503** y **no** llama al modelo.
- **Validación previa**: `procurement_id` debe ser un UUID y el expediente
  debe existir; la comprobación ocurre **antes** de cualquier llamada al
  modelo.
- **Control de gasto**: reutiliza un análisis reciente del mismo expediente
  (caché de 30 min). **Presupuesto global por hora** contado en
  `saas_analyses` (todas las instancias; `ANALYZE_MAX_PER_HOUR`, por defecto
  20); si no puede verificarse, se rechaza sin llamar al proveedor
  (fail-closed). Límite en memoria de 10 peticiones/min **por identidad
  autenticada** (ya no por `x-forwarded-for`, que controla el cliente).
  **Ese límite en memoria NO es global**: es por isolate y se pierde al
  reciclarse; sólo amortigua ráfagas.
- **CORS por lista blanca** (`ALLOWED_ORIGINS`); sin origen configurado no se
  devuelve ninguna cabecera CORS.
- **Higiene de errores**: el detalle del proveedor y de la base de datos se
  registra en el servidor y no se devuelve al llamador.
- **Contención de prompt**: los datos del llamador y el contexto documental
  van delimitados (`<datos_de_la_licitacion>`, `<contexto_documental>`) y el
  prompt indica que son datos, nunca instrucciones.
- Se eliminó una consulta a `document_analysis` que no aportaba nada al prompt.

## Despliegue (NO ejecutado)

```bash
# 1. Al menos uno de los dos (sin ninguno la función queda cerrada: 503)
supabase secrets set ANALYZE_PROCUREMENT_SECRET='<secreto largo y aleatorio>'
supabase secrets set ANALYZE_PROCUREMENT_ALLOWED_USER_IDS='<uuid1>,<uuid2>'   # opcional
supabase secrets set ANALYZE_MAX_PER_HOUR='20'                               # opcional

# 2. Sólo si se llama desde un navegador
supabase secrets set ALLOWED_ORIGINS='https://<origen-real>'

# 3. Desplegar la función
supabase functions deploy analyze-procurement
```

**Orden importante.** La función que está desplegada hoy **no pide
autenticación**: mientras esta versión no se publique, cualquiera con la URL
puede gastar créditos de OpenRouter. Si la función no se va a usar, la opción
más segura es **deshabilitarla o eliminarla** en lugar de dejarla expuesta.

## Compatibilidad

El único cliente en el repositorio es `apps/web`, que es un **prototipo no
desplegado** y que además ya-usaba el nombre de campo equivocado
(`procurementId` en lugar de `procurement_id`), por lo que siempre recibía un
HTTP 400. No hay ningún consumidor legítimo en producción que se breakee con
este cambio.

## Riesgos residuales

- Las llamadas al proveedor que fallan (5xx, JSON inválido) no escriben en
  `saas_analyses` y por tanto no cuentan para el presupuesto global; quedan
  acotadas por la autorización (sólo llamadores de confianza) y el límite por
  identidad.
- Dos peticiones simultáneas del mismo expediente pueden generar dos llamadas
  antes de que exista caché (sin bloqueo distribuido, que exigiría nueva
  infraestructura).
