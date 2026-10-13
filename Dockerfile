FROM node:22-alpine
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY nexus/api/ ./nexus/api/
COPY nexus/cloud-run/ ./nexus/cloud-run/
COPY nexus/docker/ ./nexus/docker/
COPY nexus/jobs/ ./nexus/jobs/
COPY newsletter/ ./newsletter/
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node","nexus/docker/server.mjs"]
