require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { connectDatabase } = require('./config/firestore');
const { attachRealtime } = require('./realtime');
const routes = require('./routes');
const errorHandler = require('./middleware/error.middleware');

// ============================================================
// INSTRUMENTACIÓN GLOBAL  (borrar cuando ya no la necesites)
// ============================================================
process.on('exit', (code) => {
  console.log(`\n🔚 process.exit() con código ${code} a las ${new Date().toISOString()}`);
});
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
});
process.on('beforeExit', (code) => {
  console.log(`⚠️  beforeExit (event loop vacío) código ${code}`);
});

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : ['http://localhost:4200'];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.includes(origin)) {
      const error = new Error('Origen no permitido por la política CORS.');
      error.status = 403;
      error.code = 'ORIGIN_NOT_ALLOWED';
      return callback(error);
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Demasiadas peticiones. Intenta más tarde.' },
});
// BLOKIO RUSH sondea el estado cada 250 ms: necesita un límite propio para
// no agotar el global de 1000 peticiones / 15 min (daría 429 "too many requests").
const rushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Demasiadas peticiones. Intenta más tarde.' },
});
app.use('/api/rush', rushLimiter);
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/rush')) return next();
  return limiter(req, res, next);
});

app.use(express.json({ limit: '64kb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', routes);
app.use('/api', (req, res, next) => {
  const error = new Error('Ruta de API no encontrada.');
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    database: 'Firestore',
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);

// ============================================================
// ARRANQUE DEL SERVIDOR
// ============================================================
async function startServer() {
  try {
    await connectDatabase();
    const localIp = process.env.LOCAL_IP || 'localhost';

    const server = app.listen(PORT, HOST, () => {
      attachRealtime(server);
      console.log(`🚀 Servidor en http://${HOST}:${PORT}`);
      console.log(`📱 Accesible en tu red local en http://${localIp}:${PORT}`);
      console.log(`🆔 PID=${process.pid}  PPID=${process.ppid}  Node=${process.version}`);
      console.log(`⏰ Arrancado a las ${new Date().toISOString()}`);
    });

    // Log si el server emite 'close' por cualquier causa
    server.on('close', () => {
      console.log(`⚠️  server 'close' event → el listener se está cerrando.`);
    });
    server.on('error', (err) => {
      console.error(`❌ server 'error' event:`, err);
    });

    // --- Shutdown instrumentado ---
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n⚠️  Recibida señal ${signal} → cerrando servidor...`);
      const forceExit = setTimeout(() => {
        console.error('⏱️  Timeout de cierre forzado, process.exit(1)');
        process.exit(1);
      }, 5000);
      forceExit.unref();
      server.close((err) => {
        if (err) console.error('Error al cerrar servidor:', err);
        console.log('✅ Servidor cerrado limpiamente, exit(0)');
        process.exit(0);
      });
    };

    process.once('SIGINT',  () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    // En Windows también puede llegar SIGHUP / SIGBREAK
    process.once('SIGHUP',  () => shutdown('SIGHUP'));
    if (process.platform === 'win32') {
      process.once('SIGBREAK', () => shutdown('SIGBREAK'));
    }

    return server;
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('❌ startServer() rechazó:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };