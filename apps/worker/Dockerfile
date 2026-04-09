# ─────────────────────────────────────────────────────────────────────────────
# Radar Licitaciones MX — Docker image para Railway
#
# Usa la imagen oficial de Playwright que incluye Chromium preinstalado.
# Fase 1: solo Node.js + dependencias (Playwright inactivo).
# Fase 2: Chromium ya disponible para scraping.
#
# Build en 2 etapas para mantener la imagen final limpia:
#   1. builder — instala devDependencies + compila TypeScript
#   2. runner  — solo dependencias de producción + dist/
# ─────────────────────────────────────────────────────────────────────────────

# ── Etapa 1: Build ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS builder

WORKDIR /build

# Copiar manifests primero (cache de layers)
COPY apps/worker/package*.json ./

# Instalar TODAS las dependencias (incluyendo devDependencies para el build)
RUN npm ci

# Copiar código fuente
COPY apps/worker/tsconfig.json ./
COPY apps/worker/src ./src

# Compilar TypeScript
RUN npm run build

# ── Etapa 2: Runner ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runner

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

WORKDIR /app

# Copiar manifests para instalar solo producción
COPY apps/worker/package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --only=production

# Copiar código compilado desde el builder
COPY --from=builder /build/dist ./dist

# Worker es un proceso long-running, no expone puertos HTTP
# Railway detecta el proceso como "healthy" mientras esté corriendo

CMD ["node", "dist/index.js"]
