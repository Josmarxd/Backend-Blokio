const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProfile } = require('../services/user.service');

const validProfile = {
  profile: { username: 'Blokio', avatarIndex: 0 },
  progress: { bestScore: 1200, gamesPlayed: 4 },
  inventory: { coins: 25, powerups: { bomb: 2 } },
  settings: { soundEnabled: true, languageCode: 'es' },
};

test('normalizes supported user data before storing it', () => {
  assert.deepEqual(normalizeProfile(validProfile), validProfile);
});

test('rejects invalid profile values and unsupported languages', () => {
  assert.throws(
    () => normalizeProfile({
      ...validProfile,
      progress: { bestScore: -1 },
    }),
    { code: 'INVALID_PROFILE' },
  );
  assert.throws(
    () => normalizeProfile({
      ...validProfile,
      settings: { languageCode: 'xx' },
    }),
    { code: 'INVALID_PROFILE' },
  );
});

test('preserves validated account backup values and new cosmetic unlocks', () => {
  const backup = {
    version: 1,
    values: {
      coins: 25,
      sound_enabled: true,
      unlocked_backgrounds: ['0', '2'],
    },
  };
  const profile = {
    ...validProfile,
    inventory: {
      ...validProfile.inventory,
      selectedBackground: 2,
      unlockedBackgrounds: ['0', '2'],
    },
    backup,
  };

  assert.deepEqual(normalizeProfile(profile), {
    ...profile,
    inventory: {
      ...profile.inventory,
      unlockedBackgrounds: ['0', '2'],
    },
  });
});

test('rejects backup keys and values outside the local save allowlist', () => {
  assert.throws(
    () =>
      normalizeProfile({
        ...validProfile,
        backup: { version: 1, values: { access_token: 'secret' } },
      }),
    { code: 'INVALID_PROFILE' },
  );
  assert.throws(
    () =>
      normalizeProfile({
        ...validProfile,
        backup: { version: 1, values: { coins: -1 } },
      }),
    { code: 'INVALID_PROFILE' },
  );
});
