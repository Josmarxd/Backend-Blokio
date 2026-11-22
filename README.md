# Backend de BLOKIO

API REST con Express, Firebase Authentication y Cloud Firestore.

## Desarrollo local

1. Instala Node.js 22 o posterior.
2. Copia `.env.example` a `.env`.
3. Autentica las credenciales de Google Cloud para desarrollo local:

   ```powershell
   gcloud auth application-default login
   ```

4. Asegúrate de que Firestore está habilitado en el proyecto `code-js-514422`.
5. Desde esta carpeta ejecuta:

   ```powershell
   npm install
   npm test
   npm start
   ```

El servidor escucha en el puerto `3001` de forma predeterminada. En Cloud Run, usa una cuenta de servicio con acceso a Firestore; no subas credenciales de servicio al repositorio.

Para desplegar en producción sigue `../DEPLOY.md` (Cloud Run + `--dart-define=API_BASE_URL=…` en la app).

## API

- `GET /health`: estado del servidor.
- `GET /api/leaderboard?timeframe=allTime|weekly|daily&limit=50`: ranking público.
- `POST /api/leaderboard/submit`: envía `{ "score": 1200, "level": 4, "username": "Blokio" }`; `username` es opcional y debe tener entre 1 y 24 caracteres.
- `GET /api/users/me`: obtiene el perfil autenticado.
- `PUT /api/users/me/sync`: sincroniza `profile`, `progress`, `inventory` y `settings`. Incluye `revision` al actualizar un perfil existente para detectar cambios concurrentes.
- `GET /api/users/friends`: lista de amigos reales.
- `GET /api/users/friends/requests`: solicitudes entrantes y salientes.
- `POST /api/users/friends/request`: envía `{ "query": "BLK-XXXX" }` (código o nombre).
- `PUT /api/users/friends/request/:id/accept` / `DELETE /api/users/friends/request/:id`: aceptar o rechazar.
- `DELETE /api/users/friends/:friendId`: eliminar amigo.
- `POST /api/users/me/friend-code`: reserva el código de amigo `{ "friendCode": "BLK-XXXX" }`.
- `POST /api/users/presence`: latido de presencia (`state`, `activity`).
- `POST /api/billing/google/verify`: valida un `purchaseToken` de Google Play Billing.
- `/api/rush/*`: BLOKIO RUSH (emparejamiento, invitaciones, sala, bombas, mensajes, ranking).

Si la app se cierra durante una partida RUSH, guarda localmente la sala y el UID para reanudarla al volver con la misma cuenta. El servidor permite hasta 120 segundos sin conexión antes de declarar abandono; esta recuperación requiere que el backend siga accesible.

Las rutas privadas requieren `Authorization: Bearer <Firebase ID token>`. El UID se obtiene del token verificado por Firebase Admin, nunca del cuerpo de la petición. El primer envío puede crear el perfil; la app debe leer la revisión vigente antes de sincronizaciones posteriores.

Ejemplo del cuerpo de sincronización inicial (sin `revision`):

```json
{
  "profile": { "username": "Blokio", "avatarIndex": 0 },
  "progress": { "bestScore": 1200, "gamesPlayed": 4 },
  "inventory": { "coins": 25, "powerups": { "bomb": 2 } },
  "settings": {
    "soundEnabled": true,
    "vibrationEnabled": true,
    "musicEnabled": true,
    "languageCode": "es"
  }
}
```

Los perfiles se guardan en `users/{uid}`. Las puntuaciones se guardan bajo `leaderboards/{timeframe}/periods/{periodId}/entries/{uid}`; los periodos diario y semanal usan UTC, y la semana comienza el lunes.

La puntuación recibida todavía procede del cliente; la autenticación protege la identidad y los datos de otros usuarios, pero no vuelve las partidas a prueba de trampas. Para una clasificación competitiva se necesitaría validación adicional del resultado del juego.

## Capas

- `routes/`: montaje de rutas HTTP.
- `controllers/`: recepción de peticiones y formato de respuestas.
- `services/`: reglas de negocio y validación.
- `repository/`: lecturas y escrituras de Firestore.
- `middleware/`: autenticación y errores.
