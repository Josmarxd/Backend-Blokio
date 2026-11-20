const BaseController = require('./base.controller');
const userService = require('../services/user.service');

class UserController extends BaseController {
  getProfile = this.handle(async (req) => ({
    data: await userService.getProfile(req.authUser.uid),
  }));

  syncProfile = this.handle(async (req) => ({
    data: await userService.syncProfile(req.authUser.uid, req.body),
  }));

  getFriends = this.handle(async (req) => ({
    data: await userService.getFriends(req.authUser.uid),
  }));

  getFriendRequests = this.handle(async (req) => ({
    data: await userService.getFriendRequests(req.authUser.uid),
  }));

  sendFriendRequest = this.handle(async (req) => ({
    data: await userService.sendFriendRequest(req.authUser.uid, req.body),
  }));

  acceptFriendRequest = this.handle(async (req) => ({
    data: await userService.acceptFriendRequest(req.authUser.uid, req.params.id),
  }));

  rejectFriendRequest = this.handle(async (req) => ({
    data: await userService.rejectFriendRequest(req.authUser.uid, req.params.id),
  }));

  removeFriend = this.handle(async (req) => ({
    data: await userService.removeFriend(req.authUser.uid, req.params.friendId),
  }));

  registerFriendCode = this.handle(async (req) => ({
    data: await userService.registerFriendCode(req.authUser.uid, req.body.friendCode),
  }));

  updatePresence = this.handle(async (req) => ({
    data: await userService.updatePresence(req.authUser.uid, req.body),
  }));
}

module.exports = new UserController();
