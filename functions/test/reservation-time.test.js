'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dateStringInTimeZone,
  expirationForReservation,
  isReservationExpired,
  reservationDateTime,
  reservationExpiresAt
} = require('../reservation-time');

test('interpreta la fecha y hora de la reserva en Ushuaia', () => {
  assert.equal(
    reservationDateTime('2026-07-21', '20:30').toISOString(),
    '2026-07-21T23:30:00.000Z'
  );
});

test('calcula el vencimiento exactamente 24 horas después', () => {
  assert.equal(
    reservationExpiresAt('2026-07-21', '20:30').toISOString(),
    '2026-07-22T23:30:00.000Z'
  );
});

test('rechaza fechas u horarios incompletos', () => {
  assert.equal(reservationDateTime('21/07/2026', '20:30'), null);
  assert.equal(reservationDateTime('2026-07-21', ''), null);
});

test('detecta una reserva vencida usando los campos heredados', () => {
  const reservation = { date: '2026-07-21', time: '20:30' };
  assert.equal(isReservationExpired(reservation, new Date('2026-07-22T23:29:59Z')), false);
  assert.equal(isReservationExpired(reservation, new Date('2026-07-22T23:30:00Z')), true);
});

test('usa fecha y hora como fuente de verdad aunque exista expiresAt', () => {
  const expiresAt = { toDate: () => new Date('2026-08-01T10:00:00Z') };
  assert.equal(
    expirationForReservation({ date: '2026-07-21', time: '20:30', expiresAt }).toISOString(),
    '2026-07-22T23:30:00.000Z'
  );
});

test('usa expiresAt como respaldo para documentos sin fecha válida', () => {
  const expiresAt = { toDate: () => new Date('2026-08-01T10:00:00Z') };
  assert.equal(
    expirationForReservation({ date: '', time: '', expiresAt }).toISOString(),
    '2026-08-01T10:00:00.000Z'
  );
});

test('genera la fecha local correcta para el corte de limpieza', () => {
  assert.equal(dateStringInTimeZone(new Date('2026-07-22T01:30:00Z')), '2026-07-21');
  assert.equal(dateStringInTimeZone(new Date('2026-07-22T04:00:00Z')), '2026-07-22');
});
