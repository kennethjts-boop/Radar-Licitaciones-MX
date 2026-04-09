# ─────────────────────────────────────────────────────────────────────────────
# Radar Licitaciones MX — Docker image para Railway
#
# Build en 2 etapas:
# 1. builder: Compila TypeScript a JavaScript nativamente dentro del contenedor
# 2. runner: Imagen limpia solo con JS y dependencias de producción + Playwright
# ─────────────────────────────────────────────────────────────────────────────

# ── Etapa 1: Builder ────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# 1. Copiar manifiestos (el contexto de Railway es la raíz del repo)
# Asumimos que context es root por railway.toml
COPY apps/worker/package*.json ./

# 2. Instalar dependencias (incluyendo devDependencies para compilar)
RUN npm ci

# 3. Copiar código fuente real
COPY apps/worker/tsconfig.json ./
COPY apps/worker/src ./src

# 4. Compilar TypeScript (generará /build/dist dentro del builder)
RUN npm run build

# ── Etapa 2: Runner ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runner

# Variables de entorno imperativas 
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

WORKDIR /app

# 1. Copiar manifiestos nuevamente
COPY apps/worker/package*.json ./

# 2. Instalar exclusivamente dependencias de producción
RUN npm ci --only=production

# 3. Traer el compilado desde la etapa "builder" (¡Ya no requiere apps/worker/dist pre-existente!)
COPY --from=builder /build/dist ./dist

# Default CMD 
CMD ["node", "dist/index.js"]
