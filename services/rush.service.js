const { db } = require('../config/firestore');
const ApiError = require('../utils/api-error');
const { setRoomSerializer, broadcastRoom } = require('../realtime');

const rushRooms = db.collection('rush_rooms');
const rushQueue = db.collection('rush_matchmaking');
const rushInvites = db.collection('rush_invitations');
const users = db.collection('users');

const BOARD_SIZE = 8;
const TURN_MS = 7000;
const TURN_GRACE_MS = 750;
const GAME_MS = 120000;
const QUEUE_TTL_MS = 120000;
const INVITE_TTL_MS = 30000;
const ABANDON_MS = 30000;
// Margen para la presentación "VS" de ambos jugadores antes del primer turno.
// Cubre la animación de la app (3 s) más el sondeo del emparejamiento.
// Así nadie pierde su turno mientras ve la presentación.
const INTRO_MS = 7000;

// Debe coincidir con el orden de BlockShape.all en Flutter (lib/core/models/block_shape.dart).
const SHAPES = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
];

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function randomPieceId() {
  return Math.floor(Math.random() * SHAPES.length);
}

function newHand() {
  return [randomPieceId(), randomPieceId(), randomPieceId()];
}

function roomIdFor(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

function newPlayer({ uid, username, avatarIndex, copas, rushPoints }) {
  const now = new Date();
  const validCopas = Number.isInteger(copas)
    ? copas
    : Number.isInteger(rushPoints)
      ? rushPoints
      : 0;
  return {
    uid,
    username: username || 'Jugador',
    avatarIndex: Number.isInteger(avatarIndex) ? avatarIndex : 0,
    copas: validCopas,
    score: 0,
    bombsRemaining: 2,
    linesCleared: 0,
    combo: 0,
    hand: newHand(),
    handUsed: [false, false, false],
    lastSeenAt: now,
    joinedAt: null,
    readyAt: null,
    left: false,
  };
}

function buildRoom({ player1, player2, isPrivate, roomId }) {
  const now = new Date();
  // La sala arranca en 'waiting': no empieza hasta que AMBOS jugadores se
  // hayan conectado. Así nadie tiene desventaja de tiempo si uno entra antes.
  const p1 = newPlayer(player1);
  const p2 = newPlayer(player2);
  return {
    roomId,
    isPrivate: !!isPrivate,
    createdAt: now,
    startsAt: null,
    players: {
      [player1.uid]: p1,
      [player2.uid]: p2,
    },
    board: emptyBoard(),
    currentTurnUid: player1.uid,
    firstTurnUid: player1.uid,
    turnNumber: 1,
    turnStartedAt: null,
    turnExpiresAt: null,
    gameStartedAt: null,
    gameExpiresAt: null,
    status: 'waiting',
    boardVersion: 1,
    dragPreview: null,
    lastMessage: null,
    result: null,
    rankingAwarded: false,
    lastBomb: null,
  };
}

/**
 * Cierra la sala aplicando la regla de empate de BLOKIO RUSH:
 * si nadie ha puntuado (0-0) el resultado es EMPATE, aunque el rival
 * se haya ido o se haya desconectado. Nadie puede ganar sin puntos.
 */
function finishRoom(room, { winnerUid = null, reason, now }) {
  const scores = Object.values(room.players).map(
    (player) => (player && player.score) || 0,
  );
  const nobodyScored = scores.every((score) => score === 0);
  const isTie = nobodyScored || !winnerUid;

  room.status = 'finished';
  room.finishedAt = now;
  room.result = {
    winnerUid: isTie ? null : winnerUid,
    isTie,
    reason,
    finishedAt: now,
  };
  return room.result;
}

/// Arranca la sala SOLO cuando los dos jugadores terminaron su animación
/// inicial. Así nadie pierde turno mientras ve el "READY · 3 · 2 · 1 · GO".
function activateRoomIfReady(room, now) {
  if (room.status !== 'waiting') return false;
  const allReady = Object.keys(room.players).every((id) =>
    !!asDate(room.players[id].readyAt),
  );
  if (!allReady) return false;
  const startsAt = new Date(now.getTime() + 5000);
  room.status = 'active';
  room.startsAt = startsAt;
  room.turnStartedAt = startsAt;
  room.turnExpiresAt = new Date(startsAt.getTime() + TURN_MS);
  room.gameStartedAt = startsAt;
  room.gameExpiresAt = new Date(startsAt.getTime() + GAME_MS);
  return true;
}

function opponentUidOf(room, uid) {
  return Object.keys(room.players).find((key) => key !== uid) || null;
}

function scoringFor(lines, comboAfterIncrement) {
  // 1 línea = 1 punto. Las eliminaciones consecutivas del mismo jugador
  // añaden 1 punto extra por combo.
  return lines + (comboAfterIncrement > 1 ? 1 : 0);
}

function clearFullLines(board) {
  const fullRows = [];
  const fullCols = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (board[r].every((cell) => cell !== 0)) fullRows.push(r);
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    let full = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (board[r][c] === 0) {
        full = false;
        break;
      }
    }
    if (full) fullCols.push(c);
  }
  for (const r of fullRows) {
    for (let c = 0; c < BOARD_SIZE; c++) board[r][c] = 0;
  }
  for (const c of fullCols) {
    for (let r = 0; r < BOARD_SIZE; r++) board[r][c] = 0;
  }
  return fullRows.length + fullCols.length;
}

function canPlace(board, shapeId, row, col) {
  const cells = SHAPES[shapeId];
  if (!cells) return false;
  for (const [dr, dc] of cells) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    if (board[r][c] !== 0) return false;
  }
  return true;
}

function advanceTurn(room, now) {
  const nextUid = opponentUidOf(room, room.currentTurnUid);
  if (!nextUid) return;
  room.currentTurnUid = nextUid;
  room.turnNumber = (room.turnNumber || 1) + 1;
  room.turnStartedAt = now;
  room.turnExpiresAt = new Date(now.getTime() + TURN_MS);
}

function dealHandIfNeeded(player) {
  if (player.handUsed.every(Boolean)) {
    player.hand = newHand();
    player.handUsed = [false, false, false];
  }
}

/** true si al jugador le cabe al menos una de sus piezas en el tablero. */
function hasAnyPlacement(board, player) {
  return player.hand.some((shapeId, slot) => {
    if (player.handUsed[slot]) return false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (canPlace(board, shapeId, r, c)) return true;
      }
    }
    return false;
  });
}

function serializePlayer(board, player, uid) {
  const pieces = [];
  player.hand.forEach((shapeId, slot) => {
    if (!player.handUsed[slot]) pieces.push({ slot, shapeId });
  });
  return {
    uid,
    username: player.username,
    avatarIndex: player.avatarIndex,
    copas: player.copas || 0,
    score: player.score,
    bombsRemaining: player.bombsRemaining,
    linesCleared: player.linesCleared,
    combo: player.combo,
    pieces,
    // Si se queda sin hueco, siempre puede detonar una bomba para seguir.
    canBomb: player.bombsRemaining > 0 || !hasAnyPlacement(board, player),
  };
}

function serializeResult(room, uid) {
  if (!room.result) return null;
  const opponentUid = opponentUidOf(room, uid) || '';
  const me = room.players[uid];
  const opponent = room.players[opponentUid];
  if (!me || !opponent) return null;
  const isWin = room.result.winnerUid === uid;
  const isTie = !!room.result.isTie;
  return {
    ...room.result,
    myScore: me.score,
    opponentScore: opponent.score,
    myUid: uid,
    opponentUid,
    opponentName: opponent.username,
    opponentAvatarIndex: opponent.avatarIndex,
    isWin,
    isTie,
    rankingPoints: isTie ? 0 : isWin ? 2 : -1,
    copasEarned: isTie ? 0 : isWin ? 2 : -1,
  };
}

function buildClientState(room, uid, now) {
  const opponentUid = opponentUidOf(room, uid) || '';
  const gameEndsAt = asDate(room.gameExpiresAt);
  const turnEndsAt = asDate(room.turnExpiresAt);
  const startsAt = asDate(room.startsAt);
  const isWaiting = room.status === 'waiting';
  // Durante la presentación "VS" el reloj aún no corre: mostramos el tiempo
  // completo en vez de descontar el margen de introducción.
  const clockNow =
    startsAt && now.getTime() < startsAt.getTime() ? startsAt : now;
  const totalSeconds = isWaiting
    ? Math.ceil(GAME_MS / 1000)
    : gameEndsAt
      ? Math.max(
          0,
          Math.min(
            Math.ceil(GAME_MS / 1000),
            Math.ceil((gameEndsAt.getTime() - clockNow.getTime()) / 1000),
          ),
        )
      : Math.ceil(GAME_MS / 1000);
  const turnSeconds = isWaiting
    ? Math.ceil(TURN_MS / 1000)
    : turnEndsAt
      ? Math.max(
          0,
          Math.min(
            Math.ceil(TURN_MS / 1000),
            Math.ceil((turnEndsAt.getTime() - clockNow.getTime()) / 1000),
          ),
        )
      : Math.ceil(TURN_MS / 1000);
  return {
    roomId: room.roomId,
    isPrivate: !!room.isPrivate,
    status: room.status,
    board: room.board,
    serverTime: now.toISOString(),
    startsAt: startsAt ? startsAt.toISOString() : now.toISOString(),
    gameEndsAt: (gameEndsAt || now).toISOString(),
    turnEndsAt: (turnEndsAt || now).toISOString(),
    totalSecondsLeft: totalSeconds,
    totalSecondsLeft: totalSeconds,
    turnSecondsLeft: turnSeconds,
    secondsUntilStart: startsAt
      ? Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / 1000))
      : 0,
    currentTurnUid: room.currentTurnUid,
    firstTurnUid: room.firstTurnUid,
    turnNumber: room.turnNumber,
    boardVersion: room.boardVersion || 1,
    dragPreview: room.dragPreview || null,
    isMyTurn: room.status === 'active' && room.currentTurnUid === uid,
    myUid: uid,
    me: serializePlayer(room.board, room.players[uid], uid),
    opponent: serializePlayer(room.board, room.players[opponentUid], opponentUid),
    lastMessage: room.lastMessage || null,
    lastBomb: room.lastBomb || null,
    result: room.status === 'finished' ? serializeResult(room, uid) : null,
  };
}

// El módulo realtime serializa con ESTA MISMA función para que el push por
// WebSocket devuelva exactamente el mismo estado que el endpoint HTTP.
setRoomSerializer(buildClientState);

/**
 * Ejecuta una transacción sobre la sala, resolviendo antes los temporizadores
 * del servidor (tiempo de turno agotado y fin de partida).
 */
async function withRoom(roomId, uid, mutate) {
  let finalState = null;
  let nowRef = new Date();
  let shouldBroadcast = false;
  let roomSnapshot = null;

  await db.runTransaction(async (transaction) => {
    const ref = rushRooms.doc(roomId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new ApiError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
    }

    const room = snapshot.data();
    roomSnapshot = room;
    const now = new Date();
    nowRef = now;
    let dirty = false;

    if (!room.players[uid]) {
      throw new ApiError(403, 'NOT_IN_ROOM', 'No participas en esta partida.');
    }

    // Presencia para detectar desconexiones (se actualiza cada 5 s máximo).
    const me = room.players[uid];
    const lastSeen = asDate(me.lastSeenAt);
    if (!lastSeen || now.getTime() - lastSeen.getTime() > 5000) {
      me.lastSeenAt = now;
      dirty = true;
    }

    // Sala en espera: no empieza hasta que AMBOS jugadores se hayan conectado.
    // Así evitamos que uno empiece con desventaja si el otro entra tarde.
    if (room.status === 'waiting') {
      if (!me.joinedAt) {
        me.joinedAt = now;
        dirty = true;
      }
      if (activateRoomIfReady(room, now)) dirty = true;
    }

    if (room.status === 'active') {
      const gameEndsAt = asDate(room.gameExpiresAt);
      const turnEndsAt = asDate(room.turnExpiresAt);

      // Abandono: si el rival lleva mucho sin conectarse, se le da la partida.
      const opponentUid = opponentUidOf(room, uid);
      const opponent = opponentUid ? room.players[opponentUid] : null;
      const opponentSeen = opponent ? asDate(opponent.lastSeenAt) : null;
      const startedAgo = now.getTime() - asDate(room.gameStartedAt).getTime();
      const abandoned =
        opponent &&
        !opponent.left &&
        opponentSeen &&
        now.getTime() - opponentSeen.getTime() > ABANDON_MS &&
        startedAgo > 10000;

      if (opponent && (opponent.left || abandoned)) {
        finishRoom(room, {
          winnerUid: uid,
          reason: opponent.left ? 'opponent_left' : 'opponent_disconnected',
          now,
        });
        dirty = true;
      } else if (now >= gameEndsAt) {
        const a = room.players[uid];
        const b = opponentUid ? room.players[opponentUid] : null;
        const scoreA = a ? a.score : 0;
        const scoreB = b ? b.score : 0;
        finishRoom(room, {
          winnerUid:
            scoreA === scoreB ? null : scoreA > scoreB ? uid : opponentUid,
          reason: 'time_up',
          now,
        });
        dirty = true;
      } else if (
        !turnEndsAt ||
        now.getTime() >= turnEndsAt.getTime() + TURN_GRACE_MS
      ) {
        // Tolera la latencia de red al enviar una jugada al final del turno.
        advanceTurn(room, now);
        dirty = true;
      }
    }

    if (mutate && room.status !== 'finished') {
      const changed = mutate(room, now);
      if (changed !== false) dirty = true;
    }

    // ── Ranking competitivo (solo partidas mundiales y una única vez) ──
    // Firestore exige leer todo antes de escribir, así que resolvemos las
    // lecturas de usuarios ANTES de guardar la sala.
    const pendingUsers = [];
    const shouldAward =
      room.status === 'finished' && !room.rankingAwarded && !room.isPrivate;
    if (shouldAward) {
      for (const playerUid of Object.keys(room.players)) {
        const userRef = users.doc(playerUid);
        pendingUsers.push({ userRef, doc: await transaction.get(userRef) });
      }
      room.rankingAwarded = true;
      dirty = true;
    }

    if (dirty) {
      transaction.set(ref, room);
      shouldBroadcast = true;
    }

    if (pendingUsers.length > 0) {
      const isTie = !!room.result?.isTie;
      const winnerUid = room.result?.winnerUid || null;
      for (const { userRef, doc } of pendingUsers) {
        const isWinner = winnerUid && winnerUid === userRef.id;
        const isLoser = !isTie && !isWinner;
        // Sistema de copas: +2 por victoria, -1 por derrota, 0 por empate
        const points = isWinner ? 2 : (isLoser ? -1 : 0);
        const current = doc.exists ? doc.data() : {};
        const comp = current.competitive || {
          rushPoints: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          games: 0,
        };
        // Las copas no bajan de 0
        comp.rushPoints = Math.max(0, (comp.rushPoints || 0) + points);
        comp.games = (comp.games || 0) + 1;
        if (isTie) comp.ties = (comp.ties || 0) + 1;
        else if (isWinner) comp.wins = (comp.wins || 0) + 1;
        else comp.losses = (comp.losses || 0) + 1;
        transaction.set(userRef, { competitive: comp }, { merge: true });
      }
    }

    finalState = buildClientState(room, uid, now);
  });

  if (shouldBroadcast) broadcastRoom(roomSnapshot);
  return finalState;
}

// ── MATCHMAKING MUNDIAL ──
async function joinMatchmaking({ uid, username, avatarIndex, copas }) {
  let payload = null;
  let createdRoom = null;

  await db.runTransaction(async (transaction) => {
    const mineRef = rushQueue.doc(uid);
    const now = new Date();
    const parsedCopas = Number.isInteger(copas) ? copas : 0;

    // ── 1. LECTURAS ─────────────────────────────────────────────────────
    // Firestore exige que TODAS las lecturas ocurran antes de la primera
    // escritura. Antes se borraba el documento de la cola y luego se leía la
    // sala, lo que lanzaba "Firestore transactions require all reads to be
    // executed before all writes" y dejaba al jugador que esperaba fuera de
    // la partida.
    const mineDoc = await transaction.get(mineRef);
    const queueSnapshot = await transaction.get(
      rushQueue.orderBy('queuedAt', 'asc').limit(25),
    );

    let myQueueData = null;
    let matchedRoom = null;
    if (mineDoc.exists) {
      myQueueData = mineDoc.data();
      if (myQueueData.matched === true && myQueueData.roomId) {
        const roomSnap = await transaction.get(
          rushRooms.doc(myQueueData.roomId),
        );
        matchedRoom = roomSnap.exists ? roomSnap.data() : null;
      }
    }

    // ── 2. Si otro jugador ya me emparejó y la sala sigue viva, entro ───
    if (
      myQueueData &&
      myQueueData.matched === true &&
      myQueueData.roomId &&
      matchedRoom &&
      (matchedRoom.status === 'active' || matchedRoom.status === 'waiting') &&
      matchedRoom.players &&
      matchedRoom.players[uid]
    ) {
      transaction.delete(mineRef);
      payload = {
        matched: true,
        roomId: myQueueData.roomId,
        isFirstTurn: matchedRoom.firstTurnUid === uid,
        opponent: myQueueData.opponent,
        state: buildClientState(matchedRoom, uid, now),
      };
      return;
    }

    // ── 3. Limpieza de la cola (docs caducados o ya consumidos) ─────────
    const stale = queueSnapshot.docs.filter((doc) => {
      const data = doc.data();
      const queuedAt = asDate(data.queuedAt);
      const matchedAt = asDate(data.matchedAt);
      if (data.matched === true) {
        return !matchedAt || now.getTime() - matchedAt.getTime() > 30000;
      }
      return !queuedAt || now.getTime() - queuedAt.getTime() > QUEUE_TTL_MS;
    });

    const candidates = queueSnapshot.docs.filter((doc) => {
      if (doc.id === uid) return false;
      const data = doc.data();
      if (data.matched === true) return false;
      const queuedAt = asDate(data.queuedAt);
      return queuedAt && now.getTime() - queuedAt.getTime() <= QUEUE_TTL_MS;
    });

    for (const doc of stale) {
      transaction.delete(doc.ref);
    }

    // ── 4. Rival encontrado: creo la sala y aviso a ambos ───────────────
    if (candidates.length > 0) {
      const opponentDoc = candidates[0];
      const opponent = opponentDoc.data();
      const opponentUid = opponent.uid || opponentDoc.id;

      const roomId = roomIdFor('rush');
      const room = buildRoom({
        roomId,
        isPrivate: false,
        player1: newPlayer(opponent),
        player2: newPlayer({ uid, username, avatarIndex, copas: parsedCopas }),
      });
      transaction.set(rushRooms.doc(roomId), room);
      createdRoom = room;

      // Aviso al rival que ya estaba esperando. Conservo `queuedAt` para que
      // la limpieza pueda encontrar el documento y borrarlo si no lo consume.
      transaction.set(opponentDoc.ref, {
        uid: opponentUid,
        username: opponent.username || 'Jugador',
        avatarIndex: Number.isInteger(opponent.avatarIndex)
          ? opponent.avatarIndex
          : 0,
        copas: opponent.copas || 0,
        queuedAt: asDate(opponent.queuedAt) || now,
        matched: true,
        roomId,
        isFirstTurn: room.firstTurnUid === opponentUid,
        opponent: {
          uid,
          username: username || 'Jugador',
          avatarIndex: Number.isInteger(avatarIndex) ? avatarIndex : 0,
          copas: parsedCopas,
        },
        matchedAt: now,
      });

      // Borrar mi doc de la cola
      transaction.delete(mineRef);

      payload = {
        matched: true,
        roomId,
        isFirstTurn: room.firstTurnUid === uid,
        opponent: {
          uid: opponentUid,
          username: opponent.username || 'Jugador',
          avatarIndex: Number.isInteger(opponent.avatarIndex)
            ? opponent.avatarIndex
            : 0,
          copas: opponent.copas || 0,
        },
        state: buildClientState(room, uid, now),
      };
      return;
    }

    // ── 5. Nadie disponible: espero en la cola ──────────────────────────
    transaction.set(mineRef, {
      uid,
      username: username || 'Jugador',
      avatarIndex: Number.isInteger(avatarIndex) ? avatarIndex : 0,
      copas: parsedCopas,
      queuedAt: now,
      matched: false,
    });
    payload = { matched: false, inQueue: true };
  });

  if (createdRoom) broadcastRoom(createdRoom);
  return payload;
}

async function cancelMatchmaking(uid) {
  await rushQueue.doc(uid).delete();
  return { success: true };
}

// ── PARTIDAS PRIVADAS CON AMIGOS ──
async function sendFriendInvite({ fromUid, fromUsername, fromAvatarIndex, toUid }) {
  if (!toUid) {
    throw new ApiError(400, 'INVALID_TARGET', 'Debes indicar a qué amigo invitas.');
  }
  if (toUid === fromUid) {
    throw new ApiError(400, 'INVALID_TARGET', 'No puedes invitarte a ti mismo.');
  }

  const target = await users.doc(toUid).get();
  if (!target.exists) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Ese jugador ya no existe.');
  }

  const inviteId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date();
  await rushInvites.doc(inviteId).set({
    id: inviteId,
    fromUid,
    fromUsername: fromUsername || 'Jugador',
    fromAvatarIndex: Number.isInteger(fromAvatarIndex) ? fromAvatarIndex : 0,
    toUid,
    status: 'pending',
    roomId: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });

  return {
    inviteId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
  };
}

async function getPendingInvites(uid) {
  const now = new Date();
  const snapshot = await rushInvites.where('toUid', '==', uid).get();

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((invite) => {
      if (invite.status !== 'pending') return false;
      const expiresAt = asDate(invite.expiresAt);
      return expiresAt && expiresAt > now;
    })
    .map((invite) => ({
      ...invite,
      expiresAt: asDate(invite.expiresAt).toISOString(),
      createdAt: asDate(invite.createdAt).toISOString(),
    }));
}

async function getInvite(inviteId, uid) {
  const doc = await rushInvites.doc(inviteId).get();
  if (!doc.exists) {
    throw new ApiError(404, 'INVITE_NOT_FOUND', 'Invitación no encontrada.');
  }
  const invite = doc.data();
  if (invite.fromUid !== uid && invite.toUid !== uid) {
    throw new ApiError(403, 'FORBIDDEN', 'No autorizado.');
  }
  const expiresAt = asDate(invite.expiresAt);
  const expired = expiresAt && expiresAt < new Date();
  if (invite.status === 'pending' && expired) {
    await doc.ref.update({ status: 'expired' });
    invite.status = 'expired';
  }
  return {
    ...invite,
    expired: !!expired,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

async function respondInvite(inviteId, uid, accept, username, avatarIndex) {
  let result = null;
  let createdRoom = null;

  await db.runTransaction(async (transaction) => {
    const inviteRef = rushInvites.doc(inviteId);
    const snapshot = await transaction.get(inviteRef);
    if (!snapshot.exists) {
      throw new ApiError(404, 'INVITE_NOT_FOUND', 'Invitación no encontrada.');
    }

    const invite = snapshot.data();
    if (invite.toUid !== uid) {
      throw new ApiError(403, 'FORBIDDEN', 'No autorizado.');
    }
    if (invite.status === 'accepted') {
      result = { accepted: true, roomId: invite.roomId, alreadyAccepted: true };
      return;
    }
    if (invite.status !== 'pending') {
      throw new ApiError(
        409,
        'INVITE_CLOSED',
        'La invitación ya no está disponible.',
      );
    }
    if (asDate(invite.expiresAt) < new Date()) {
      transaction.update(inviteRef, { status: 'expired' });
      throw new ApiError(409, 'INVITE_EXPIRED', 'La invitación expiró.');
    }

    if (!accept) {
      transaction.update(inviteRef, { status: 'rejected' });
      result = { accepted: false };
      return;
    }

    const roomId = roomIdFor('rush_pvt');
    const room = buildRoom({
      roomId,
      isPrivate: true,
      player1: newPlayer({
        uid: invite.fromUid,
        username: invite.fromUsername,
        avatarIndex: invite.fromAvatarIndex,
      }),
      player2: newPlayer({ uid, username, avatarIndex }),
    });

    transaction.set(rushRooms.doc(roomId), room);
    createdRoom = room;
    transaction.update(inviteRef, { status: 'accepted', roomId });
    result = {
      accepted: true,
      roomId,
      state: buildClientState(room, uid, new Date()),
    };
  });

  if (createdRoom) broadcastRoom(createdRoom);
  return result;
}

// ── ESTADO Y ACCIONES DE LA SALA ──
async function getRoomState(roomId, uid) {
  return withRoom(roomId, uid, null);
}

async function makeMove(roomId, uid, { row, col, slot }) {
  return withRoom(roomId, uid, (room, now) => {
    if (room.status !== 'active') {
      throw new ApiError(409, 'ROOM_FINISHED', 'La partida ya terminó.');
    }
    const startsAt = asDate(room.startsAt);
    if (startsAt && now < startsAt) {
      throw new ApiError(
        409,
        'ROOM_STARTING',
        'La partida está a punto de empezar.',
      );
    }
    if (room.currentTurnUid !== uid) {
      throw new ApiError(409, 'NOT_YOUR_TURN', 'No es tu turno.');
    }

    const player = room.players[uid];
    const slotNumber = Number(slot);
    if (
      !Number.isInteger(slotNumber) ||
      slotNumber < 0 ||
      slotNumber > 2 ||
      player.handUsed[slotNumber]
    ) {
      throw new ApiError(409, 'PIECE_NOT_AVAILABLE', 'Esa pieza ya no está disponible.');
    }

    const shapeId = player.hand[slotNumber];
    const rowNumber = Number(row);
    const colNumber = Number(col);
    if (!canPlace(room.board, shapeId, rowNumber, colNumber)) {
      throw new ApiError(409, 'INVALID_PLACEMENT', 'Esa pieza no cabe ahí.');
    }

    for (const [dr, dc] of SHAPES[shapeId]) {
      room.board[rowNumber + dr][colNumber + dc] = shapeId + 1;
    }

    player.handUsed[slotNumber] = true;
    dealHandIfNeeded(player);

    const lines = clearFullLines(room.board);
    room.boardVersion = (room.boardVersion || 1) + 1;
    room.dragPreview = null;
    if (lines > 0) {
      player.combo = (player.combo || 0) + 1;
      player.score += scoringFor(lines, player.combo);
      player.linesCleared = (player.linesCleared || 0) + lines;
    } else {
      player.combo = 0;
    }

    advanceTurn(room, now);
    return true;
  });
}

async function useBomb(roomId, uid, { row, col }) {
  return withRoom(roomId, uid, (room, now) => {
    if (room.status !== 'active') {
      throw new ApiError(409, 'ROOM_FINISHED', 'La partida ya terminó.');
    }
    const startsAt = asDate(room.startsAt);
    if (startsAt && now < startsAt) {
      throw new ApiError(
        409,
        'ROOM_STARTING',
        'La partida está a punto de empezar.',
      );
    }
    if (room.currentTurnUid !== uid) {
      throw new ApiError(409, 'NOT_YOUR_TURN', 'No es tu turno.');
    }

    const player = room.players[uid];
    const stuck = !hasAnyPlacement(room.board, player);
    if (player.bombsRemaining <= 0 && !stuck) {
      throw new ApiError(409, 'NO_BOMBS', 'No te quedan bombas.');
    }

    if (player.bombsRemaining > 0) {
      player.bombsRemaining -= 1;
    }
    const rowNumber = Math.min(BOARD_SIZE - 1, Math.max(0, Number(row) || 0));
    const colNumber = Math.min(BOARD_SIZE - 1, Math.max(0, Number(col) || 0));

    for (let r = Math.max(0, rowNumber - 1); r <= Math.min(BOARD_SIZE - 1, rowNumber + 1); r++) {
      for (let c = Math.max(0, colNumber - 1); c <= Math.min(BOARD_SIZE - 1, colNumber + 1); c++) {
        room.board[r][c] = 0;
      }
    }

    room.lastBomb = {
      uid,
      row: rowNumber,
      col: colNumber,
      at: new Date(),
    };
    room.boardVersion = (room.boardVersion || 1) + 1;
    room.dragPreview = null;
    return true;
  });
}

async function markReady(roomId, uid) {
  return withRoom(roomId, uid, (room, now) => {
    if (room.status !== 'waiting') return false;
    if (room.players[uid].readyAt) return false;
    room.players[uid].readyAt = now;
    activateRoomIfReady(room, now);
    return true;
  });
}

async function updateDragPreview(roomId, uid, { slot, row, col, clear }) {
  return withRoom(roomId, uid, (room, now) => {
    if (room.status !== 'active' || room.currentTurnUid !== uid) return false;
    if (clear || slot == null) {
      if (!room.dragPreview) return false;
      room.dragPreview = null;
      return true;
    }
    const shapeId = room.players[uid].hand[Number(slot)];
    if (shapeId == null || room.players[uid].handUsed[Number(slot)]) return false;
    room.dragPreview = {
      uid,
      slot: Number(slot),
      row: Math.max(0, Math.min(7, Number(row) || 0)),
      col: Math.max(0, Math.min(7, Number(col) || 0)),
      shapeId,
      at: now,
    };
    return true;
  });
}

async function sendQuickMessage(roomId, uid, text) {
  const clean = String(text || '').trim().slice(0, 80);
  if (!clean) {
    throw new ApiError(400, 'INVALID_MESSAGE', 'El mensaje está vacío.');
  }

  return withRoom(roomId, uid, (room, now) => {
    room.lastMessage = {
      id: `msg_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
      senderUid: uid,
      text: clean,
      sentAt: now.toISOString(),
    };
    return true;
  });
}

async function finishGame(roomId, uid) {
  return withRoom(roomId, uid, (room, now) => {
    if (room.status === 'finished') return false;
    // Solo finaliza por tiempo agotado: el resultado no lo decide el cliente.
    if (now < asDate(room.gameExpiresAt)) return false;
    return true;
  });
}

async function leaveRoom(roomId, uid) {
  try {
    return await withRoom(roomId, uid, (room, now) => {
      if (room.status === 'finished') return false;
      room.players[uid].left = true;
      const opponentUid = opponentUidOf(room, uid);
      if (!opponentUid) return true;
      finishRoom(room, { winnerUid: opponentUid, reason: 'forfeit', now });
      return true;
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function getMyStats(uid) {
  const doc = await users.doc(uid).get();
  const comp = doc.exists ? doc.data().competitive : null;
  const points = comp?.rushPoints || 0;
  return {
    rushPoints: points,
    copas: points,
    wins: comp?.wins || 0,
    losses: comp?.losses || 0,
    ties: comp?.ties || 0,
    games: comp?.games || 0,
  };
}

async function getCompetitiveLeaderboard() {
  const snapshot = await users
    .orderBy('competitive.rushPoints', 'desc')
    .limit(50)
    .get();

  return snapshot.docs
    .filter((doc) => {
      const comp = doc.data().competitive;
      return comp && (comp.games > 0 || (comp.rushPoints || 0) > 0);
    })
    .map((doc, idx) => {
      const d = doc.data();
      const points = d.competitive?.rushPoints || 0;
      return {
        rank: idx + 1,
        uid: d.uid || doc.id,
        username: d.profile?.username || 'Jugador',
        avatarIndex: d.profile?.avatarIndex || 0,
        rushPoints: points,
        copas: points,
        wins: d.competitive?.wins || 0,
        losses: d.competitive?.losses || 0,
        ties: d.competitive?.ties || 0,
        games: d.competitive?.games || 0,
      };
    });
}

module.exports = {
  joinMatchmaking,
  cancelMatchmaking,
  sendFriendInvite,
  getPendingInvites,
  getInvite,
  respondInvite,
  getRoomState,
  makeMove,
  sendQuickMessage,
  useBomb,
  updateDragPreview,
  markReady,
  finishGame,
  leaveRoom,
  getMyStats,
  getCompetitiveLeaderboard,
  SHAPES,
};
