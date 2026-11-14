const { db } = require('../config/firestore');

const users = db.collection('users');

async function findById(uid) {
  const snapshot = await users.doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
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
      uid,
      ...profileData,
      revision: current ? current.revision + 1 : 1,
      createdAt: current ? current.createdAt : now,
      updatedAt: now,
    };
    transaction.set(userRef, next);
    return { profile: next };
  });
}

module.exports = { findById, saveProfile };
