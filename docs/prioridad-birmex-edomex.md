# Focos de prioridad (versión `prioridad_20261108`)

Cuatro radares nuevos sobre el pipeline Edomex (misma cola `alerts`, `MAX_ALERTS_PER_CYCLE = 10`). Los 15 focos previos no cambian. Total: 19 activos.

| Clave | Criterio |
|---|---|
| `birmex_prioridad_20261108` | BIRMEX (siglas, razón social, UC `012NEF001`), cualquier giro/monto. **Sale primero** en la cola de entrega. |
| `edomex_difem_20261108` | DIFEM estatal. Excluye DIF municipales y SNDIF. |
| `edomex_jcem_20261108` | Toda convocatoria de la Junta de Caminos aunque no tenga monto; marca 🔥 si el monto explícito es > $100 MDP. Tiene precedencia sobre `edomex_carreteras`. |
| `edomex_salud_20261108` | ISEM y Secretaría de Salud del Estado de México (identifica el organismo en `matchedTerms`). Excluye ISSEMyM, IMSS y salud federal. |

- Matcher: `classifyPriorityProcurement` en `radars/edomex-focus.matcher.ts` (corre antes que la clasificación Edomex).
- Corte de publicación propio: 2026-10-09 (30 días); `publication_date` nula se considera elegible.
- Migración: `supabase/migrations/20261108_prioridad_radares.sql` (aplicar **antes** del despliegue; el guardado de matches falla si el radar no existe en BD).
- Montos sin publicar se muestran "por verificar"; nunca se afirma un monto.

## Conciliación única (SECOGEM)

Al primer ciclo Edomex tras el despliegue, `reconcilePriorityRows` evalúa contra los focos nuevos las filas del índice ya conocidas y detectadas después del archivo histórico (≥ 2026-10-26). Sello: `system_state.edomex_priority_backfill_v1:<slug>`. Respeta vencimiento y el tope de 10 alertas por ciclo (BIRMEX primero); los matches se guardan siempre.

## Umbral de presupuesto oficial (2026-11-09)

Los cuatro focos solo alertan con **presupuesto oficial confirmado del procedimiento específico ≥ $100 MDP** (exactamente $100 MDP cuenta). Umbral por radar: `BIRMEX_MIN_AMOUNT_MXN`, `DIFEM_MIN_AMOUNT_MXN`, `JCEM_MIN_AMOUNT_MXN`, `SALUD_EDOMEX_MIN_AMOUNT_MXN` (valor inicial 100000000).

- Monto < umbral: no es oportunidad prioritaria; el procedimiento sigue las reglas de los radares anteriores.
- Sin monto, con compra consolidada / multianual / alcance estatal o nacional: se guarda el match como **«monto por verificar»** (nivel medium) y no alerta.
- Al confirmarse el monto (`procurements.amount`) y seguir abierto, `reconcilePriorityOpportunities` (cada ciclo Edomex, DB) encola una sola alerta (dedupe por expediente, BIRMEX primero, tope 5 por corrida y 10 por ciclo de Telegram).
- Compuerta en `ensurePendingNewTenderAlert` y filtro en `getPendingNewTenderAlerts` para pendientes (no se marcan `failed`; quedan por si se confirma el monto).
- Capital contable, costo de bases y presupuesto general de un programa no cuentan; una convocatoria agrupada no hereda monto.

## Confirmación del presupuesto y cruce directo de BIRMEX (2026-11-09)

- **Cruce directo:** `refreshBirmexFromSource` consulta ComprasMX con la firma del colector (`numero_procedimiento = 012NEF001`) cada ciclo Edomex y actualiza por `upsertProcurement` (el listado general no traía cambios de fecha/estatus de filas conocidas). Cobertura `complete` solo si se leyó todo lo que el portal reporta; si no, `partial`. Script manual: `scripts/birmex-crosscheck.ts`.
- **Ruta del monto:** para «monto por verificar» abiertos (máx. 3 por corrida, BIRMEX primero) `resolveOfficialBudget` lee (1) los *requerimientos económicos* por partida del detalle de ComprasMX (suma de `monto_maximo`) con el navegador del colector; (2) si no hay, convocatoria/bases/anexos (PDF/DOCX/XLSX) con `extractOfficialBudget`, que solo acepta cifras rotuladas como presupuesto/monto/techo del procedimiento y descarta capital contable, costo de bases, garantías, experiencia y presupuesto general.
- **Evidencia:** tabla `procurement_official_budget` (enlace, nombre del documento, página cuando el formato pagina, etiqueta, extracto, tipo de fuente). `procurements.amount` solo se completa si estaba vacío y `upsertProcurement` ya no lo borra.
- **Antes de enviar:** compuerta al encolar y en la cola de pendientes: estatus vigente (`publicada/activa/en_proceso`), apertura no vencida y presupuesto confirmado ≥ umbral. Cancelada con fecha futura no sale.

## Persistencia de campos volátiles y verificación del monto (2026-11-09, noche)

- **Bug corregido:** `upsertProcurement` descartaba el cambio como «sin cambios» si el fingerprint de texto (título, descripción, organismo, unidad, expediente) coincidía, aunque cambiaran fecha de apertura, estatus, monto o enlace. Ahora compara también esos campos (fechas por AAAA-MM-DD, columnas `date`) y escribe + versiona solo si hay diferencia real. Caso real: BIRMEX `LA-12-NEF-012NEF001-N-3-2027`, apertura 5→19-nov-2026. Prueba con el repositorio real sobre un cliente en memoria: `procurement.repo.volatile-fields.test.ts` (falla con el código anterior).
- **`updated` del cruce de BIRMEX** cuenta solo escrituras efectivas (`isUpdated`); lo demás es `unchanged`.
- **Monto de ComprasMX solo se confirma si:** moneda = peso mexicano (`descripcion_moneda`), todos los grupos son «PARTIDA SOLA» (partidas independientes, acumulables), el portal reporta tantas partidas como se leyeron, el detalle lista el mismo número, la numeración es contigua y todas traen monto máximo ≥ mínimo. Si falta algo, sigue «monto por verificar». La moneda guardada es la verificada. IVA: no consta en el portal (se anota en el extracto).

## Calendario y seguimiento desde la alerta (2026-11-09)

Las alertas de BIRMEX llevan **📅 Ver calendario** y **🔔 Avisarme de cambios** (`CALENDAR_BUTTON_RADAR_KEYS` en `procurement-calendar/service.ts`; se amplía agregando radares). Callbacks `cal:<uuid>` y `trk:on|off:<uuid>` con la misma autorización que el watchdog (`isAuthorizedChatUser`). `/calendario <expediente>` es la consulta alternativa.

- **Hitos:** publicación, junta de aclaraciones, presentación y apertura, fallo; fecha, hora si consta, «Sin publicar» si falta, enlace oficial. Fecha límite de entrega junto a la apertura cuando la fuente la distingue. Avisos oficiales de suspensión/diferimiento se señalan (la fecha vigente de la junta consta en el aviso). Publicación oficial ≠ detección del radar; esta se muestra en hora CDMX (también en la alerta).
- **Seguimiento:** el botón aprueba el consentimiento del watchdog y activa su objetivo (reutiliza `watchdog_consent` / `watchdog_targets`); el ciclo Edomex (`runCalendarTracking`, máx. 5) compara contra el último calendario confirmado y avisa **una vez** por fecha nueva o modificada (anterior → nueva + enlace), aviso oficial nuevo o acta de fallo. Si el portal falla, conserva el último calendario y no avisa; una fecha que desaparece no es un cambio. Los cambios del watchdog que son solo de fechas se omiten (`supersededBy: "calendar"`) para no duplicar el aviso.
- **Fuentes solo PDF (SECOGEM):** el calendario lista únicamente los hitos verificables y dice cuáles no.
- **Botones en mensajes ya enviados:** `attachCalendarButtonsToSentAlerts` edita el teclado (p. ej. mensaje 3905); si Telegram no lo permite, ofrece `/calendario <número>`. Estado en `system_state` (`calendar_snapshot:*`, `calendar_tracking:*`, `calendar_notified:*`, `calendar_buttons:*`).

## Vigilancia prioritaria de dos folios de BIRMEX (2026-11-09)

Folios (`modules/priority-watch/types.ts`): `LA-12-NEF-012NEF001-N-306-2026` (E-2026-00113872, despacho automatizado de medicamentos, Farmacias del Bienestar) y `LA-12-NEF-012NEF001-N-3-2027` (E-2026-00113902, servicio integrado regional; 7 partidas, destaca **Región IV · Estado de México y Alta Especialidad**). Sin IA: todo sale del detalle de Compras MX.

- **Cadencia:** cron `7,22,37,52 * * * *` (cada 15 min, desfasado de Edomex) + arranque a los 45 s. Respeta `/pausa watchdog|todo`. Se consulta el detalle por UUID (o por número de procedimiento con la API firmada) aunque ya no figure en el listado de abiertos, esté adjudicado o tenga fallo, y no se detiene tras el fallo: sigue con contratos y convenios. Espera progresiva por folio ante errores: 15, 30, 60 y 120 min. Resumen del ciclo en `system_state.priority_watch_last_run`.
- **Estado:** `priority_watch_state:<folio>` (línea base confirmada, cobertura de partidas, pendientes de verificar, lectura inicial) y `priority_watch_outbox:<folio>` (bandeja de avisos). La lectura inicial no avisa nada histórico.
- **Eventos** (identidad `folio|tipo|sujeto|valor`, la misma que usa el calendario `cal|<hito>:<fecha>`): fechas nuevas/modificadas, avisos de diferimiento/suspensión, bases/anexos nuevos o modificados, actas de junta/apertura/fallo, **fallo** (acta + estatus + contratos en un solo aviso, resultado total/parcial, proveedor, montos con y sin IVA, moneda), contratos y convenios/modificaciones posteriores, partidas modificadas (solo con listas completas), descripción con temas técnicos (software, trazabilidad por lote, integración con sistemas de BIRMEX, inventarios, cadena de frío), cancelación o desierta **solo por estatus explícito del portal**.
- **Nunca avisa** por un dato que desaparece, una lista incompleta, una fecha vencida, un acta ausente ni un listado vacío; se conserva el último estado confirmado (`mergeConfirmed`).
- **Entrega:** la novedad se persiste en la bandeja *antes* de enviar y la intención `sending` se persiste antes del envío. Rechazo definitivo (HTTP 400) → `dead`; fallo sin entrega (ECONNREFUSED, 429…) → reintento con espera y sin marca; **entrega incierta** (tiempo agotado, conexión cortada o `sending` encontrado tras un reinicio) → se reenvía **una vez** con la leyenda «Reenvío». Si Telegram entrega pero el asiento falla, solo se reintenta el asiento. **Ventana de duplicación que permanece:** el proceso muere después de que Telegram entrega y antes de persistir `sent` → el reenvío marcado puede aparecer duplicado (se prefiere duplicar con marca a perder un aviso). La cola general de alertas (`deliverPendingWithinLimit`) conserva su límite documentado: el asiento pendiente en memoria se pierde con un reinicio.
- **Dedupe con calendario y watchdog:** el ciclo del calendario no avisa estos folios. El watchdog cede un cambio solo si la vigilancia capturó **ese folio** con éxito después del cambio y su estado ya contiene el mismo valor (fecha normalizada a CDMX, documento y revisión, estatus exacto; descripciones de partidas con cobertura `ok` y valor exacto, otras celdas conservan el respaldo del watchdog); que el ciclo general de Edomex haya terminado bien no basta.
- **Partidas incompletas (`structural_incomplete`):** el watchdog conserva la última captura confirmada y registra `watchdog_partidas_coverage:<folio>` (`transient` → `degraded` tras 3 ciclos seguidos); la vigilancia usa la API de partidas aparte y registra `partidasCoverage` en su estado. Un acta nueva se verifica por la lista de anexos, independiente de la tabla.
- **Seguimiento existente:** se preserva `watchdog_consent` (3906) y el seguimiento del 3905. Un `calendar_tracking` habilitado sin `by`/`chatId` es **estado heredado** (`trackingOrigin`), no prueba de un botón. 🔕 no silencia estos folios. El cierre del calendario de hitos tras el acta de fallo no desactiva el watchdog ni la vigilancia de contratos.
- **Moneda:** el listado de Compras MX ya no se asume en pesos (`currency` null); un monto sin moneda confirmada queda «moneda por confirmar» y no cuenta contra el umbral hasta contrastarlo con el portal (`descripcion_moneda`).
- **Límite conocido:** los PDF de las actas (participantes, ofertas, desechamientos y motivos por partida) están detrás de un CAPTCHA de Compras MX; el aviso lo declara «documento pendiente de revisión» con el enlace al expediente.
- **Respaldo:** DOF y datos abiertos (Contrataciones Abiertas) se consultan solo en eventos con evidencia nueva, con tiempo límite; se citan únicamente si mencionan el folio y, si discrepan del portal, se indica la diferencia y se aplica el documento más reciente. `scripts/priority-watch-dryrun.ts`: lectura real de solo lectura sin Supabase ni Telegram.

### Revisión final del PR #74

- El adaptador de producción usa `sendTelegramMessageSingleAttempt`, conserva los botones y entrega el error original a la bandeja: no hay reintentos internos sin marca ni pérdida del HTTP 400.
- La bandeja conserva pendientes e identidades entregadas al superar 200 eventos. El límite de entrega sigue siendo 10 por ciclo.
- Los cambios de descripción de partidas numeradas sí generan aviso; una adición de acta verificable se conserva incluso con una lista parcial de anexos. Los pendientes de lectura del PDF no se borran por detectar un fallo.
- El resultado parcial explícito se respeta; «ADJUDICADO» sin correspondencia completa entre contratos y partidas no prueba resultado total. Un cambio entre adjudicación parcial y total también genera evento.
- El respaldo del watchdog solo cede valores comprobados del mismo folio; se comparan fechas UTC/local en CDMX y revisiones documentales, sin suprimir una tabla entera por tener cobertura completa. Cuando no se puede acreditar la correspondencia de una celda, el watchdog conserva su aviso.
- La prueba del ciclo Edomex aísla el cruce firmado de BIRMEX para no consultar portales reales en la suite unitaria.
