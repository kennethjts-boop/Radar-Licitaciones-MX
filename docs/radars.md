# Radares — Configuración y Expansión Semántica

## Radar Registry

Todos los radares están en `apps/worker/src/radars/`.
El registro central está en `radars/index.ts`.

---

## 1. capufe_emergencia
**Dependencia objetivo:** CAPUFE — Caminos y Puentes Federales
**Prioridad:** 1 (alta)

**Estrategia:** Cruzar expedientes de CAPUFE con términos de vehículos, equipamiento y servicios de auxilio vial.

**Términos clave:**
- ambulancia, grúa, auxilio vial, rescate, patrulla carretera
- mantenimiento vehicular, flota, refacciones
- torretas, sirenas, radio móvil, balizamiento
- carrocería, adaptación vehicular

---

## 2. capufe_peaje
**Dependencia objetivo:** CAPUFE
**Prioridad:** 1 (alta)

**Estrategia:** Detectar compras de consumibles y equipos para casetas de cobro.

**Términos clave:**
- rollos térmicos, papel térmico, ticket, comprobantes de peaje
- impresoras térmicas, cabezales, ribbons, tinta
- terminales de cobro, equipos de caseta, sistema de peaje
- plaza de cobro, carril, insumos de peaje

---

## 3. capufe_oportunidades
**Dependencia objetivo:** CAPUFE
**Prioridad:** 2 (media)

**Estrategia:** Detectar licitaciones fallidas o con baja participación que representan oportunidades de entrada.

**Señales:**
- status: desierta, cancelada
- texto: reposición, segunda vuelta, sin propuestas, propuesta única

---

## 4. issste_oficinas_centrales
**Dependencia objetivo:** ISSSTE
**Prioridad:** 1 (alta)

**Estrategia:** Filtrar por unidad compradora = oficinas centrales/amministración central.

**Términos clave:**
- oficinas centrales, corporativo, administración central
- mobiliario, licencias, papelería, limpieza, archivo
- digitalización, cómputo, cableado, impresión

**Exclusiones:** hospital, clínica, medicamentos

---

## 5. conavi_federal
**Dependencia objetivo:** CONAVI
**Prioridad:** 2 (media)

**Estrategia:** Cualquier licitación de CONAVI es relevante.

**Términos clave:**
- vivienda, subsidios, padrones, mejoramiento habitacional
- supervisión de obra, soluciones habitacionales
- geoestadística, diagnósticos territoriales, consultoría

---

## 6. imss_morelos
**Dependencia objetivo:** IMSS — OOAD Morelos / Delegación Morelos
**Prioridad:** 1 (alta)

**Estrategia:** Intersección de IMSS + geografía Morelos + cualquier categoría de insumos.

**Términos clave:**
- OOAD Morelos, delegación Morelos, UMF, HGZ
- medicamentos, material de curación, equipo médico
- limpieza, lavandería, alimentos, gases medicinales, ambulancias

---

## 7. imss_bienestar_morelos
**Dependencia objetivo:** IMSS-Bienestar (ex-INSABI) en Morelos
**Prioridad:** 1 (alta)

**Estrategia:** Unidades rurales y hospitales comunitarios en Morelos.

**Términos clave:**
- hospital comunitario, centros de salud, unidades rurales
- cadena de frío, vacunación, medicamentos
- equipamiento médico, laboratorio rural

---

## 8. habitat_morelos
**Dependencia objetivo:** SEDATU/Programa Hábitat en Morelos
**Prioridad:** 3 (baja-media)
**Nota:** Radar en depuración — afinar en Fase 4

**Términos clave:**
- mejoramiento urbano, rescate de espacios públicos
- banquetas, guarniciones, drenaje, alumbrado público
- pavimentación, obra urbana, desarrollo comunitario

---

## Cómo Agregar un Radar

1. Crear `src/radars/mi-radar.radar.ts` siguiendo el patrón de los existentes
2. Importarlo y añadirlo al array en `src/radars/index.ts`
3. Agregar seed en `supabase-schema.sql` (tabla `radars`)
4. Documentar aquí

## Calibración de Scores

- `minScore`: umbral para disparar alerta (0.0–1.0)
  - `< 0.3`: demasiado permisivo → muchos falsos positivos
  - `0.35–0.45`: equilibrio típico para detectar con contexto
  - `> 0.6`: muy estricto → puede perderse matches válidos
- Ajustar con datos reales en Fase 5
