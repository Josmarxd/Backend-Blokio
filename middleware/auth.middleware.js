const { auth } = require('../config/firestore');

const invalidTokenCodes = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/invalid-credential',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

async function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHENTICATED',
      message: 'Debes iniciar sesión para realizar esta operación.',
    });
  }

  try {
    req.authUser = await auth.verifyIdToken(match[1]);
    return next();
  } catch (error) {
    if (invalidTokenCodes.has(error.code)) {
      return res.status(401).json({
        status: 'error',
        code: 'INVALID_TOKEN',
        message: 'La sesión no es válida o expiró.',
      });
    }
    return next(error);
  }
}

module.exports = requireAuth;
