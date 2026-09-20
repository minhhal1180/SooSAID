# Ảnh production cho backend S.O.S Aid.
#
# Build từ THƯ MỤC GỐC của repo, KHÔNG phải từ apps/api:
#
#   docker build -f apps/api/Dockerfile -t sos-aid-api .
#
# Lý do: đây là npm workspaces — `package-lock.json` và `node_modules` nằm ở gốc
# repo chứ không nằm trong apps/api. Image cũng cần `packages/api-contract`
# (nguồn sự thật của contract) và `db/migrations` (chạy migration lúc deploy).

# ---------------------------------------------------------------------------
# Giai đoạn build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifest trước mã nguồn để Docker cache được lớp cài dependency — sửa
# code không làm cài lại toàn bộ.
#
# Phải copy package.json của MỌI workspace: npm cần chúng để dựng cây phụ thuộc,
# thiếu một cái thì `npm ci` báo lockfile không khớp.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/operator-web/package.json ./apps/operator-web/

RUN npm ci --no-audit --no-fund

COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY db/ ./db/
COPY apps/api/ ./apps/api/

# Sinh lại contract từ nguồn duy nhất, để image không bao giờ chứa bản copy cũ.
RUN node scripts/sync-contract.mjs

RUN npm run build --workspace apps/api

# Cài lại chỉ dependency runtime của riêng backend.
#
# `--workspace @sos-aid/api --include-workspace-root` loại cả devDependency lẫn
# toàn bộ phụ thuộc của operator-web (Next.js, React): 697 gói xuống còn 189.
RUN rm -rf node_modules \
    && npm ci --omit=dev --no-audit --no-fund \
       --workspace @sos-aid/api --include-workspace-root

# ---------------------------------------------------------------------------
# Giai đoạn runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# dumb-init: Node chạy ở PID 1 không xử lý SIGTERM đúng cách, khiến container
# không tắt gọn khi deploy lại và connection tới PostgreSQL bị treo.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json

# Migration và script đi kèm image, để chạy được trên PaaS không có shell riêng:
#   node scripts/migrate.mjs
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts

USER node

EXPOSE 3000

# Health check gọi chính endpoint của ứng dụng: nó phản ánh cả tình trạng
# database, không chỉ việc process còn sống.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
