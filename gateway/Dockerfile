FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs activity.mjs security.mjs workspace.mjs dashboard.mjs operator-proxy.mjs wall-auth.mjs enrollment-page.mjs device-policy-page.mjs ./
USER node
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
