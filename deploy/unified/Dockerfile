ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild node-pty
COPY plugin-server/package.json plugin-server/package-lock.json ./plugin-server/
RUN cd plugin-server && npm ci --ignore-scripts
COPY . .
RUN node deploy/unified/stage-dev-profile.mjs
ENV HOME=/state/home NODE_ENV=development
CMD ["node","deploy/unified/dev-runtime.mjs"]
