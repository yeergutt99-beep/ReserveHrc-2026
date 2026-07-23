const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  humanAlertEmail,
  humanAlertRecipients,
  isAlertDueForReminder
} = require('../human-alerts');

test('el recordatorio vence una sola vez después de 24 horas', () => {
  const now = new Date('2026-07-23T15:00:00.000Z');
  const due = { createdAt: new Date('2026-07-22T15:00:00.000Z'), reminderSent: false };
  assert.equal(isAlertDueForReminder(due, now), true);
  assert.equal(isAlertDueForReminder({ ...due, reminderSent: true }, now), false);
  assert.equal(isAlertDueForReminder({ ...due, status: 'resolved' }, now), false);
  assert.equal(
    isAlertDueForReminder(
      { createdAt: new Date('2026-07-22T15:00:01.000Z'), reminderSent: false },
      now
    ),
    false
  );
});

test('las alertas se envían a los tres responsables acordados', () => {
  assert.deepEqual(humanAlertRecipients(), [
    'yeer.gutt_99@hotmail.com',
    'pattadia@hardrockush.com',
    'marketing@hardrockush.com'
  ]);
  const email = humanAlertEmail({
    customerName: 'Ada',
    phone: '+5492901123456',
    reason: 'Evento privado',
    summary: 'Solicita una banda'
  });
  assert.match(email.text, /Ada/);
  assert.match(email.text, /Solicita una banda/);
});

test('el correo diario conserva el cron de las 15:00 de Argentina', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(
    source,
    /sendDailyReservationsDigest = onSchedule\(\s*\{ schedule: '0 15 \* \* \*', timeZone: 'America\/Argentina\/Buenos_Aires' \}/
  );
});
