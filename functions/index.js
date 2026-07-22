const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const {
  RESERVATION_TIME_ZONE,
  dateStringInTimeZone,
  expirationForReservation,
  isReservationExpired
} = require('./reservation-time');

admin.initializeApp();
const db = admin.firestore();

function toDateString(date) {
  return dateStringInTimeZone(date);
}

async function getUserContext(uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError('failed-precondition', 'El usuario no existe en /users.');
  }
  return snapshot.data();
}

exports.createUserByAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const requester = await getUserContext(request.auth.uid);
  if (requester.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el admin puede crear usuarios.');
  }

  const { email, password, displayName, role = 'user' } = request.data;
  if (!email || !password || !displayName) {
    throw new HttpsError('invalid-argument', 'Faltan datos obligatorios.');
  }

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName
  });

  await db.collection('users').doc(userRecord.uid).set({
    companyId: requester.companyId,
    role,
    email,
    displayName,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { uid: userRecord.uid };
});

exports.sendDailyReservationsDigest = onSchedule(
  { schedule: '0 15 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const today = new Date();
    const todayStr = toDateString(today);
    const future = new Date(today);
    future.setDate(future.getDate() + 20);
    const futureLimit = toDateString(future);

    const [todayQuery, bigGroupsQuery] = await Promise.all([
      db.collectionGroup('reservations').where('date', '==', todayStr).get(),
      db
        .collectionGroup('reservations')
        .where('date', '>=', todayStr)
        .where('date', '<=', futureLimit)
        .where('peopleCount', '>', 15)
        .get()
    ]);

    const todayReservations = todayQuery.docs.map((doc) => doc.data());
    const largeReservations = bigGroupsQuery.docs.map((doc) => doc.data());

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const lines = todayReservations.map(
      (r) => `• ${r.time} - ${r.name} (${r.peopleCount}) [${r.companyId}]`
    );

    const alerts = largeReservations.map(
      (r) => `⚠ ${r.date} ${r.time} - ${r.name} (${r.peopleCount})`
    );

    const body = [
      `Reservas para hoy (${todayStr}):`,
      lines.length ? lines.join('\n') : 'No hay reservas para hoy.',
      '',
      'Alertas de reservas > 15 personas (próximos 20 días):',
      alerts.length ? alerts.join('\n') : 'Sin alertas.'
    ].join('\n');

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.DIGEST_TO,
      subject: `Resumen diario de reservas - ${todayStr}`,
      text: body
    });

    logger.info('Resumen diario enviado.', {
      reservations: todayReservations.length,
      alerts: largeReservations.length
    });
  }
);

exports.cleanupExpiredReservations = onSchedule(
  { schedule: 'every 60 minutes', timeZone: RESERVATION_TIME_ZONE },
  async () => {
    const now = new Date();
    const localDate = dateStringInTimeZone(now);
    const snapshot = await db
      .collectionGroup('reservations')
      .where('date', '<=', localDate)
      .get();

    let batch = db.batch();
    let pendingWrites = 0;
    let deletedReservations = 0;
    let invalidReservations = 0;

    for (const reservationDocument of snapshot.docs) {
      const reservation = reservationDocument.data();
      const expiration = expirationForReservation(reservation);

      if (!expiration) {
        invalidReservations += 1;
        logger.warn('Reserva omitida de la limpieza por fecha u hora inválida.', {
          path: reservationDocument.ref.path,
          date: reservation.date,
          time: reservation.time
        });
        continue;
      }

      if (!isReservationExpired(reservation, now)) continue;

      batch.delete(reservationDocument.ref);
      pendingWrites += 1;
      deletedReservations += 1;

      if (pendingWrites === 450) {
        await batch.commit();
        batch = db.batch();
        pendingWrites = 0;
      }
    }

    if (pendingWrites > 0) await batch.commit();

    logger.info('Limpieza automática de reservas completada.', {
      checkedReservations: snapshot.size,
      deletedReservations,
      invalidReservations,
      cutoff: now.toISOString()
    });
  }
);
