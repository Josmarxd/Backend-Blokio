// Prueba de la lógica autoritativa de BLOKIO RUSH contra Firestore real.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../config/firestore');
const rushService = require('../services/rush.service');

const users = db.collection('users');
const rooms = db.collection('rush_rooms');
const queue = db.collection('rush_matchmaking');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  console.log(`  ok  ${message}`);
}

(async () => {
  const stamp = Date.now();
  const uidA = `testRushA_${stamp}`;
  const uidB = `testRushB_${stamp}`;
  const created = { rooms: [], uids: [uidA, uidB] };

  try {
    console.log('1. Emparejamiento mundial');
    const joinA = await rushService.joinMatchmaking({
      uid: uidA,
      username: 'TestA',
      avatarIndex: 1,
    });
    assert(joinA.inQueue === true, 'A queda en la cola');

    const joinB = await rushService.joinMatchmaking({
      uid: uidB,
      username: 'TestB',
      avatarIndex: 2,
    });
    assert(joinB.matched === true, 'B encuentra rival');
    const roomId = joinB.roomId;
    created.rooms.push(roomId);
    assert(!!roomId, `sala creada (${roomId})`);

    // A vuelve a sondear: debe entrar en la MISMA sala en la que B lo emparejó.
    const joinAAgain = await rushService.joinMatchmaking({
      uid: uidA,
      username: 'TestA',
      avatarIndex: 1,
    });
    assert(joinAAgain.matched === true, 'A entra al sondear de nuevo');
    assert(joinAAgain.roomId === roomId, 'ambos jugadores comparten sala');

    console.log('2. Turnos y validación de movimientos');
    let stateA = await rushService.getRoomState(roomId, uidA);
    let stateB = await rushService.getRoomState(roomId, uidB);
    assert(stateA.board.length === 8 && stateA.board[0].length === 8, 'tablero 8×8');
    assert(
      stateA.currentTurnUid === stateB.currentTurnUid,
      'ambos ven el mismo turno',
    );
    assert(stateA.myUid === uidA, 'el estado es personalizado por jugador');

    const firstUid = stateA.currentTurnUid;
    const firstIsA = firstUid === uidA;
    const firstState = firstIsA ? stateA : stateB;
    const secondState = firstIsA ? stateB : stateA;
    assert(firstState.isMyTurn === true, 'el primero ve su turno');
    assert(secondState.isMyTurn === false, 'el rival ve el turno ajeno');

    let offTurnRejected = false;
    try {
      const offUid = firstUid === uidA ? uidB : uidA;
      await rushService.makeMove(roomId, offUid, { row: 0, col: 0, slot: 0 });
    } catch (error) {
      offTurnRejected = error.code === 'NOT_YOUR_TURN';
    }
    assert(offTurnRejected, 'movimiento fuera de turno rechazado');

    console.log('3. Colocación de pieza y puntos');
    const piece = firstState.me.pieces[0];
    const move = await rushService.makeMove(roomId, firstUid, {
      row: 0,
      col: 0,
      slot: piece.slot,
    });
    assert(move.currentTurnUid !== firstUid, 'el turno cambia');
    assert(
      move.board[0][0] === piece.shapeId + 1,
      'la pieza queda escrita en el tablero compartido',
    );

    // El rival debe ver la misma pieza.
    const rivalView = await rushService.getRoomState(roomId, secondState.myUid);
    assert(rivalView.board[0][0] === piece.shapeId + 1, 'el rival ve la misma pieza');

    let rejectedSlot = false;
    try {
      await rushService.makeMove(roomId, firstUid, {
        row: 1,
        col: 1,
        slot: piece.slot,
      });
    } catch (error) {
      rejectedSlot = ['NOT_YOUR_TURN', 'PIECE_NOT_AVAILABLE'].includes(
        error.code,
      );
    }
    assert(rejectedSlot, 'no se acepta una acción inválida');

    console.log('4. Bomba');
    const bomb = await rushService.useBomb(roomId, secondState.myUid, {
      row: 0,
      col: 0,
    });
    assert(bomb.board[0][0] === 0, 'la bomba limpia la zona');
    assert(bomb.me.bombsRemaining === 1, 'se registra la bomba usada');

    console.log('5. Mensajes rápidos');
    await rushService.sendQuickMessage(roomId, firstUid, '¡Buena suerte!');
    const withMessage = await rushService.getRoomState(roomId, secondState.myUid);
    assert(
      withMessage.lastMessage.text === '¡Buena suerte!',
      'el mensaje llega al rival',
    );

    console.log('6. Fin por tiempo y ranking (+3 / +2)');
    const roomRef = rooms.doc(roomId);
    // Guardar una ventaja para que el resultado sea determinista.
    const roomSnap = await roomRef.get();
    const room = roomSnap.data();
    room.players[firstUid].score = 7;
    room.players[secondState.myUid].score = 3;
    room.gameExpiresAt = new Date(Date.now() - 1000);
    await roomRef.set(room);

    const finishedForA = await rushService.getRoomState(roomId, uidA);
    assert(finishedForA.status === 'finished', 'la partida termina al agotarse el tiempo');
    const winnerUid = finishedForA.result.winnerUid;
    assert(winnerUid === firstUid, 'gana quien tenía más puntos');
    assert(
      finishedForA.result.myScore === 7 &&
        finishedForA.result.opponentScore === 3,
      'las puntuaciones finales son las del servidor',
    );

    const winnerStats = await rushService.getMyStats(winnerUid);
    const loserStats = await rushService.getMyStats(secondState.myUid);
    assert(winnerStats.rushPoints === 2, 'el ganador obtiene +2');
    assert(loserStats.rushPoints === 0, 'el perdedor no baja de 0 copas');

    // Una segunda lectura no debe volver a sumar puntos.
    await rushService.getRoomState(roomId, uidA);
    const winnerStatsAgain = await rushService.getMyStats(winnerUid);
    assert(
      winnerStatsAgain.rushPoints === 2,
      'el ranking no se contabiliza dos veces',
    );

    console.log('7. Partida privada: no afecta al ranking');
    const invite = await rushService.sendFriendInvite({
      fromUid: uidA,
      fromUsername: 'TestA',
      fromAvatarIndex: 1,
      toUid: uidB,
    });
    const pending = await rushService.getPendingInvites(uidB);
    assert(
      pending.some((i) => i.id === invite.inviteId),
      'la invitación llega al amigo',
    );

    const accepted = await rushService.respondInvite(
      invite.inviteId,
      uidB,
      true,
      'TestB',
      2,
    );
    assert(accepted.accepted === true, 'la invitación se acepta');
    created.rooms.push(accepted.roomId);
    assert(accepted.state.isPrivate === true, 'es una sala privada');

    const privateRoomRef = rooms.doc(accepted.roomId);
    const privateRoom = (await privateRoomRef.get()).data();
    privateRoom.gameExpiresAt = new Date(Date.now() - 1000);
    privateRoom.players[uidA].score = 1;
    privateRoom.players[uidB].score = 0;
    await privateRoomRef.set(privateRoom);

    await rushService.getRoomState(accepted.roomId, uidA);
    const afterPrivate = await rushService.getMyStats(uidA);
    assert(
      afterPrivate.rushPoints === 2,
      'la partida privada NO modifica el ranking mundial',
    );

    console.log('8. Rechazo de invitación');
    const invite2 = await rushService.sendFriendInvite({
      fromUid: uidA,
      fromUsername: 'TestA',
      fromAvatarIndex: 1,
      toUid: uidB,
    });
    const rejected = await rushService.respondInvite(
      invite2.inviteId,
      uidB,
      false,
    );
    assert(rejected.accepted === false, 'la invitación se rechaza');
    const pendingAfter = await rushService.getPendingInvites(uidB);
    assert(
      !pendingAfter.some((i) => i.id === invite2.inviteId),
      'la invitación rechazada desaparece',
    );

    console.log('\n✅ Lógica de RUSH validada');
  } finally {
    // Limpieza de los datos de prueba.
    for (const roomId of created.rooms) {
      await rooms.doc(roomId).delete().catch(() => {});
    }
    for (const uid of created.uids) {
      await users.doc(uid).delete().catch(() => {});
      await queue.doc(uid).delete().catch(() => {});
    }
    const invites = await db
      .collection('rush_invitations')
      .where('fromUid', 'in', created.uids)
      .get()
      .catch(() => null);
    if (invites) {
      for (const doc of invites.docs) await doc.ref.delete().catch(() => {});
    }
    const purchases = await db
      .collection('billing_purchases')
      .where('uid', 'in', created.uids)
      .get()
      .catch(() => null);
    if (purchases) {
      for (const doc of purchases.docs) await doc.ref.delete().catch(() => {});
    }
    console.log('🧹 Datos de prueba eliminados');
  }
})().catch((error) => {
  console.error('\n❌ Falló:', error.code ? `[${error.code}] ` : '', error.message);
  process.exitCode = 1;
});
