const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getUtcPeriodIds,
  validateSubmission,
} = require('../services/leaderboard.service');

test('uses UTC date and Monday start for leaderboard periods', () => {
  assert.deepEqual(
    getUtcPeriodIds(new Date('2026-11-13T21:53:00.000Z')),
    { daily: '2026-11-13', weekly: '2026-11-09' },
  );
});

test('rejects invalid scores and levels', () => {
  assert.throws(() => validateSubmission({ score: -1, level: 1 }), {
    code: 'INVALID_SCORE',
  });
  assert.throws(() => validateSubmission({ score: 100, level: 0 }), {
    code: 'INVALID_LEVEL',
  });
});

test('trims and validates optional leaderboard usernames', () => {
  assert.deepEqual(
    validateSubmission({ score: 100, level: 2, username: '  Rosa  ' }),
    { score: 100, level: 2, username: 'Rosa' },
  );
  assert.throws(
    () => validateSubmission({ score: 100, level: 2, username: '   ' }),
    { code: 'INVALID_USERNAME' },
  );
  assert.throws(
    () => validateSubmission({ score: 100, level: 2, username: 'a'.repeat(25) }),
    { code: 'INVALID_USERNAME' },
  );
});
