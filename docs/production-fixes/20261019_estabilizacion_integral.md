# 2026-10-19 — Estabilización integral (conservación de oportunidades, watchdog y seguridad)

Rama: `fix/stabilization-2026-10` (base: `origin/main` @ `3be523a`).

Este documento describe qué se corrigió, qué queda pendiente y cómo desplegar
sin interrupciones. **No se ejecutó ningún despliegue, migración ni envío real
de Telegram durante la preparación de estos cambios.**

---

## 1. Reconciliación previa (hallazgos de la auditoría anterior que ya no vigentes)

La auditoría previa se hizo sobre una rama `main` local atrasada cinco commits.
Al reconciliar contra `origin/main` se confirmó que sus conclusiones ya no
aplicaban:

| Hallazgo previo | Estado real en `origin/main` |
| --- | --- |
| Once focos CAPUFE/IMSS sin integrar | **Ya integrado** (PR #56, `f1d24f9` + `9468eb3`) |
| Watchdog sin `activateWatchdogForSentAlert` | **Ya implementado** (PR #57) |
| Watchdog sin `reconcileWatchdogFromSentAlerts` | **Ya implementado** (PR #57, `1196438`) |
| Altas manuales por comando de Telegram | **Ya corregido** (PR #57, `948cd97` + `3928c07`) |
| Watchdog capaz de reactivar objetivos históricos | **Ya corregido** (`4086a70`, entorno fail-closed) |
| Avisos de watchdog extensos y costosos | **Ya corregido** (PR #58, formato compacto) |
| PR #56 / #57 / #58 pendientes de merge | **Los tres están MERGED** (2026-10-15) |

`origin/main` estaba **25 commits adelante** del `main` local. Los tres PR se
revisaron commit por commit antes de tocar nada.

Los cambios locales sin confirmar del árbol principal (perfil de alerta
`capufe_mobiliario_muebles`, keywords de `company_profile.json`, formato de
Telegram con alias, dependencias `playwright-extra`) **son trabajo en curso no
relacionado** y se conservaron intactos: este trabajo se hizo en un worktree
independiente.

---

## 2. Defectos confirmados y corregidos

### 2.1 P0 — Una fecha de publicación verificada se borraba y dejaba alertas huérfanas

**Causa raíz.** `upsertProcurement` (caso "expediente con cambios") escribía
`publication_date: normalized.publicationDate` sin condición. El listado de
ComprasMX **no** devuelve la fecha de publicación (sólo el detalle del
cronograma la trae), así que cualquier cambio en el fingerprint canónico
—corrección de título, cambio de sigla, de dependencia o de expediente—
**vació la fecha que el worker había verificado**.

**Efecto en cadena (pérdida de oportunidades).**

1. La cola de entrega filtra por `procurements.publication_date >= 2026-10-14`.
   Con la fecha en `NULL` la alerta quedaba **invisible para la cola**,
   `telegram_status` seguía en `pending` y **no existía ruta de reintento**:
   sólo se recuperaba con `/perdidas`.
2. La activación del watchdog usa la misma fecha: el expediente **nunca quedaba
   vigilado**.

**Corrección.**

- `storage/procurement.repo.ts`: la fecha verificada ya no se sobrescribe con
  `null` (`normalized.publicationDate ?? existing.publication_date`).
- `storage/match-alert.repo.ts`: el corte de publicación se evalúa **en
  memoria** en lugar de con `.gte()` en la consulta. Una alerta creada sólo lo
  es después de superar la elegibilidad, así que un `NULL` actual no debe
  ocultarla. El corte anterior al 14 de octubre se sigue descartando.
- `licitacion-watchdog/auto-activation.ts`: la conciliación deja de filtrar por
  fecha en SQL y tolera `NULL` en el expediente.

### 2.2 P0 — Fallos silenciosos de Telegram, reintentos infinitos y duplicados

`modules/operational-alerts/delivery.ts` tenía un `catch {}` **sin log, sin
métrica y sin registro del identificador de la alerta**. Consecuencias:

- Un rechazo permanente de Telegram (HTML inválido, chat bloqueado) se
  reintentaba **en cada ciclo, para siempre**, sin ninguna señal visible.
- Si el mensaje **sí** se entregaba pero fallaba el asiento en base de datos,
  la alerta quedaba `pending` y **se reenviaba**: duplicado en el canal del
  operador.
- Si Telegram caía por completo, el ciclo intentaba las ~500 alertas en cola
  sin ningún tope de trabajo.

**Corrección.**

- Observabilidad: cada fallo se registra con su `alertId` y su clasificación.
- Sin duplicados: si el mensaje ya fue entregado y sólo falla el asiento, la
  alerta se marca `failed` **conservando el `telegram_message_id`**, de modo que
  la recuperación manual no vuelve a enviar un mensaje ya visto.
- Carta muerta: un rechazo **definitivo** de la API de Telegram (4xx sin
  reintento) marca la alerta como `failed` y deja de reintentarse. Los fallos
  transitorios (red, timeout, 5xx, 429) siguen en `pending`.
- Techo de trabajo por ciclo (`2 × ALERT_MAX_PER_CYCLE`).
- `markAlertFailed` ya existía pero **nunca se llamaba**; ahora se usa, y una
  alerta `failed` deja de "resucitar" automáticamente en
  `ensurePendingNewTenderAlert` (eso devolvía el rechazo a un ciclo infinito).

### 2.3 P0 — El watchdog nunca retiraba expedientes terminados

Un target del watchdog quedaba activo hasta que alguien ejecutaba `/novigilar`
manualmente: un expediente **desierto o cancelado** seguía consultándose en
cada ciclo (navegación, extracción, navegador) indefinidamente.

**Corrección.** Nuevo módulo `licitacion-watchdog/completion.ts`:

- Se lee `Estatus del procedimiento de contratación` del snapshot verificado.
- Estados **definitivos** (`DESIERTA`, `CANCELADA`, `ANULADA`, con
  normalización de acentos y mayúsculas) → el objetivo se **desactiva** y el
  operador recibe un aviso neutro con el motivo.
- **Criterio conservador deliberado:** un `FALLO`, `ADJUDICADO`, `EN FIRMA` o
  `CONTRATO FIRMADO` **no** retiran la vigilancia, porque después del fallo se
  publican el contrato y sus anexos, que es justo lo que el operador quiere
  detectar.
- El objetivo **se desactiva, nunca se borra**: se conservan la fila, los
  snapshots y el historial de cambios.
- Si el portal no expone el estatus, **no se decide nada**.

### 2.4 P0 — Comandos de escritura de Telegram sin autorización de administrador

`/novigilar` (desactiva la vigilancia de un expediente) y `/perdidas` (reenvía
alertas **y** modifica `alerts.telegram_status`) sólo comprobaban el chat.
`TELEGRAM_CHAT_ID` es un **grupo**, así que cualquier miembro del grupo podía
suprimir futuras alertas o forzar reenvíos. El resto de comandos de escritura
(`/pausa`, `/reanudar`, `/scan`, `/recuperar`, `/dormir`, `/despertar`) ya usaban
`authorizeWriteCommand`, que falla cerrado.

**Corrección.** Ambos comandos pasan por `authorizeWriteCommand` (mismo criterio
que el resto). Además, `/perdidas`:
- ya **no reenvía** alertas que sí fueron entregadas pero cuyo asiento se perdió
  (evita duplicados) y las reporta aparte;
- sólo reenvía tipos de alerta recuperables (`new_match`, `daily_summary`).

### 2.5 P0 — Edge Function `analyze-procurement` sin autenticación y con gasto de IA

> **Va en el PR #59 (`security/analyze-procurement-auth`)**, porque la Edge
> Function es un desplegable distinto con su propio ciclo de despliegue y sus
> propios secretos. Resumen:
>
> - Autenticación obligatoria: secreto compartido (`ANALYZE_PROCUREMENT_SECRET`,
>   comparación en tiempo constante) **o** sesión de Supabase Auth válida. Sin
>   ningún mecanismo configurado responde **503** y no llama al modelo.
> - El expediente se valida (UUID + existencia) **antes** de cualquier llamada
>   al modelo: antes, un `procurement_id` inventado gastaba una llamada de
>   OpenRouter sin límite.
> - Caché de 30 min, enfriamiento de 10 min y límite de peticiones por
>   llamador.
> - CORS por lista blanca (`ALLOWED_ORIGINS`); sin origen configurado no se
>   devuelve ninguna cabecera CORS.
> - Los errores del proveedor y de la base de datos ya no se exponen al
>   llamador.
> - El contenido controlado por el llamador va delimitado como
>   `<datos_de_la_licitacion>` / `<contexto_documental>` y el prompt indica
>   explícitamente que son datos, nunca instrucciones.
> - Se eliminó una consulta a `document_analysis` que no aportaba nada al
>   prompt.
>
> Detalle y procedimiento de despliegue:
> `docs/production-fixes/20261019_edge_function_auth.md`.

### 2.6 P1 — Inconsistencia de versión de configuración entre código y base de datos

La clave `operational_20261014` estaba **repetida en cuatro módulos**. Si la
migración de octubre se actualizaba y sólo se corrigiera una copia,
`upsertMatch` empezaba a lanzar `StorageError` y **las alertas de los once
focos se detenían en silencio**.

**Corrección.** Nueva fuente única de verdad:
`apps/worker/src/radars/operational-version.ts` → `OPERATIONAL_RADAR_VERSION_KEY`,
usada por `match-alert.repo`, `comprasmx.collector` y
`licitacion-watchdog/auto-activation`. El mensaje de error ahora incluye la
versión vigente y la esperada.

---

## 3. Lo que NO se cambió (a propósito)

- **No** se tocó `radar_config_versions`, ni las migraciones, ni RLS en
  producción.
- **No** se modificaron los once focos, sus claves, el matcher ni el corte
  operativo.
- **No** se rediseñó el watchdog: se conservaron el guard de pérdida
  estructural, el diff, la conciliación idempotente, laActivation sólo por
  alertas entregadas y el narrador determinista.
- **No** se tocó `apps/web`: es un prototipo **no desplegado** (no hay
  configuración de despliegue; `railway.toml` sólo construye el worker) y su
  login es del lado del cliente. Se documentó, no se amplió.
- **No** se añadieron dependencias ni servicios de pago.

---

## 4. Migraciones

**Ninguna migración es necesaria para este conjunto de cambios.** Seapura
`alerts.telegram_status = 'failed'` ya existía (`CHECK (telegram_status IN
('pending','sent','failed'))`) y `alerts.telegram_message_id` también.

---

## 5. Procedimiento de despliegue recomendado (NO ejecutado)

1. **Revisar y aprobar el PR.** No hacer merge sin la aprobación del titular.
2. **Respaldar la base de datos** por el procedimiento habitual.
3. **No hay migraciones que aplicar.** Verificar de todos modos que
   `supabase migration list --linked` no reporta nada pendiente de este
   cambio.
4. **Desplegar el worker** desde el commit aprobado. Railway reconstruye la
   imagen; no hay cambios de variables de entorno.
5. **Verificar en los primeros ciclos:**
   - `alerts` con `telegram_status = 'pending'` y `sent_at` nulo: debe
     **bajAR** (la cola ya no tiene alertas huérfanas por fecha nula).
   - `watchdog_targets` con `active = false` y `deactivated_at` reciente: sólo
     debe crecer por expedientes **desiertos/cancelados** o por `/novigilar`
     manual.
   - Logs: `Alertas marcadas como no entregables` y `Watchdog retirado` deben
     aparecer sólo en casos explicados.
6. **Edge Function (sólo si se decide habilitarla) — PR #59:**
   - `supabase secrets set ANALYZE_PROCUREMENT_SECRET=<secreto>` (obligatorio
     si no se usa Supabase Auth).
   - `supabase secrets set ALLOWED_ORIGINS=https://<origen-real>` si se va a
     llamar desde un navegador.
   - `supabase functions deploy analyze-procurement`.
   - **Orden importante:** la función actual no pide autenticación. Mientras no
     se despliegue esta versión, cualquiera con la URL puede gastar créditos.
     Si no se va a usar la función, **deshabilítala o elimínala** en lugar de
     dejarla expuesta.
7. **Configurar `TELEGRAM_ADMIN_CHAT_IDS`** antes de depender de `/novigilar` y
   `/perdidas`: ambos comandos quedan deshabilitados (fail-closed) si la
   variable está vacía, igual que el resto de comandos de escritura.

---

## 6. Lo que queda pendiente (y por qué)

| Pendiente | Motivo |
| --- | --- |
| Reparar expedientes con `publication_date` en `NULL` ya persistidos | Requiere acceso a la base de datos de producción; está fuera del alcance autorizado. El código ya no genera ese estado. |
| Verificar en producción que el corte por fecha no oculta alertas reales | Sólo comprobable con datos productivos. |
| `TELEGRAM_ADMIN_CHAT_IDS` en producción | Configuración del entorno; si está vacía, `/novigilar` y `/perdidas` quedan deshabilitados. |
| Confirmar que la migración `20260707_lock_public_rls.sql` está aplicada en producción | Sólo verificable contra la base de datos real; es la única barrera entre la clave `anon` y `procurements`, `matches`, `alerts` y `external_leads` (incluye datos de contacto de terceros). |
| `apps/web` (prototipo) | No desplegado y con login de cliente. Corregirlo sólo si se decide incorporarlo al producto. |
| Re-check diario: sólo persiste matches, no notifica | Comportamiento deliberado desde el PR #44 ("sólo licitaciones nuevas, activas y desiertas recientes"). Un cambio de estatus **no** genera una segunda alerta porque la clave de dedupe es por expediente, no por tipo de alerta. Rediseñarlo exigiría decidir la política de avisos de cambio de estatus. |
| Capacidad del listado (1 000 registros por ciclo) | `maxPages` está fijado a 10 en `collect.job.ts` e ignora `COMPRASMX_MAX_LIST_PAGES`. Afecta cobertura, no corrección. |
| `db:audit:rls` en CI | Requiere credenciales de Supabase en el entorno de CI. |
