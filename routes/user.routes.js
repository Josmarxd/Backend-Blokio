const express = require('express');
const userController = require('../controllers/user.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();

router.use(requireAuth);
router.get('/me', userController.getProfile);
router.delete('/me', userController.deleteAccount);
router.put('/me/sync', userController.syncProfile);
router.get('/friends', userController.getFriends);
router.get('/friends/requests', userController.getFriendRequests);
router.post('/friends/request', userController.sendFriendRequest);
router.put('/friends/request/:id/accept', userController.acceptFriendRequest);
router.delete('/friends/request/:id', userController.rejectFriendRequest);
router.delete('/friends/:friendId', userController.removeFriend);
router.post('/me/friend-code', userController.registerFriendCode);
router.post('/presence', userController.updatePresence);

module.exports = router;
