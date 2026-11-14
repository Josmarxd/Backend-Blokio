const { db } = require('../config/firestore');

function entriesFor(timeframe, periodId) {
  return db
    .collection('leaderboards')
    .doc(timeframe)
    .collection('periods')
    .doc(periodId)
    .collection('entries');
}

async function listTop(timeframe, periodId, limit) {
  const snapshot = await entriesFor(timeframe, periodId)
    .orderBy('score', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((document, index) => ({
    playerId: document.id,
    rank: index + 1,
    ...document.data(),
  }));
}

async function submitScore(uid, score, level, player) {
  const periodIds = {
    allTime: 'all',
    daily: player.periodIds.daily,
    weekly: player.periodIds.weekly,
  };
  const references = Object.entries(periodIds).map(([timeframe, periodId]) => ({
    timeframe,
    reference: entriesFor(timeframe, periodId).doc(uid),
  }));

  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(
      references.map(({ reference }) => transaction.get(reference)),
    );

    references.forEach(({ reference }, index) => {
      const current = snapshots[index].exists ? snapshots[index].data() : null;
      if (current && current.score >= score) return;

      transaction.set(reference, {
        username: player.username,
        avatarIndex: player.avatarIndex,
        score,
        level,
        updatedAt: new Date(),
      });
    });
  });

  return { score, level };
}

module.exports = { listTop, submitScore };
