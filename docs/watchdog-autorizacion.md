# Watchdog con autorización por licitación

Al entregar una alerta NEW_MATCH elegible de los once focos, el bot pregunta si se debe vigilar la licitación. Se acepta con el botón «Sí, vigilar» o respondiendo «sí» al mensaje. «No vigilar» o «no» guardan el rechazo. Un sí/no sin responder a una solicitud no modifica nada.

Las decisiones se guardan por procurement en system_state con la clave watchdog_consent:<id>. No requiere migración. Sólo se programan targets activos con consentimiento approved; los históricos quedan fuera hasta autorizarse. Un fallo al leer permisos impide la vigilancia.

Las preguntas pendientes o rechazadas no se repiten por ciclo. La conciliación emite como máximo diez solicitudes por pasada y recupera altas interrumpidas que ya tengan un Sí. /novigilar conserva precedencia sobre la aprobación anterior, sin borrar snapshots.

Los callbacks se validan contra el chat, usuario y mensaje originales; en chats de grupo sólo pueden responder usuarios incluidos en TELEGRAM_ADMIN_CHAT_IDS. En chat privado puede responder el titular de TELEGRAM_CHAT_ID. La primera decisión persistida gana. Las actualizaciones Telegram pendientes se conservan al reiniciar.

Validación: pruebas del módulo watchdog y comandos Telegram, typecheck y build. La entrega real de preguntas y sus respuestas requiere verificar el worker desplegado con Telegram conectado.
