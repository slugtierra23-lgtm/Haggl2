FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev && npm ci --legacy-peer-deps

COPY . .
RUN rm -f tsconfig.tsbuildinfo src/tsconfig.tsbuildinfo
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS production

# openssl: required by Prisma. python3 + py3-pip: HagglGuard's Semgrep
# pass shells out to the `semgrep` CLI for deterministic static analysis.
# git: semgrep --config=auto needs git for the working-dir scan.
RUN apk add --no-cache openssl python3 py3-pip git \
    && pip3 install --no-cache-dir --break-system-packages semgrep==1.92.0

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
# Custom Semgrep rules (yaml) — referenced by SemgrepRunner via
# HAGGLGUARD_RULES_DIR (defaults to /app/hagglguard-rules).
COPY --from=builder --chown=nestjs:nodejs /app/src/modules/hagglguard/rules ./hagglguard-rules

RUN mkdir -p /app/uploads/avatars && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3001

CMD ["sh", "-c", "export DIRECT_URL=\"${DIRECT_URL:-$DATABASE_URL}\" && npx prisma migrate deploy && node dist/main"]
