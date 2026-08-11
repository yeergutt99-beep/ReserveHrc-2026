const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const nodemailer = require('nodemailer');
const {
  RESERVATION_TIME_ZONE,
  dateStringInTimeZone,
  expirationForReservation,
  isReservationExpired
} = require('./reservation-time');
const {
  humanAlertEmail,
  humanAlertRecipients,
  isAlertDueForReminder,
  timestampToDate
} = require('./human-alerts');
const { recursivelyDeleteConversation } = require('./conversation-cleanup');

initializeApp();
const auth = getAuth();
const db = getFirestore();

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

  const userRecord = await auth.createUser({
    email,
    password,
    displayName
  });

  await db.collection('users').doc(userRecord.uid).set({
    companyId: requester.companyId,
    role,
    email,
    displayName,
    createdAt: FieldValue.serverTimestamp()
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

function createMailTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function humanAlertRecipientsForEnvironment() {
  return humanAlertRecipients(process.env.HUMAN_ALERT_TO).join(',');
}

exports.sendHumanAlertEmail = onDocumentCreated(
  {
    document: 'companies/{companyId}/humanAlerts/{alertId}',
    retry: true
  },
  async (event) => {
    const alert = event.data?.data();
    if (!alert) return;
    const now = new Date();
    const claimed = await db.runTransaction(async (transaction) => {
      const freshSnapshot = await transaction.get(event.data.ref);
      const freshAlert = freshSnapshot.data();
      if (!freshAlert || freshAlert.immediateEmailSentAt) return false;
      const claimedAt = timestampToDate(freshAlert.immediateEmailClaimedAt);
      if (claimedAt && now.getTime() - claimedAt.getTime() < 15 * 60 * 1000) {
        return false;
      }
      transaction.update(event.data.ref, {
        immediateEmailClaimedAt: Timestamp.fromDate(now)
      });
      return true;
    });
    if (!claimed) return;

    try {
      const email = humanAlertEmail(alert);
      await createMailTransporter().sendMail({
        from: process.env.SMTP_FROM,
        to: humanAlertRecipientsForEnvironment(),
        subject: email.subject,
        text: email.text
      });
      await event.data.ref.update({
        immediateEmailSentAt: FieldValue.serverTimestamp(),
        immediateEmailClaimedAt: FieldValue.delete()
      });
      logger.info('Alerta humana enviada por correo.', {
        companyId: event.params.companyId,
        alertId: event.params.alertId
      });
    } catch (error) {
      await event.data.ref.update({
        immediateEmailClaimedAt: FieldValue.delete()
      });
      throw error;
    }
  }
);

exports.cleanupDeletedSofiaConversationMessages = onDocumentDeleted(
  {
    document: 'companies/{companyId}/sofiaConversations/{senderId}',
    retry: true
  },
  async (event) => {
    await recursivelyDeleteConversation(db, event.data?.ref);
    logger.info('Historial de conversacion eliminado por inactividad.', {
      companyId: event.params.companyId,
      senderId: event.params.senderId
    });
  }
);

exports.sendPendingHumanAlertReminders = onSchedule(
  { schedule: 'every 60 minutes', timeZone: RESERVATION_TIME_ZONE },
  async () => {
    const companyIds = (process.env.ALERT_COMPANY_IDS || 'hrc-ushuaia')
      .split(',')
      .map((companyId) => companyId.trim())
      .filter(Boolean);
    const now = new Date();
    let remindersSent = 0;

    for (const companyId of companyIds) {
      const alertsSnapshot = await db
        .collection('companies')
        .doc(companyId)
        .collection('humanAlerts')
        .where('reminderSent', '==', false)
        .get();

      for (const alertDocument of alertsSnapshot.docs) {
        const alert = alertDocument.data();
        if (!isAlertDueForReminder(alert, now)) continue;

        const claimed = await db.runTransaction(async (transaction) => {
          const freshSnapshot = await transaction.get(alertDocument.ref);
          const freshAlert = freshSnapshot.data();
          if (!isAlertDueForReminder(freshAlert, now)) return false;
          const claimedAt = timestampToDate(freshAlert.reminderClaimedAt);
          if (claimedAt && now.getTime() - claimedAt.getTime() < 15 * 60 * 1000) {
            return false;
          }
          transaction.update(alertDocument.ref, {
            reminderClaimedAt: Timestamp.fromDate(now)
          });
          return true;
        });
        if (!claimed) continue;

        try {
          const email = humanAlertEmail(alert, { reminder: true });
          await createMailTransporter().sendMail({
            from: process.env.SMTP_FROM,
            to: humanAlertRecipientsForEnvironment(),
            subject: email.subject,
            text: email.text
          });
          await alertDocument.ref.update({
            reminderSent: true,
            reminderSentAt: FieldValue.serverTimestamp(),
            reminderClaimedAt: FieldValue.delete()
          });
          remindersSent += 1;
        } catch (error) {
          await alertDocument.ref.update({
            reminderClaimedAt: FieldValue.delete()
          });
          throw error;
        }
      }
    }

    logger.info('Revisión de recordatorios humanos completada.', {
      companies: companyIds.length,
      remindersSent
    });
  }
);

exports.updateHumanAlertStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const requester = await getUserContext(request.auth.uid);
  const alertId = String(request.data.alertId || '').trim();
  const status = String(request.data.status || '').trim();
  if (!alertId || !['in_progress', 'resolved'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Alerta o estado inválido.');
  }

  const company = db.collection('companies').doc(requester.companyId);
  const alertRef = company.collection('humanAlerts').doc(alertId);
  await db.runTransaction(async (transaction) => {
    const alertSnapshot = await transaction.get(alertRef);
    if (!alertSnapshot.exists) {
      throw new HttpsError('not-found', 'La alerta no existe.');
    }
    const alert = alertSnapshot.data();
    const now = FieldValue.serverTimestamp();
    const changes = {
      status,
      updatedAt: now,
      updatedBy: request.auth.uid
    };
    if (status === 'in_progress') {
      changes.takenAt = now;
      changes.takenBy = request.auth.uid;
    } else {
      changes.resolvedAt = now;
      changes.resolvedBy = request.auth.uid;
      if (alert.senderId) {
        transaction.set(
          company.collection('sofiaConversations').doc(alert.senderId),
          {
            paused: false,
            activeAlertId: FieldValue.delete(),
            handoffReason: FieldValue.delete(),
            resumedAt: now,
            updatedAt: now
          },
          { merge: true }
        );
      }
    }
    transaction.update(alertRef, changes);
  });
  return { status };
});

exports.setSofiaEnabled = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const requester = await getUserContext(request.auth.uid);
  if (requester.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede apagar a Sofía.');
  }
  if (typeof request.data.enabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'El estado de Sofía debe ser verdadero o falso.');
  }
  await db
    .collection('companies')
    .doc(requester.companyId)
    .collection('settings')
    .doc('sofia')
    .set(
      {
        enabled: request.data.enabled,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid
      },
      { merge: true }
    );
  return { enabled: request.data.enabled };
});
