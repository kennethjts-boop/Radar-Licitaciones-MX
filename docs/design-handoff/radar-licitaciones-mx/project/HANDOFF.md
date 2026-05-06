# Handoff · Radar Licitaciones MX → Claude Code

> Paquete completo de diseño para implementar el frontend del scraper de licitaciones.

## 1. Marca

- **Nombre:** Radar Licitaciones MX
- **Tagline:** "Inteligencia de licitaciones en tiempo real."
- **Personalidad:** Cyber/terminal · Bloomberg + Vercel · oscuro premium
- **Logotipo:** símbolo de radar con barrido animado + wordmark `Radar·Licitaciones / MX · Intel Pública`

## 2. Tokens

Todo en `brand/tokens.css`. Usa CSS variables — funciona en cualquier framework.

**Colores clave:**
- Primario: `--violet-600` `#7C3AED`
- Secundario / live: `--cyan-400` `#22D3EE`
- Acento: `--magenta-500` `#D946EF`
- Estado activo: `--status-active` `#10F2A8`
- Cerrando: `--status-closing` `#FFB020`
- Alerta: `--status-alert` `#FF4D6D`
- Fondos oscuros: `--bg-0` `#06070C` → `--bg-3` `#181F3A`

**Tipografía:**
- Display: Space Grotesk (headlines)
- Body: Inter (UI general)
- Mono: JetBrains Mono (datos, IDs, timestamps, microcopy en caps)

## 3. Pantallas entregadas

| # | Archivo | Para qué |
|---|---|---|
| 01 | `brand sheet` (IdentitySheet) | Referencia de marca |
| 02 | `screens/Landing.jsx` | Página pública con hero |
| 03 | `screens/LoginAlertas.jsx` (Login) | Acceso |
| 04 | `screens/Dashboard.jsx` | **Reemplazo directo de la pantalla actual** |
| 05 | `screens/Detalle.jsx` | Detalle de licitación |
| 06 | `screens/Mapa.jsx` | Mapa nacional interactivo |
| 07 | `screens/Terminal.jsx` | Vista de tabla densa |
| 08 | `screens/LoginAlertas.jsx` (Alertas) | Perfil y alertas |

## 4. Implementación recomendada

**Stack sugerido:** Next.js 14 (app router) + Tailwind + shadcn/ui.

1. Copia `brand/tokens.css` a `app/globals.css` y mapea las CSS vars a Tailwind theme.
2. Importa fuentes vía `next/font/google` (Space Grotesk, Inter, JetBrains Mono).
3. Convierte cada screen `.jsx` a componente Next: usar misma estructura DOM/clases, swap `<a>` y `<button>` por `next/link` y handlers reales.
4. Reemplaza `window.RL_DATA` por fetch al endpoint del scraper.
5. Animaciones (radar sweep, pulse, scan): ya están en `tokens.css` como `@keyframes`. Cero deps.

## 5. Tweaks expuestos

- `theme`: dark / light
- `density`: comfy / compact
- `cardStyle`: flat / shadow / glow

## 6. Notas

- Logo SVG está inline en `brand/Logo.jsx` — listo para extraer como componente o `.svg`.
- Todos los íconos son inline lucide-style en `brand/UI.jsx` (objeto `Icon`).
- El mapa de México es decorativo (posiciones aproximadas). Para producción usar `react-simple-maps` con TopoJSON oficial de INEGI.
- Datos mock en `brand/data.js` — sustituir por API real.
