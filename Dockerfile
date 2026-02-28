FROM node:22-alpine
RUN apk add --no-cache git docker-cli
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install -g @anthropic-ai/claude-code
COPY . .
RUN mkdir -p data && chown -R node:node /app
RUN addgroup -g 984 docker 2>/dev/null; addgroup node docker 2>/dev/null || true
USER node
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
