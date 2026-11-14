function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = Number.isInteger(error.status) ? error.status : 500;
  const response = {
    status: 'error',
    code: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    message: status === 500 ? 'Error interno del servidor.' : error.message,
  };

  if (error.details !== undefined) response.data = error.details;
  if (status === 500) console.error('Error de API:', error);

  return res.status(status).json(response);
}

module.exports = errorHandler;
