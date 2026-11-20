const express = require('express');
const rushController = require('../controllers/rush.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();

// Ranking competitivo público.
router.get('/leaderboard', rushController.getCompetitiveLeaderboard);

// Rutas protegidas por autenticación.
router.use(requireAuth);
router.get('/me', rushController.getMyStats);
router.post('/matchmaking/join', rushController.joinMatchmaking);
router.post('/matchmaking/cancel', rushController.cancelMatchmaking);
router.post('/invite', rushController.sendFriendInvite);
router.get('/invitations/pending', rushController.getPendingInvites);
router.get('/invite/:id', rushController.getInvite);
router.post('/invite/:id/respond', rushController.respondInvite);
router.get('/room/:roomId', rushController.getRoom);
router.post('/room/:roomId/move', rushController.makeMove);
router.post('/room/:roomId/message', rushController.sendQuickMessage);
router.post('/room/:roomId/bomb', rushController.useBomb);
router.post('/room/:roomId/drag', rushController.updateDragPreview);
router.post('/room/:roomId/ready', rushController.markReady);
router.post('/room/:roomId/finish', rushController.finishGame);
router.post('/room/:roomId/leave', rushController.leaveRoom);

module.exports = router;
