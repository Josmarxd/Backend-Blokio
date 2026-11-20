const { WebSocketServer } = require('ws');
const { auth } = require('./config/firestore');

/// Conexiones autenticadas por UID. Cada UID puede tener varios dispositivos.
const socketsByUid = new Map();
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

function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

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

    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) socketsByUid.delete(uid);
    });
    ws.on('error', () => {
      set.delete(ws);
      if (set.size === 0) socketsByUid.delete(uid);
    });
  });

  return wss;
}

/// Envía el estado completo de una sala a TODOS sus jugadores conectados.
/// Es push puro: no depende de sondeos ni de la latencia de Firestore.
function broadcastRoom(room) {
  if (!roomSerializer) return;
  console.log(`[RUSH WS] broadcast sala=${room.roomId}`);
  const now = new Date();
  for (const uid of Object.keys(room.players || {})) {
    const state = roomSerializer(room, uid, now);
    const payload = JSON.stringify({ type: 'room_state', state });
    const targets = socketsByUid.get(uid);
    if (!targets) continue;
    for (const ws of targets) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        ws.send(payload);
      } catch (_) {}
    }
  }
}

module.exports = { attachRealtime, setRoomSerializer, broadcastRoom };
