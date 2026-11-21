const ApiError = require('../utils/api-error');
const userRepository = require('../repository/user.repository');

const progressFields = [
  'bestScore',
  'highestLevel',
  'totalLevelsReached',
  'totalLinesCleared',
  'bestCombo',
  'totalContinues',
  'gamesPlayed',
  'totalScore',
];
const inventoryFields = [
  'coins',
  'gems',
  'xp',
  'playerLevel',
  'dailyStreak',
  'selectedTheme',
  'selectedDialogueSkin',
  'selectedAvatar',
  'selectedBlockSkin',
  'selectedBackground',
];
const unlockFields = [
  'unlockedThemes',
  'unlockedDialogueSkins',
  'unlockedAvatars',
  'unlockedBlockSkins',
  'unlockedBackgrounds',
];
const settingFields = ['soundEnabled', 'vibrationEnabled', 'musicEnabled'];
const languages = new Set(['en', 'es', 'pt', 'fr']);
const backupKeys = new Set([
  'best_score',
  'highest_level',
  'total_levels_reached',
  'total_lines_cleared',
  'best_combo',
  'total_continues',
  'games_played',
  'total_score',
  'saved_game_v1',
  'sound_enabled',
  'vibration_enabled',
  'music_enabled',
  'language_code',
  'coins',
  'gems',
  'xp',
  'player_level',
  'daily_streak',
  'last_daily_date',
  'daily_completed_date',
  'last_played_date',
  'daily_challenge_date',
  'daily_attempted_date',
  'daily_retry_date',
  'streak_celebrated_date',
  'streak_claimed_date',
  'pending_streak_celebration',
  'missions_json',
  'powerups_json',
  'unlocked_themes',
  'selected_theme',
  'unlocked_dialogue_skins',
  'selected_dialogue_skin',
  'unlocked_avatars',
  'selected_avatar',
  'unlocked_block_skins',
  'selected_block_skin',
  'unlocked_backgrounds',
  'selected_background',
  'last_advice_text',
  'last_advice_punchline',
  'last_advice_date',
  'pending_advice_round_v1',
  'leaderboard_json',
  'player_username',
  'blokio_rush_points',
  'blokio_rush_wins',
  'blokio_rush_losses',
  'blokio_rush_ties',
  'blokio_rush_games',
]);

function requireObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_PROFILE', `${field} debe ser un objeto.`);
  }
  return value;
}

function pickNonNegativeIntegers(source, fields, section) {
  const result = {};
  for (const field of fields) {
    if (source[field] === undefined) continue;
    const value = source[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(
        400,
        'INVALID_PROFILE',
        `${section}.${field} debe ser un entero no negativo.`,
      );
    }
    result[field] = value;
  }
  return result;
}

function normalizeBackup(value) {
  const backup = requireObject(value, 'backup');
  if (backup.version !== 1) {
    throw new ApiError(400, 'INVALID_PROFILE', 'backup.version no es compatible.');
  }
  const values = requireObject(backup.values, 'backup.values');
  const normalizedValues = {};
  for (const [key, item] of Object.entries(values)) {
    if (!backupKeys.has(key)) {
      throw new ApiError(400, 'INVALID_PROFILE', `backup.values.${key} no es válido.`);
    }
    const isValidString = typeof item === 'string' && item.length <= 20000;
    const isValidNumber =
      typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
    const isValidStringList =
      Array.isArray(item) &&
      item.length <= 100 &&
      item.every((entry) => typeof entry === 'string' && entry.length <= 64);
    if (
      !isValidString &&
      !isValidNumber &&
      typeof item !== 'boolean' &&
      !isValidStringList
    ) {
      throw new ApiError(400, 'INVALID_PROFILE', `backup.values.${key} no es válido.`);
    }
    normalizedValues[key] = item;
  }
  if (JSON.stringify(normalizedValues).length > 50000) {
    throw new ApiError(400, 'INVALID_PROFILE', 'backup.values es demasiado grande.');
  }
  return { version: 1, values: normalizedValues };
}

function normalizeProfile(input) {
  requireObject(input, 'body');
  const profile = requireObject(input.profile, 'profile');
  const progress = requireObject(input.progress, 'progress');
  const inventory = requireObject(input.inventory, 'inventory');
  const settings = requireObject(input.settings, 'settings');

  const username = profile.username;
  const avatarIndex = profile.avatarIndex;
  if (
    typeof username !== 'string' ||
    username.trim().length < 1 ||
    username.trim().length > 24
  ) {
    throw new ApiError(
      400,
      'INVALID_PROFILE',
      'profile.username debe tener entre 1 y 24 caracteres.',
    );
  }
  if (!Number.isSafeInteger(avatarIndex) || avatarIndex < 0 || avatarIndex > 100) {
    throw new ApiError(400, 'INVALID_PROFILE', 'profile.avatarIndex no es válido.');
  }

  const normalizedInventory = pickNonNegativeIntegers(
    inventory,
    inventoryFields,
    'inventory',
  );
  for (const field of unlockFields) {
    if (inventory[field] === undefined) continue;
    if (
      !Array.isArray(inventory[field]) ||
      inventory[field].length > 100 ||
      !inventory[field].every(
        (value) => typeof value === 'string' && value.length <= 64,
      )
    ) {
      throw new ApiError(400, 'INVALID_PROFILE', `inventory.${field} no es válido.`);
    }
    normalizedInventory[field] = [...new Set(inventory[field])];
  }

  if (inventory.powerups !== undefined) {
    const powerups = requireObject(inventory.powerups, 'inventory.powerups');
    normalizedInventory.powerups = {};
    for (const [name, count] of Object.entries(powerups)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name) ||
          !Number.isSafeInteger(count) ||
          count < 0) {
        throw new ApiError(
          400,
          'INVALID_PROFILE',
          'inventory.powerups contiene un valor no válido.',
        );
      }
      normalizedInventory.powerups[name] = count;
    }
  }

  const normalizedSettings = {};
  for (const field of settingFields) {
    if (settings[field] === undefined) continue;
    if (typeof settings[field] !== 'boolean') {
      throw new ApiError(400, 'INVALID_PROFILE', `settings.${field} debe ser booleano.`);
    }
    normalizedSettings[field] = settings[field];
  }
  if (settings.languageCode !== undefined) {
    if (!languages.has(settings.languageCode)) {
      throw new ApiError(400, 'INVALID_PROFILE', 'settings.languageCode no es válido.');
    }
    normalizedSettings.languageCode = settings.languageCode;
  }

  const normalized = {
    profile: { username: username.trim(), avatarIndex },
    progress: pickNonNegativeIntegers(progress, progressFields, 'progress'),
    inventory: normalizedInventory,
    settings: normalizedSettings,
  };
  if (input.backup !== undefined) normalized.backup = normalizeBackup(input.backup);
  return normalized;
}

function serializeUser(user) {
  if (!user) return null;
  const toIsoString = (value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    return null;
  };
  return {
    ...user,
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
  };
}

async function getProfile(uid) {
  return serializeUser(await userRepository.findById(uid));
}

async function syncProfile(uid, input) {
  const profileData = normalizeProfile(input);
  const expectedRevision = input.revision;

  if (
    expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
  ) {
    throw new ApiError(400, 'INVALID_REVISION', 'revision debe ser un entero positivo.');
  }

  const result = await userRepository.saveProfile(uid, profileData, expectedRevision);
  if (result.conflict) {
    throw new ApiError(
      409,
      'SYNC_CONFLICT',
      'El perfil cambió en otro dispositivo. Descarga la versión más reciente antes de sincronizar.',
      serializeUser(result.conflict),
    );
  }
  return serializeUser(result.profile);
}

async function getFriends(uid) {
  return await userRepository.getFriends(uid);
}

async function getFriendRequests(uid) {
  const [incoming, outgoing] = await Promise.all([
    userRepository.listIncomingRequests(uid),
    userRepository.listOutgoingRequests(uid),
  ]);
  return { incoming, outgoing };
}

async function sendFriendRequest(uid, input) {
  const query = (input?.query || input?.friendCode || input?.username || '').trim();
  if (!query) {
    throw new ApiError(400, 'INVALID_QUERY', 'Debes ingresar un código de amigo o nombre de usuario.');
  }

  let targetUser = null;
  if (query.toUpperCase().startsWith('BLK-')) {
    targetUser = await userRepository.findByFriendCode(query.toUpperCase());
  } else {
    targetUser = await userRepository.findByUsername(query);
  }

  if (!targetUser) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'No se encontró ningún jugador con ese código o nombre.');
  }

  if (targetUser.uid === uid) {
    throw new ApiError(400, 'CANNOT_ADD_SELF', 'No puedes enviarte una solicitud a ti mismo.');
  }

  if (await userRepository.isFriend(uid, targetUser.uid)) {
    throw new ApiError(409, 'ALREADY_FRIENDS', 'Ese jugador ya está en tu lista de amigos.');
  }

  return await userRepository.createFriendRequest(uid, targetUser.uid);
}

async function acceptFriendRequest(uid, requestId) {
  const result = await userRepository.acceptFriendRequest(uid, requestId);
  if (!result) {
    throw new ApiError(404, 'REQUEST_NOT_FOUND', 'La solicitud de amistad no existe o ya expiró.');
  }
  return result;
}

async function rejectFriendRequest(uid, requestId) {
  return await userRepository.rejectFriendRequest(uid, requestId);
}

async function removeFriend(uid, friendId) {
  return await userRepository.removeFriend(uid, friendId);
}

async function registerFriendCode(uid, friendCode) {
  const result = await userRepository.setFriendCode(uid, friendCode);
  if (!result.saved) {
    if (result.reason === 'TAKEN') {
      throw new ApiError(409, 'FRIEND_CODE_TAKEN', 'Ese código de amigo ya está en uso.');
    }
    throw new ApiError(400, 'INVALID_FRIEND_CODE', 'El código de amigo no es válido.');
  }
  return result;
}

async function updatePresence(uid, input) {
  const state = input?.state || 'online';
  const activity = input?.activity || 'En el menú';
  return await userRepository.updatePresence(uid, { state, activity });
}

module.exports = {
  getProfile,
  normalizeProfile,
  syncProfile,
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  updatePresence,
  registerFriendCode,
};
