# Canal estatal de oportunidades

El worker consulta cada 30 minutos los dos índices oficiales de la Secretaría de la Contraloría del Estado de México: obra pública y bienes/servicios. Es independiente de ComprasMX; mantiene sus once focos existentes. No requiere migración ni claves nuevas. Utiliza la tabla existente `system_state`.

## Selección

- ISSEMyM: cualquier giro y monto.
- Carreteras: monto explícito superior a 100 millones MXN. Si el índice no publica presupuesto, sólo se presentan candidatas con indicios de alcance carretero/regional o de SITRAMyTEM, con advertencia de que falta confirmar los 100 MDP. Se omiten pavimentaciones locales pequeñas sin presupuesto.
- Otros giros: referencia inicial de 20 millones MXN cuando hay monto explícito. Sin monto se requieren indicios de alcance grande (servicio integral, cobertura estatal, flota, plataforma, hospitales, medicamentos o infraestructura). Son candidatas para revisión, no contratos grandes confirmados.
- Excluye concesiones, proyectos llave en mano, teleféricos, viaductos, túneles y proyectos integrales de líneas Mexibús/Mexicable. Conserva mantenimiento puntual de semáforos y vialidades de SITRAMyTEM.

El portal publica filas que pueden agrupar varios procedimientos en un PDF. El aviso y la vigilancia se realizan por convocatoria agrupada. El capital contable requerido y el costo de bases nunca se usan como monto contractual. La selección no certifica capacidad legal, financiera ni técnica de la empresa: se deben revisar las bases y la fecha límite de inscripción.

## Nuevas detecciones y consentimiento

El primer ciclo guarda una línea base silenciosa. Los ciclos siguientes presentan sólo filas añadidas al índice: no se afirma que la fecha de detección sea fecha oficial de publicación. Una cola persistente entrega hasta cinco candidatas por ciclo, con enlace al PDF, monto confirmado o pendiente y botones Sí/No. También acepta responder sí/no al aviso original. La decisión se valida contra el chat, usuario propietario/administrador y mensaje, y se persiste antes de permitir la vigilancia. No descarga ni revisa periódicamente el PDF sin un Sí. El No no se vuelve a preguntar automáticamente.

La vigilancia estatal compara el hash del PDF de la convocatoria autorizada; su primer acceso aprobado establece la línea base. Un cambio posterior genera un aviso con el enlace oficial. El botón Dejar de vigilar detiene futuras comprobaciones. No vigila expedientes, fechas o nuevos anexos en otros portales: esa funcionalidad de ComprasMX conserva su mecanismo existente.

Respeta `/pausa` por ámbito, incluida pausa global. `watchdog_only` permite revisar únicamente PDFs ya autorizados, sin descubrir ni avisar nuevas candidatas. Fallos de lectura o persistencia no permiten una vigilancia sin consentimiento. El HTML vacío/bloqueado no reemplaza la línea base. Los enlaces y PDFs se restringen a HTTPS del dominio oficial, con límites de tamaño y tiempo, sin redirecciones.

## Verificación productiva

Desplegar el worker de este commit. Confirmar `system_state` con claves `edomex_index:convocatorias-obra-publica`, `edomex_index:convocatorias-bienes-servicios` y `edomex_last_run`, revisando las fechas. Antes del primer arranque productivo esas claves no existen. Este canal no aparece como un radar de la tabla `radars` ni agrega esos registros a `procurements`: se conserva en `system_state` y entrega avisos por Telegram.

Pruebas: parser del formato real con `^`, selección y montos, línea base sin avisos históricos, detección incremental, ausencia de descargas sin consentimiento, validación de remitente/mensaje, Sí, No, detención y cambios del PDF. También se prueba el parser con una copia pública del índice real, sin enviar Telegram.
