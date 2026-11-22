const BaseController = require('./base.controller');
const rushService = require('../services/rush.service');

class RushController extends BaseController {
  joinMatchmaking = this.handle(async (req) => ({
    data: await rushService.joinMatchmaking({
      uid: req.authUser.uid,
      username: req.body.username || req.authUser.name || 'Jugador',
      avatarIndex: req.body.avatarIndex ?? 0,
      copas: req.body.copas ?? 0,
    }),
  }));

  cancelMatchmaking = this.handle(async (req) => ({
    data: await rushService.cancelMatchmaking(req.authUser.uid),
  }));

  sendFriendInvite = this.handle(async (req) => ({
    data: await rushService.sendFriendInvite({
      fromUid: req.authUser.uid,
      fromUsername: req.body.fromUsername || 'Jugador',
      fromAvatarIndex: req.body.fromAvatarIndex ?? 0,
      toUid: req.body.toUid,
    }),
  }));

  getPendingInvites = this.handle(async (req) => ({
    data: await rushService.getPendingInvites(req.authUser.uid),
  }));

  getInvite = this.handle(async (req) => ({
    data: await rushService.getInvite(req.params.id, req.authUser.uid),
  }));

  respondInvite = this.handle(async (req) => ({
    data: await rushService.respondInvite(
      req.params.id,
      req.authUser.uid,
      req.body.accept === true,
      req.body.username,
      req.body.avatarIndex,
    ),
  }));

  getRoom = this.handle(async (req) => ({
    data: await rushService.getRoomState(req.params.roomId, req.authUser.uid),
  }));

  makeMove = this.handle(async (req) => ({
    data: await rushService.makeMove(req.params.roomId, req.authUser.uid, {
      row: req.body.row,
      col: req.body.col,
      slot: req.body.slot,
    }),
  }));

  sendQuickMessage = this.handle(async (req) => ({
    data: await rushService.sendQuickMessage(
      req.params.roomId,
      req.authUser.uid,
      req.body.text,
    ),
  }));

  useBomb = this.handle(async (req) => ({
    data: await rushService.useBomb(req.params.roomId, req.authUser.uid, {
      row: req.body.row,
      col: req.body.col,
    }),
  }));

  markReady = this.handle(async (req) => ({
    data: await rushService.markReady(req.params.roomId, req.authUser.uid),
  }));

  updateDragPreview = this.handle(async (req) => ({
    data: await rushService.updateDragPreview(req.params.roomId, req.authUser.uid, {
      slot: req.body.slot,
      row: req.body.row,
      col: req.body.col,
      x: req.body.x,
      y: req.body.y,
      clear: req.body.clear === true,
    }),
  }));

  finishGame = this.handle(async (req) => ({
    data: await rushService.finishGame(req.params.roomId, req.authUser.uid),
  }));

  leaveRoom = this.handle(async (req) => ({
    data: await rushService.leaveRoom(req.params.roomId, req.authUser.uid),
  }));

  getMyStats = this.handle(async (req) => ({
    data: await rushService.getMyStats(req.authUser.uid),
  }));

  getCompetitiveLeaderboard = this.handle(async () => ({
    data: await rushService.getCompetitiveLeaderboard(),
  }));
}

module.exports = new RushController();
