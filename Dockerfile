FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
# Base SQLite persistente: monta un volumen en /data desde EasyPanel (Almacenamiento → Volumen → /data)
RUN mkdir -p /data
ENV DB_PATH=/data/demos.sqlite
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "src/index.ts"]
