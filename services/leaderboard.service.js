const ApiError = require('../utils/api-error');
const leaderboardRepository = require('../repository/leaderboard.repository');
const userRepository = require('../repository/user.repository');

const timeframes = new Set(['allTime', 'weekly', 'daily']);

function getUtcPeriodIds(now = new Date()) {
  const daily = now.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return { daily, weekly: monday.toISOString().slice(0, 10) };
}

function validateSubmission(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'INVALID_SCORE', 'El cuerpo de la petición debe ser un objeto.');
  }
  const { score, level } = input;
  if (!Number.isSafeInteger(score) || score < 1 || score > 1000000000) {
    throw new ApiError(400, 'INVALID_SCORE', 'score debe ser un entero entre 1 y 1000000000.');
  }
  if (!Number.isSafeInteger(level) || level < 1 || level > 100000) {
    throw new ApiError(400, 'INVALID_LEVEL', 'level debe ser un entero positivo válido.');
  }
  let username;
  if (input.username !== undefined) {
    if (
      typeof input.username !== 'string' ||
      input.username.trim().length < 1 ||
      input.username.trim().length > 24
    ) {
      throw new ApiError(
        400,
        'INVALID_USERNAME',
        'username debe tener entre 1 y 24 caracteres.',
      );
    }
    username = input.username.trim();
  }
  return { score, level, username };
}

async function getLeaderboard(timeframe = 'allTime', limit = 50) {
  if (!timeframes.has(timeframe)) {
    throw new ApiError(400, 'INVALID_TIMEFRAME', 'timeframe debe ser allTime, weekly o daily.');
  }
  const boundedLimit = Number(limit);
  if (!Number.isInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 50) {
    throw new ApiError(400, 'INVALID_LIMIT', 'limit debe estar entre 1 y 50.');
  }

  const periods = getUtcPeriodIds();
  const periodId = timeframe === 'allTime' ? 'all' : periods[timeframe];
  const entries = await leaderboardRepository.listTop(timeframe, periodId, boundedLimit);
  return entries.map((entry) => ({
    ...entry,
    updatedAt: entry.updatedAt?.toDate?.().toISOString() || null,
  }));
}

async function submitScore(uid, input) {
  const { score, level, username } = validateSubmission(input);
  const user = await userRepository.findById(uid);
  if (!user) {
    throw new ApiError(
      409,
      'PROFILE_REQUIRED',
      'Sincroniza el perfil del jugador antes de enviar puntuaciones.',
    );
  }

  const periods = getUtcPeriodIds();
  await leaderboardRepository.submitScore(uid, score, level, {
    username: username || user.profile.username,
    avatarIndex: user.profile.avatarIndex,
    periodIds: periods,
  });
  return { playerId: uid, score, level };
}

module.exports = { getLeaderboard, getUtcPeriodIds, submitScore, validateSubmission };
