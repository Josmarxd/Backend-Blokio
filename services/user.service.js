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
];
const unlockFields = [
  'unlockedThemes',
  'unlockedDialogueSkins',
  'unlockedAvatars',
  'unlockedBlockSkins',
];
const settingFields = ['soundEnabled', 'vibrationEnabled', 'musicEnabled'];
const languages = new Set(['en', 'es', 'pt', 'fr']);

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

  return {
    profile: { username: username.trim(), avatarIndex },
    progress: pickNonNegativeIntegers(progress, progressFields, 'progress'),
    inventory: normalizedInventory,
    settings: normalizedSettings,
  };
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

module.exports = { getProfile, normalizeProfile, syncProfile };
