const BaseController = require('./base.controller');
const leaderboardService = require('../services/leaderboard.service');

class LeaderboardController extends BaseController {
  getLeaderboard = this.handle((req) =>
    leaderboardService.getLeaderboard(
      req.query.timeframe || 'allTime',
      req.query.limit || 50,
    ).then((data) => ({ data })),
  );

  submitScore = this.handle(async (req) => ({
    status: 201,
    data: await leaderboardService.submitScore(req.authUser.uid, req.body),
  }));
}

module.exports = new LeaderboardController();
