const express = require('express');
const userController = require('../controllers/user.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();

router.use(requireAuth);
router.get('/me', userController.getProfile);
router.put('/me/sync', userController.syncProfile);

module.exports = router;
