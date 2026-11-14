const express = require('express');
const router = express.Router();
const leaderboardRoutes = require('./leaderboard.routes');
const userRoutes = require('./user.routes');

router.get('/', (req, res) => {
  res.json({ status: 'success', message: 'API de BLOKIO funcionando' });
});

router.use('/leaderboard', leaderboardRoutes);
router.use('/users', userRoutes);

module.exports = router;