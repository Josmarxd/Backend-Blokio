const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT;

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });

const db = getFirestore(app);
const auth = getAuth(app);

async function connectDatabase() {
  await db.collection('_health_check').limit(1).get();
  console.log(`✅ Firestore conectado (${projectId || 'proyecto ADC'})`);
}

module.exports = { auth, db, connectDatabase };
