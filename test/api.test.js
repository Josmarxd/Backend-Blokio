const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

test('protects writes and private profile routes with Firebase authentication', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const profileResponse = await fetch(`${baseUrl}/api/users/me`);
    const scoreResponse = await fetch(`${baseUrl}/api/leaderboard/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 100, level: 1 }),
    });
    const invalidTimeframeResponse = await fetch(
      `${baseUrl}/api/leaderboard?timeframe=monthly`,
    );

    assert.equal(profileResponse.status, 401);
    assert.equal(scoreResponse.status, 401);
    assert.equal(invalidTimeframeResponse.status, 400);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
