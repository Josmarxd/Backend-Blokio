class BaseController {
  handle(operation) {
    return async (req, res, next) => {
      try {
        const result = await operation(req);
        const status = result.status || 200;
        return res.status(status).json({
          status: 'success',
          ...(result.data !== undefined ? { data: result.data } : {}),
        });
      } catch (error) {
        return next(error);
      }
    };
  }
}

module.exports = BaseController;
