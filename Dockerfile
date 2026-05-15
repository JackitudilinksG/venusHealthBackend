FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml tsconfig*.json nest-cli.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm run build
RUN node -e "const { AppModule } = require('./dist/app.module'); console.log('Module loads')"

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
