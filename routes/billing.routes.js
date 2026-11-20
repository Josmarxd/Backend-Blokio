const express = require('express');
const billingController = require('../controllers/billing.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();

router.use(requireAuth);
router.post('/google/verify', billingController.verifyGooglePlay);

module.exports = router;
