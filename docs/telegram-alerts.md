# Alertas Telegram — Formatos y Ejemplos

## Canal de Alertas

Bot Telegram → Chat ID configurado → alertas automáticas.

---

## Formato de Alerta de Nuevo Match

```
🔴 NUEVO MATCH — CAPUFE — Vehículos y Equipamiento de Emergencia
Nivel: HIGH | Score: 78%

📋 Expediente: EA-009000999-E14-2024
🔢 Licitación: 09000999-001-24
📝 Proc. #: N/D

📌 Adquisición de grúas plataforma y equipo de auxilio Vial para CAPUFE

🏛 Dependencia: Caminos y Puentes Federales de Ingresos y Servicios Conexos
🏢 Unidad compradora: Subdirección de Conservación y Operación
📍 Ubicación: Ciudad de México

📅 Publicación: 01/04/2024
📊 Estatus: publicada
💰 Monto: $3,500,000

🎯 Razón del match:
Match HIGH (score: 78%) en radar "capufe_emergencia". Términos coincidentes: grúas, auxilio vial, equipo. Expediente nuevo — primera vez detectado.

🔍 Términos detectados: grúas · auxilio vial · equipo · mantenimiento vehicular · capufe

📎 Adjuntos: 3 archivo(s)

🔗 Ver expediente:
https://www.comprasmx.gob.mx/expediente/EA-009000999-E14-2024

⏱ Detectado: 08/04/2024 10:35
```

---

## Formato de Alerta de Cambio de Estatus

```
🔄 CAMBIO DE ESTATUS — IMSS — Delegación Morelos (OOAD)

📋 Expediente: IMSS-21-001-2024
📌 Suministro de medicamentos para UMF No. 1 Cuernavaca

🏛 Dependencia: Instituto Mexicano del Seguro Social

📊 Estatus anterior: publicada
📊 Estatus nuevo: desierta

🔗 https://www.comprasmx.gob.mx/expediente/IMSS-21-001-2024
⏱ 08/04/2024 14:22
```

---

## Formato de Resumen Diario (07:00 AM México)

```
📊 RESUMEN DIARIO — 2024-04-08
Radar Licitaciones MX

👁 Total revisado: 342
🆕 Nuevos expedientes: 28
🔄 Actualizados: 15
🎯 Matches encontrados: 7
📨 Alertas enviadas: 7

📡 Matches por radar:
  • capufe_emergencia: 2
  • capufe_peaje: 1
  • imss_morelos: 3
  • habitat_morelos: 1

🏛 Dependencias más activas:
  1. Instituto Mexicano del Seguro Social (45)
  2. Caminos y Puentes Federales (23)
  3. ISSSTE (18)
  4. CONAVI (12)
  5. Secretaría de Salud (8)
```

---

## Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `/prueba` | Estado del sistema: worker, DB, Telegram, última corrida |
| `/buscar <texto>` | Busca expedientes por texto, número, dependencia |
| `/debug_resumen` | Estado detallado de collectors y último ciclo |

---

## Niveles de Match

| Emoji | Nivel | Score | Descripción |
|-------|-------|-------|-------------|
| 🔴 | HIGH | ≥ 70% | Match muy probable — revisar definitivamente |
| 🟡 | MEDIUM | 40–69% | Match probable — revisar con contexto |
| 🟢 | LOW | < 40% | Posible match — menor prioridad |
