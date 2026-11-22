const { WebSocketServer } = require('ws');
const { auth, db } = require('./config/firestore');

/// Conexiones autenticadas por UID. Cada UID puede tener varios dispositivos.
const socketsByUid = new Map();
/// roomId -> [uid1, uid2] (cache para el relay de arrastre).
const roomPlayers = new Map();
let roomSerializer = null;

function setRoomSerializer(serializer) {
  roomSerializer = serializer;
}

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (_) {
    // El socket se limpia en el evento 'close'.
  }
}

async function playersOf(roomId) {
  const cached = roomPlayers.get(roomId);
  if (cached) return cached;
  try {
    const snap = await db.collection('rush_rooms').doc(roomId).get();
    if (!snap.exists) return null;
    const uids = Object.keys(snap.data().players || {});
    roomPlayers.set(roomId, uids);
    return uids;
  } catch (_) {
    return null;
  }
}

async function relayDrag(uid, msg, lastDragAt) {
  if (!msg.roomId || typeof msg.roomId !== 'string') return;

  // Máx. ~60 mensajes/s por socket.
  const now = Date.now();
  if (now - lastDragAt.value < 16 && msg.clear !== true) return;
  lastDragAt.value = now;

  const uids = await playersOf(msg.roomId);
  if (!uids || !uids.includes(uid)) return;
  const other = uids.find((u) => u !== uid);
  if (!other) return;

  const targets = socketsByUid.get(other);
  if (!targets) return;

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const payload = JSON.stringify({
    type: 'drag',
    uid,
    clear: msg.clear === true,
    slot: num(msg.slot),
    row: num(msg.row),
    col: num(msg.col),
    x: num(msg.x),
    y: num(msg.y),
  });
  for (const ws of targets) {
    if (ws.readyState !== ws.OPEN) continue;
    try {
      ws.send(payload);
    } catch (_) {}
  }
}

function attachRealtime(server) {
  // Node cierra las conexiones HTTP inactivas a los 5 s por defecto. Con el
  // WebSocket activo la app ya no consulta cada 250 ms, así que la conexión
  // queda callada, el servidor la cierra y el siguiente /move falla con
  // "Connection closed before full header was received".
  // headersTimeout debe ser mayor que keepAliveTimeout.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false, // menos latencia en mensajes pequeños
  });

  wss.on('connection', async (ws, request) => {
    let token = '';
    try {
      const url = new URL(request.url, 'http://localhost');
      token = url.searchParams.get('token') || '';
    } catch (_) {}

    let uid = null;
    try {
      const decoded = await auth.verifyIdToken(token);
      uid = decoded.uid;
    } catch (_) {
      send(ws, { type: 'error', message: 'Token inválido.' });
      ws.close(4001, 'UNAUTHENTICATED');
      return;
    }

    let set = socketsByUid.get(uid);
    if (!set) {
      set = new Set();
      socketsByUid.set(uid, set);
    }
    set.add(ws);
    send(ws, { type: 'ready', uid });
    console.log(`[RUSH WS] conectado uid=${uid}`);

    const lastDragAt = { value: 0 };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (msg && msg.type === 'drag') {
        relayDrag(uid, msg, lastDragAt).catch(() => {});
      }
    });

    const cleanup = () => {
      set.delete(ws);
      if (set.size === 0) socketsByUid.delete(uid);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return wss;
}

/// Envía el estado completo de una sala a TODOS sus jugadores conectados.
function broadcastRoom(room) {
  if (!roomSerializer) return;
  const uids = Object.keys(room.players || {});
  roomPlayers.set(room.roomId, uids);
  if (room.status === 'finished') {
    // Libera memoria un poco después de terminar.
    setTimeout(() => roomPlayers.delete(room.roomId), 60000);
  }
  const now = new Date();
  for (const uid of uids) {
    const targets = socketsByUid.get(uid);
    if (!targets || targets.size === 0) continue;
    const state = roomSerializer(room, uid, now);
    const payload = JSON.stringify({ type: 'room_state', state });
    for (const ws of targets) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        ws.send(payload);
      } catch (_) {}
    }
  }
}

module.exports = { attachRealtime, setRoomSerializer, broadcastRoom };