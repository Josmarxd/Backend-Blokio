const BaseController = require('./base.controller');
const userService = require('../services/user.service');

class UserController extends BaseController {
  getProfile = this.handle(async (req) => ({
    data: await userService.getProfile(req.authUser.uid),
  }));

  syncProfile = this.handle(async (req) => ({
    data: await userService.syncProfile(req.authUser.uid, req.body),
  }));
}

module.exports = new UserController();
