const express = require('express');
const router = express.Router();
const leaderboardRoutes = require('./leaderboard.routes');
const userRoutes = require('./user.routes');
const supportRoutes = require('./support.routes');
const rushRoutes = require('./rush.routes');
const billingRoutes = require('./billing.routes');

router.get('/', (req, res) => {
  res.json({ status: 'success', message: 'API de BLOKIO funcionando' });
});

router.use('/leaderboard', leaderboardRoutes);
router.use('/users', userRoutes);
router.use('/support', supportRoutes);
router.use('/rush', rushRoutes);
router.use('/billing', billingRoutes);

module.exports = router;