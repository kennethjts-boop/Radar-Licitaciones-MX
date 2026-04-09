# Radar Licitaciones MX — Worker
# Imagen base con Playwright incluido
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Variables de entorno para Node
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

# Directorio de trabajo
WORKDIR /app

# Copiar manifests primero (aprovechar cache de layers)
COPY apps/worker/package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar código compilado (asumiendo que se hace build antes del deploy)
COPY apps/worker/dist ./dist

# Puerto de healthcheck (Railway detecta automáticamente)
EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/index.js"]
