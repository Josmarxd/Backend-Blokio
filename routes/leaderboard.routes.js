const express = require('express');
const rateLimit = require('express-rate-limit');
const leaderboardController = require('../controllers/leaderboard.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', leaderboardController.getLeaderboard);
router.post(
  '/submit',
  submitLimiter,
  requireAuth,
  leaderboardController.submitScore,
);

module.exports = router;
