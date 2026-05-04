# 🚀 Radar Licitaciones MX

> **Motor OSINT 24/7 y Agente de Inteligencia Artificial para el monitoreo, filtrado y análisis de licitaciones públicas en México (ComprasMX).**

---

## 🎯 ¿Qué puede hacer este sistema?

Radar Licitaciones MX no es solo un scraper tradicional; es un **agente autónomo** que vigila las plataformas gubernamentales y analiza los documentos adjuntos utilizando Inteligencia Artificial (OpenAI) para entregarte oportunidades de negocio altamente filtradas y digeridas directamente en Telegram.

### ✨ Funciones Principales

1. **Monitoreo en Tiempo Real (24/7)**
   * Utiliza navegadores *headless* (Playwright) para evadir bloqueos antibot y monitorear el portal de Compras MX cada 30 minutos.
   * Atrapa licitaciones en el instante en el que cambian su estatus a "Vigente", "En Apertura", etc.

2. **Filtros Inteligentes y "El Muro" (Business Profile)**
   * **Bloqueo Geográfico:** Descarta automáticamente licitaciones de estados y ciudades que no son de interés (Oaxaca, Sonora, Mazatlán, etc.).
   * **Bloqueo por Nicho:** Rechaza licitaciones de servicios basura (Limpieza, Jardinería, Vigilancia) antes de siquiera procesarlas.
   * **Filtro de Fechas:** Garantiza que solo veas licitaciones "a partir de hoy". Ignora expedientes antiguos o con fechas de apertura vencidas.

3. **Análisis de IA y Alertas VIP 🔥**
   * Cuando detecta un Match fuerte (ej. *CAPUFE Peaje*), el sistema descarga los **PDFs adjuntos** de la licitación y los lee utilizando `gpt-4o-mini`.
   * **Opportunity Engine:** La IA evalúa la probabilidad de ganar, detecta "Red Flags" (requisitos excesivos o licitaciones dirigidas) y te da una puntuación del 1 al 100. Si el score es muy bajo, la IA oculta la alerta para ahorrarte tiempo.

4. **Investigación Profunda (Deep Reports)**
   * Scripts integrados (`buscar-operatividad-capufe-2026.ts`) capaces de cruzar la información de la licitación con fuentes web externas (DuckDuckGo OSINT) para identificar directivos, presupuestos y normativas ocultas.

5. **Notificaciones Premium en Telegram**
   * Las alertas llegan perfectamente formateadas a tu celular, destacando únicamente lo que importa: Título, Estatus, Monto Estimado, Enlace directo al expediente y el Score de la IA.

---

## ⚙️ ¿Cómo funciona? (Arquitectura)

El sistema opera bajo una arquitectura *Cloud-Native* y *Stateless* (sin estado local) alojada en **Railway**, respaldada por **Supabase (PostgreSQL)** para la memoria a largo plazo.

```text
[Cron Job: Cada 30 min]
       │
       ▼
1. [Playwright Scraper]  --> Navega ComprasMX, extrae nuevos expedientes.
       │
2. [Filtros de Perfil]   --> Elimina basura, estados bloqueados y fechas viejas.
       │
3. [Motor de Matches]    --> Compara el texto contra +10 "Radares" activos.
       │
4. [AI Document Reader]  --> Si hay Match, descarga PDFs y extrae Insights.
       │
5. [Telegram Bot]        --> Formatea el mensaje y envía la notificación VIP.
```

---

## 📱 Interacción (Comandos de Telegram)

El bot es bidireccional. Además de enviarte alertas pasivas, puedes darle órdenes directamente desde la app de Telegram:

* 📡 `/scan` — **Fuerza un escaneo manual** en ese preciso instante sin esperar al ciclo de 30 minutos.
* 🔍 `/buscar <palabra>` — **Busca licitaciones históricas** en la base de datos (ordenadas por la fecha de publicación más reciente). Ejemplo: `/buscar ambulancias`.
* 📊 `/radares` — Muestra el estado y la configuración de todos los radares de palabras clave activos.
* 📈 `/resumen` — Fuerza el envío del **Resumen Ejecutivo** del día (cuántas licitaciones se procesaron, cuántos matches hubo).
* 🩺 `/status` — Comprueba la salud del servidor de Railway y la conexión a la base de datos.

---

## 🏗 Setup y Despliegue

### 1. Variables de Entorno (`.env`)
El proyecto requiere las siguientes claves para funcionar:
```env
# Base de Datos
SUPABASE_URL="https://tu-proyecto.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJh..."

# Notificaciones
TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
TELEGRAM_CHAT_ID="-100123456789"

# Inteligencia Artificial
OPENAI_API_KEY="sk-proj-..."

# Playwright
PLAYWRIGHT_HEADLESS="true"
```

### 2. Desarrollo Local
Para probar o modificar el sistema en tu computadora:

```bash
# 1. Instalar dependencias
npm install

# 2. Instalar binarios de Chromium para Playwright
npx playwright install chromium

# 3. Levantar el Worker en modo desarrollo (hot-reload)
npm run dev
```

### 3. Scripts de Investigación Manual
Si deseas ejecutar los módulos de OSINT profundo de manera manual (por ejemplo, investigación de CAPUFE):
```bash
npx ts-node apps/worker/src/scripts/buscar-operatividad-capufe-2026.ts
```

### 4. Despliegue en Producción (Railway)
1. Conecta este repositorio a Railway.
2. Railway auto-detectará el archivo `railway.toml`.
3. Ingresa las variables de entorno en el panel de Railway.
4. El sistema compilará la imagen de Docker, instalará Chromium y arrancará el Worker de manera permanente.

---

## 🛡️ Estabilidad y Resiliencia
* **Anti-Memory Leaks**: Cada recolección lanza un proceso Chromium limpio y lo destruye al terminar, garantizando meses de operación continua sin caídas de servidor.
* **Circuit Breakers y Retries**: Si Telegram restringe el bot por muchos mensajes (HTTP 429), o si ComprasMX se cae, el sistema pausa y reintenta de forma inteligente.
* **Manejo de PDFs Gigantes**: Los anexos se truncan y tienen *timeouts* duros para asegurar que un documento defectuoso de 1GB no congele el sistema.

> *Desarrollado para la caza estratégica de oportunidades gubernamentales.*
