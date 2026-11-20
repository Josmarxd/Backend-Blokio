const BaseController = require('./base.controller');
const billingService = require('../services/billing.service');

class BillingController extends BaseController {
  verifyGooglePlay = this.handle(async (req) => ({
    data: await billingService.verifyGooglePlayPurchase({
      uid: req.authUser.uid,
      productId: req.body.productId,
      purchaseToken: req.body.purchaseToken,
      packageName: req.body.packageName,
    }),
  }));
}

module.exports = new BillingController();
