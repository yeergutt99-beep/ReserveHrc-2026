'use strict';

const RESERVATION_TIME_ZONE = 'America/Argentina/Ushuaia';
const RESERVATION_UTC_OFFSET = '-03:00';
const RETENTION_AFTER_RESERVATION_MS = 24 * 60 * 60 * 1000;

function dateStringInTimeZone(date, timeZone = RESERVATION_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function reservationDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) {
    return null;
  }

  const parsed = new Date(`${date}T${time}:00${RESERVATION_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function reservationExpiresAt(date, time) {
  const reservation = reservationDateTime(date, time);
  if (!reservation) return null;
  return new Date(reservation.getTime() + RETENTION_AFTER_RESERVATION_MS);
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function expirationForReservation(reservation) {
  return reservationExpiresAt(reservation.date, reservation.time)
    || timestampToDate(reservation.expiresAt);
}

function isReservationExpired(reservation, now = new Date()) {
  const expiration = expirationForReservation(reservation);
  return expiration ? expiration.getTime() <= now.getTime() : false;
}

module.exports = {
  RESERVATION_TIME_ZONE,
  dateStringInTimeZone,
  expirationForReservation,
  isReservationExpired,
  reservationDateTime,
  reservationExpiresAt
};
