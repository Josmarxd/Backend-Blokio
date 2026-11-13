// config/firestore.js
require('dotenv').config();
const { Firestore } = require('@google-cloud/firestore');

const options = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
};

// Si definiste un ID personalizado de base de datos, se lo pasamos.
// Si no, se conecta a "(default)" automáticamente.
if (process.env.FIRESTORE_DATABASE_ID) {
  options.databaseId = process.env.FIRESTORE_DATABASE_ID;
}

const db = new Firestore(options);

// Función para probar la conexión al arrancar el servidor.
async function connectDatabase(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔌 Conectando a Firestore... (${attempt}/${maxAttempts})`);

      // Firestore no tiene un "ping" como SQL, pero leer una colección
      // (aunque no exista) confirma que hay conexión y permisos.
      await db.collection('_health_check').limit(1).get();

      console.log('✅ Conexión a Firestore establecida');
      console.log(`   Proyecto: ${options.projectId || '(auto)'}`);
      console.log(`   Base de datos: ${options.databaseId || '(default)'}`);
      return;
    } catch (error) {
      console.error(`⏳ Intento ${attempt} fallido:`, error.message);
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

module.exports = { db, connectDatabase };