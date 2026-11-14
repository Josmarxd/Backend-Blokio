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
