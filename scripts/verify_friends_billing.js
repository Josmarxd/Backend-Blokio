// Prueba del flujo real de amigos y de las validaciones de facturación.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../config/firestore');
const userService = require('../services/user.service');
const billingService = require('../services/billing.service');

const users = db.collection('users');
const friendRequests = db.collection('friend_requests');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  console.log(`  ok  ${message}`);
}

(async () => {
  const stamp = Date.now();
  const uidA = `testFrA_${stamp}`;
  const uidB = `testFrB_${stamp}`;
  const codeA = `BLK-TA${String(stamp).slice(-2)}`;
  const codeB = `BLK-TB${String(stamp).slice(-2)}`;

  try {
    console.log('1. Perfiles reales');
    await users.doc(uidA).set({
      uid: uidA,
      profile: { username: `TestFrA${stamp}`, friendCode: codeA, avatarIndex: 1 },
      updatedAt: new Date(),
    });
    await users.doc(uidB).set({
      uid: uidB,
      profile: { username: `TestFrB${stamp}`, friendCode: codeB, avatarIndex: 2 },
      updatedAt: new Date(),
    });

    const requests = await userService.getFriendRequests(uidB);
    assert(requests.incoming.length === 0, 'sin solicitudes al principio');

    console.log('2. Envío y recepción de solicitud');
    const created = await userService.sendFriendRequest(uidA, { query: codeB });
    assert(!!created.id, 'solicitud creada');

    const incoming = await userService.getFriendRequests(uidB);
    assert(incoming.incoming.length === 1, 'el destinatario ve 1 solicitud');
    assert(
      incoming.incoming[0].senderUsername.startsWith('TestFrA'),
      'la solicitud trae el nombre real del remitente',
    );
    const outgoing = await userService.getFriendRequests(uidA);
    assert(outgoing.outgoing.length === 1, 'el remitente ve su solicitud enviada');

    console.log('3. No se puede duplicar ni pedirte a ti mismo');
    let selfRejected = false;
    try {
      await userService.sendFriendRequest(uidA, { query: codeA });
    } catch (error) {
      selfRejected = error.code === 'CANNOT_ADD_SELF';
    }
    assert(selfRejected, 'no puedes añadirte a ti mismo');

    let notFound = false;
    try {
      await userService.sendFriendRequest(uidA, { query: 'BLK-ZZZZ' });
    } catch (error) {
      notFound = error.code === 'USER_NOT_FOUND';
    }
    assert(notFound, 'código inexistente devuelve USER_NOT_FOUND');

    console.log('4. Aceptar solicitud');
    await userService.acceptFriendRequest(uidB, created.id);
    const friendsB = await userService.getFriends(uidB);
    const friendsA = await userService.getFriends(uidA);
    assert(friendsB.length === 1 && friendsA.length === 1, 'ambos son amigos');
    assert(
      friendsB[0].username.startsWith('TestFrA'),
      'el amigo tiene datos reales',
    );
    const pendingB = await userService.getFriendRequests(uidB);
    assert(pendingB.incoming.length === 0, 'la solicitud desaparece al aceptar');

    console.log('5. Ya son amigos: no se puede volver a invitar');
    let alreadyFriends = false;
    try {
      await userService.sendFriendRequest(uidA, { query: codeB });
    } catch (error) {
      alreadyFriends = error.code === 'ALREADY_FRIENDS';
    }
    assert(alreadyFriends, 'el backend rechaza duplicar amistad');

    console.log('6. Rechazar y eliminar');
    await userService.removeFriend(uidB, uidA);
    const afterRemove = await userService.getFriends(uidB);
    assert(afterRemove.length === 0, 'amigo eliminado');

    const invite2 = await userService.sendFriendRequest(uidA, { query: codeB });
    await userService.rejectFriendRequest(uidB, invite2.id);
    const afterReject = await userService.getFriendRequests(uidB);
    assert(afterReject.incoming.length === 0, 'solicitud rechazada y eliminada');

    console.log('7. Código de amigo reservado');
    const reserved = await userService.registerFriendCode(uidA, 'BLK-AAAA');
    assert(reserved.saved === true, 'código libre reservado');
    let taken = false;
    try {
      await userService.registerFriendCode(uidB, 'BLK-AAAA');
    } catch (error) {
      taken = error.code === 'FRIEND_CODE_TAKEN';
    }
    assert(taken, 'no se puede robar un código en uso');

    console.log('8. Validaciones de Google Play Billing');
    let unknownProduct = false;
    try {
      await billingService.verifyGooglePlayPurchase({
        uid: uidA,
        productId: 'hack_free_gems',
        purchaseToken: 'fake',
        packageName: 'com.codejs.blokio_puzzle',
      });
    } catch (error) {
      unknownProduct = error.code === 'UNKNOWN_PRODUCT';
    }
    assert(unknownProduct, 'producto inexistente rechazado');

    let wrongPackage = false;
    try {
      await billingService.verifyGooglePlayPurchase({
        uid: uidA,
        productId: 'gems_100',
        purchaseToken: 'fake',
        packageName: 'com.otra.app',
      });
    } catch (error) {
      wrongPackage = error.code === 'INVALID_PACKAGE';
    }
    assert(wrongPackage, 'paquete distinto rechazado');

    let missingToken = false;
    try {
      await billingService.verifyGooglePlayPurchase({
        uid: uidA,
        productId: 'gems_100',
        purchaseToken: '',
      });
    } catch (error) {
      missingToken = error.code === 'INVALID_PURCHASE';
    }
    assert(missingToken, 'compra sin token rechazada');

    console.log('\n✅ Amigos y facturación validados');
  } finally {
    await users.doc(uidA).delete().catch(() => {});
    await users.doc(uidB).delete().catch(() => {});
    const reqs = await friendRequests
      .where('fromUid', 'in', [uidA, uidB])
      .get()
      .catch(() => null);
    if (reqs) for (const doc of reqs.docs) await doc.ref.delete().catch(() => {});
    const reqs2 = await friendRequests
      .where('toUid', 'in', [uidA, uidB])
      .get()
      .catch(() => null);
    if (reqs2) for (const doc of reqs2.docs) await doc.ref.delete().catch(() => {});
    console.log('🧹 Datos de prueba eliminados');
  }
})().catch((error) => {
  console.error('\n❌ Falló:', error.code ? `[${error.code}] ` : '', error.message);
  process.exitCode = 1;
});
