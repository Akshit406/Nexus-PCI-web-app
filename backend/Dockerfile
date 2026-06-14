# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Native build tools required by better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma/schema.prisma ./prisma/

RUN npm ci

# Generate Prisma client for linux-musl (Alpine)
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npx tsc -p tsconfig.json

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# LibreOffice headless needs a writable profile dir; keep it off the app tree.
ENV LIBREOFFICE_PROFILE_DIR=/tmp/lo-profile

# libstdc++ needed at runtime by better-sqlite3 native addon.
# libreoffice + fonts are used to convert filled .docx/.pptx templates to PDF
# (official SAQ/AOC/Diploma generation). This is the main image-size addition.
RUN apk add --no-cache libstdc++ libreoffice ttf-dejavu ttf-liberation fontconfig \
  && fc-cache -f

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY prisma/import-saq-data.ts ./prisma/import-saq-data.ts
COPY scripts ./scripts
COPY src ./src
COPY requisitosvsSAQ.xlsx ./requisitosvsSAQ.xlsx
# Official document templates (SAQ/AOC .docx + diploma .pptx) used by the
# document generation engine.
COPY templates ./templates
COPY package*.json ./

# Persistent data directories (mounted as volumes)
RUN mkdir -p /data /uploads

EXPOSE 4000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
