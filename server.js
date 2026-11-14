require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { connectDatabase } = require('./config/firestore');
const routes = require('./routes');
const errorHandler = require('./middleware/error.middleware');

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Demasiadas peticiones. Intenta más tarde.' },
});
app.use('/api', limiter);

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

async function startServer() {
  try {
    await connectDatabase();
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor en http://localhost:${PORT}`);
    });
    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return server;
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };