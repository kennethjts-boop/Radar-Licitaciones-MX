# Histórico CAPUFE (SIPOT / PNT)

Este script (`historico-capufe-sipot.ts`) permite consultar contratos adjudicados históricos de CAPUFE desde la **Plataforma Nacional de Transparencia (SIPOT)**. Está diseñado para ejecutarse manualmente bajo demanda (no es parte del scheduler regular) y filtrar licitaciones relevantes usando las palabras clave del radar `capufe_mantenimiento_equipos`.

## ⚠️ VALIDACIÓN PREVIA REQUERIDA (TODO)

El endpoint de la API pública de SIPOT cambia frecuentemente y requiere headers/cookies de sesión. **Antes del primer uso, debes:**

1. Abrir [https://consultapublicamx.plataformadetransparencia.org.mx/](https://consultapublicamx.plataformadetransparencia.org.mx/) en tu navegador.
2. Buscar institución *"Caminos y Puentes Federales de Ingresos y Servicios Conexos"*.
3. Seleccionar Artículo 70, Fracción XXVIIIb (o XXVII).
4. Abrir **DevTools → Network**, realizar la búsqueda de contratos y presionar "Buscar".
5. Capturar la URL exacta del endpoint y el payload/headers (ej. Request Payload en JSON).
6. Abrir `apps/worker/src/scripts/historico-capufe-sipot.ts`, buscar el bloque `// TODO: validar endpoint SIPOT vigente` y pegar la configuración capturada en la función `fetchSipotPagina`.

## Cómo ejecutarlo

Ubicado en la consola dentro de la carpeta `apps/worker`:

### Ejecución básica
```bash
npm run historico:capufe
```
Por defecto:
- Consulta los últimos **5 años** (hasta el actual).
- Usa las **keywords por defecto** del radar de mantenimiento de equipos (ej. "control de transito", "semaforos", "barreras vehiculares").

### Filtrar por un año específico
```bash
npm run historico:capufe -- --year 2023
```

### Cambiar el número de años hacia atrás
```bash
npm run historico:capufe -- --years 3
```

### Sobrescribir keywords
Puedes pasar una lista de palabras separadas por coma:
```bash
npm run historico:capufe -- --keywords "hitachi,control de transito,telepeaje"
```

### Modo Dry-Run (Solo imprimir, sin escribir CSV)
```bash
npm run historico:capufe -- --dry-run
```

## Output esperado

El script genera un archivo CSV local en:
`apps/worker/data/historico-capufe-YYYY-MM-DD.csv`

El CSV contiene las siguientes columnas:
- `año`
- `fraccion`
- `numero_contrato`
- `objeto`
- `proveedor`
- `monto`
- `fecha_adjudicacion`
- `url_contrato_pdf`

### Ejemplo de validación exitosa
Si consultas el rango de tiempo adecuado y los filtros funcionan bien, al buscar "Hitachi" en el CSV generado deberás encontrar registros de adjudicaciones a su favor por "mantenimiento a equipo de control de tránsito". Si no logras obtener ese registro, posiblemente debas ajustar el mapeo JSON en la función temporal de extracción o verificar los parámetros de búsqueda en SIPOT.
