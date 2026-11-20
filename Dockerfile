# Backend de BLOKIO (Express + Firestore) para Cloud Run / Docker.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Instala solo dependencias de producción usando el lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run inyecta PORT (por defecto 8080).
ENV PORT=8080
EXPOSE 8080

# Firebase Admin usa las credenciales por defecto del entorno:
# en Cloud Run, la cuenta de servicio del servicio.
CMD ["npm", "start"]
