const test = require('node:test');
const assert = require('node:assert/strict');

test('carga todas las Functions con Firebase Admin modular', () => {
  const functions = require('../index');
  const expected = [
    'cleanupDeletedSofiaConversationMessages',
    'cleanupExpiredReservations',
    'createUserByAdmin',
    'sendDailyReservationsDigest',
    'sendHumanAlertEmail',
    'sendPendingHumanAlertReminders',
    'setSofiaEnabled',
    'updateHumanAlertStatus'
  ];

  assert.deepEqual(Object.keys(functions).sort(), expected.sort());
});
