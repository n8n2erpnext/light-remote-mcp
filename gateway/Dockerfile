FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app/gateway
COPY gateway/package*.json ./
RUN npm ci --omit=dev
COPY gateway/*.mjs ./
COPY gateway/brand-mark.svg ./
COPY lib/runtime-version.mjs /app/lib/runtime-version.mjs
COPY VERSION /app/VERSION
USER node
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
