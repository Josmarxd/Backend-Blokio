const { db } = require('../config/firestore');

const users = db.collection('users');
const friendRequests = db.collection('friend_requests');

async function findById(uid) {
  const snapshot = await users.doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function findByFriendCode(friendCode) {
  const snapshot = await users
    .where('profile.friendCode', '==', friendCode.toUpperCase())
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

async function findByUsername(username) {
  const snapshot = await users
    .where('profile.username', '==', username)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
}

async function saveProfile(uid, profileData, expectedRevision) {
  const userRef = users.doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.exists ? snapshot.data() : null;

    if (current && expectedRevision !== current.revision) {
      return { conflict: current };
    }

    const now = new Date();
    const next = {
      ...(current || {}),
      uid,
      ...profileData,
      profile: { ...(current?.profile || {}), ...profileData.profile },
      revision: Number.isSafeInteger(current?.revision)
        ? current.revision + 1
        : 1,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    transaction.set(userRef, next);
    return { profile: next };
  });
}

async function updatePresence(uid, presence) {
  const userRef = users.doc(uid);
  const now = new Date();
  await userRef.set(
    {
      presence: {
        state: presence.state || 'online',
        activity: presence.activity || 'En el menú',
        lastActiveAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  return { uid, presence: { ...presence, lastActiveAt: now } };
}

async function getFriends(uid) {
  const friendsSnapshot = await users.doc(uid).collection('friends').get();
  if (friendsSnapshot.empty) return [];
  const friendUids = friendsSnapshot.docs.map((doc) => doc.id);

  const friendDocs = await Promise.all(
    friendUids.map((fUid) => users.doc(fUid).get()),
  );

  return friendDocs
    .filter((doc) => doc.exists)
    .map((doc) => {
      const data = doc.data();
      const lastActive =
        data.presence?.lastActiveAt?.toDate?.() || data.presence?.lastActiveAt;
      const isOnline =
        lastActive && Date.now() - new Date(lastActive).getTime() < 120000;

      return {
        id: data.uid,
        username: data.profile?.username || 'Jugador',
        friendCode: data.profile?.friendCode || 'BLK-0000',
        avatarIndex: data.profile?.avatarIndex || 0,
        playerLevel: data.inventory?.playerLevel || 1,
        bestScore: data.progress?.bestScore || 0,
        presence: isOnline ? data.presence?.state || 'online' : 'offline',
        customActivity: isOnline ? data.presence?.activity || 'En línea' : null,
        lastSeen: lastActive,
        dailyStreak: data.inventory?.dailyStreak || 0,
      };
    });
}

async function createFriendRequest(fromUid, toUid) {
  const reqRef = friendRequests.doc(`${fromUid}_${toUid}`);
  const now = new Date();
  await reqRef.set({
    fromUid,
    toUid,
    status: 'pending',
    createdAt: now,
  });
  return { id: reqRef.id, fromUid, toUid, status: 'pending', createdAt: now };
}

function serializePublicUser(uid, data) {
  if (!data) {
    return {
      id: uid,
      username: 'Jugador',
      friendCode: 'BLK-0000',
      avatarIndex: 0,
      playerLevel: 1,
      bestScore: 0,
    };
  }
  return {
    id: uid,
    username: data.profile?.username || 'Jugador',
    friendCode: data.profile?.friendCode || 'BLK-0000',
    avatarIndex: data.profile?.avatarIndex || 0,
    playerLevel: data.inventory?.playerLevel || 1,
    bestScore: data.progress?.bestScore || 0,
  };
}

async function isFriend(uid, otherUid) {
  const doc = await users.doc(uid).collection('friends').doc(otherUid).get();
  return doc.exists;
}

/// Guarda el código de amigo del jugador si está libre.
async function setFriendCode(uid, friendCode) {
  const code = String(friendCode || '').trim().toUpperCase();
  if (!/^BLK-[A-Z0-9]{4}$/.test(code)) {
    return { saved: false, reason: 'INVALID' };
  }

  const existing = await users
    .where('profile.friendCode', '==', code)
    .limit(1)
    .get();
  if (!existing.empty && existing.docs[0].id !== uid) {
    return { saved: false, reason: 'TAKEN' };
  }

  await users.doc(uid).set(
    {
      profile: { friendCode: code },
      updatedAt: new Date(),
    },
    { merge: true },
  );
  return { saved: true, friendCode: code };
}

/// Solicitudes de amistad entrantes con los datos reales del remitente.
async function listIncomingRequests(uid) {
  // Se filtra el estado en memoria para no depender de un índice compuesto.
  const snapshot = await friendRequests.where('toUid', '==', uid).get();
  const pending = snapshot.docs.filter((doc) => doc.data().status === 'pending');
  if (pending.length === 0) return [];

  const senderDocs = await Promise.all(
    pending.map((doc) => users.doc(doc.data().fromUid).get()),
  );

  return pending.map((doc, index) => {
    const data = doc.data();
    const sender = senderDocs[index].exists ? senderDocs[index].data() : null;
    const publicUser = serializePublicUser(data.fromUid, sender);
    const createdAt = data.createdAt?.toDate?.() || data.createdAt || new Date();
    return {
      id: doc.id,
      ...publicUser,
      senderId: data.fromUid,
      senderUsername: publicUser.username,
      senderFriendCode: publicUser.friendCode,
      senderAvatarIndex: publicUser.avatarIndex,
      senderLevel: publicUser.playerLevel,
      createdAt,
    };
  });
}

/// Solicitudes de amistad enviadas por el usuario (para ver su estado).
async function listOutgoingRequests(uid) {
  const snapshot = await friendRequests.where('fromUid', '==', uid).get();
  const pending = snapshot.docs.filter((doc) => doc.data().status === 'pending');
  if (pending.length === 0) return [];

  const targetDocs = await Promise.all(
    pending.map((doc) => users.doc(doc.data().toUid).get()),
  );

  return pending.map((doc, index) => {
    const data = doc.data();
    const target = targetDocs[index].exists ? targetDocs[index].data() : null;
    const publicUser = serializePublicUser(data.toUid, target);
    return {
      id: doc.id,
      ...publicUser,
      createdAt: data.createdAt?.toDate?.() || data.createdAt || new Date(),
    };
  });
}

async function acceptFriendRequest(uid, requestId) {
  const reqRef = friendRequests.doc(requestId);
  const snapshot = await reqRef.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data.toUid !== uid) return null;

  const now = new Date();
  const batch = db.batch();
  batch.set(users.doc(uid).collection('friends').doc(data.fromUid), {
    addedAt: now,
  });
  batch.set(users.doc(data.fromUid).collection('friends').doc(uid), {
    addedAt: now,
  });
  batch.delete(reqRef);
  await batch.commit();

  return { success: true, friendUid: data.fromUid };
}

async function rejectFriendRequest(uid, requestId) {
  const reqRef = friendRequests.doc(requestId);
  const snapshot = await reqRef.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data.toUid !== uid && data.fromUid !== uid) return null;

  await reqRef.delete();
  return { success: true };
}

async function removeFriend(uid, friendUid) {
  const batch = db.batch();
  batch.delete(users.doc(uid).collection('friends').doc(friendUid));
  batch.delete(users.doc(friendUid).collection('friends').doc(uid));
  await batch.commit();
  return { success: true };
}

module.exports = {
  findById,
  findByFriendCode,
  findByUsername,
  saveProfile,
  updatePresence,
  getFriends,
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  listIncomingRequests,
  listOutgoingRequests,
  isFriend,
  setFriendCode,
};
