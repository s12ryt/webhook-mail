FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY docker-accept/package.json ./docker-accept/package.json
COPY worker-send/package.json ./worker-send/package.json
RUN npm install
COPY docker-accept ./docker-accept
RUN npm run build -w docker-accept

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/docker-accept/package.json ./package.json
COPY --from=build /app/docker-accept/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
