const BaseController = require('./base.controller');
const supportService = require('../services/support.service');

class SupportController extends BaseController {
  submitTicket = this.handle(async (req) => {
    const uid = req.authUser ? req.authUser.uid : req.body.uid;
    const result = await supportService.sendSupportTicket({
      uid,
      email: req.body.email,
      username: req.body.username,
      subject: req.body.subject,
      message: req.body.message,
      deviceInfo: req.body.deviceInfo,
    });
    return { data: result };
  });
}

module.exports = new SupportController();
