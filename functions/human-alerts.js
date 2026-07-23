const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

const DEFAULT_HUMAN_ALERT_RECIPIENTS = [
  'yeer.gutt_99@hotmail.com',
  'pattadia@hardrockush.com',
  'marketing@hardrockush.com'
];

function timestampToDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  return null;
}

function isAlertDueForReminder(alert, now = new Date()) {
  if (!alert || alert.reminderSent || alert.status === 'resolved') return false;
  const createdAt = timestampToDate(alert.createdAt);
  if (!createdAt) return false;
  return now.getTime() - createdAt.getTime() >= REMINDER_AFTER_MS;
}

function humanAlertRecipients(value = '') {
  const configured = value
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_HUMAN_ALERT_RECIPIENTS;
}

function humanAlertEmail(alert, { reminder = false } = {}) {
  const prefix = reminder ? 'RECORDATORIO · ' : '';
  const customerName = alert.customerName || 'Sin nombre confirmado';
  const phone = alert.phone || alert.senderId || 'Sin contacto';
  const priority = alert.priority || 'normal';
  const subject = `${prefix}Asistencia humana solicitada · ${customerName}`;
  const text = [
    reminder
      ? 'Esta solicitud lleva al menos 24 horas pendiente y todavía no fue resuelta.'
      : 'Sofía derivó una conversación al equipo humano.',
    '',
    `Cliente: ${customerName}`,
    `Contacto de WhatsApp: ${phone}`,
    `Motivo: ${alert.reason || 'Sin motivo informado'}`,
    `Prioridad: ${priority}`,
    '',
    'Resumen:',
    alert.summary || 'Sin resumen disponible.',
    '',
    'Ingresá a HRC-Reserve para tomar o resolver la alerta.'
  ].join('\n');
  return { subject, text };
}

module.exports = {
  DEFAULT_HUMAN_ALERT_RECIPIENTS,
  REMINDER_AFTER_MS,
  humanAlertEmail,
  humanAlertRecipients,
  isAlertDueForReminder,
  timestampToDate
};
