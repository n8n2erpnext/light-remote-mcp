FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app/gateway
COPY gateway/package*.json ./
RUN npm ci --omit=dev
COPY gateway/*.mjs ./
COPY lib/runtime-version.mjs lib/brand.mjs /app/lib/
COPY assets/branding/light-remote-mark.svg /app/assets/branding/light-remote-mark.svg
COPY VERSION /app/VERSION
USER node
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
