const EMAIL_COLORS = {
  background: '#f1f2f4',
  border: '#dedfe3',
  gold: '#d6aa45',
  muted: '#686b73',
  surface: '#ffffff',
  text: '#18191d'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanText(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function peopleCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function plural(value, singular, pluralValue) {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

function reservationTypeLabel(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'bowling') return 'Bowling';
  if (type === 'restaurant' || type === 'restaurante') return 'Restaurante';
  return type ? cleanText(value, 'Sin área') : 'Sin área';
}

function sourceLabel(value) {
  const source = String(value || '').trim().toLowerCase();
  return source === 'whatsapp' || source === 'sofia'
    ? 'Sofía · WhatsApp'
    : 'Carga manual';
}

function formatDate(value, long = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return cleanText(value, 'Sin fecha');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!long) {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }
  const formatted = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function sortedReservations(reservations, includeDate = false) {
  return [...reservations].sort((left, right) => {
    const leftKey = `${includeDate ? left.date || '' : ''} ${left.time || ''}`;
    const rightKey = `${includeDate ? right.date || '' : ''} ${right.time || ''}`;
    return leftKey.localeCompare(rightKey);
  });
}

function reservationText(reservation, index, includeDate = false) {
  const heading = includeDate
    ? `${formatDate(reservation.date)} · ${cleanText(reservation.time, 'Sin hora')}`
    : cleanText(reservation.time, 'Sin hora');
  return [
    `${index + 1}. ${heading} — ${cleanText(reservation.name, 'Sin nombre')}`,
    `   Personas: ${peopleCount(reservation.peopleCount)}`,
    `   Área: ${reservationTypeLabel(reservation.reservationType)}`,
    `   Contacto: ${cleanText(reservation.contact, 'Sin contacto')}`,
    `   Origen: ${sourceLabel(reservation.source)}`,
    `   Observaciones: ${cleanText(reservation.comments, 'Sin observaciones')}`
  ].join('\n');
}

function reservationRow(reservation, index, includeDate = false) {
  const schedule = includeDate
    ? `${formatDate(reservation.date)}<br><span style="color:${EMAIL_COLORS.muted};">${escapeHtml(
        cleanText(reservation.time, 'Sin hora')
      )} hs</span>`
    : `${escapeHtml(cleanText(reservation.time, 'Sin hora'))} hs`;
  const background = index % 2 === 0 ? EMAIL_COLORS.surface : '#f8f8fa';
  const comments = cleanText(reservation.comments, 'Sin observaciones');
  const commentsColor = reservation.comments ? EMAIL_COLORS.text : EMAIL_COLORS.muted;
  return `
    <tr style="background:${background};">
      <td style="padding:14px 12px;border-bottom:1px solid ${EMAIL_COLORS.border};white-space:nowrap;vertical-align:top;font-weight:700;">${schedule}</td>
      <td style="padding:14px 12px;border-bottom:1px solid ${EMAIL_COLORS.border};vertical-align:top;">
        <div style="font-weight:700;">${escapeHtml(cleanText(reservation.name, 'Sin nombre'))}</div>
        <div style="margin-top:4px;color:${EMAIL_COLORS.muted};font-size:12px;">${escapeHtml(
          reservationTypeLabel(reservation.reservationType)
        )} · ${escapeHtml(sourceLabel(reservation.source))}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid ${EMAIL_COLORS.border};text-align:center;vertical-align:top;font-weight:700;">${peopleCount(
        reservation.peopleCount
      )}</td>
      <td style="padding:14px 12px;border-bottom:1px solid ${EMAIL_COLORS.border};vertical-align:top;">${escapeHtml(
        cleanText(reservation.contact, 'Sin contacto')
      )}</td>
      <td style="padding:14px 12px;border-bottom:1px solid ${EMAIL_COLORS.border};vertical-align:top;color:${commentsColor};">${escapeHtml(
        comments
      )}</td>
    </tr>`;
}

function reservationTable(reservations, includeDate = false, emptyMessage = 'Sin reservas.') {
  if (!reservations.length) {
    return `<div style="padding:22px;border:1px dashed ${EMAIL_COLORS.border};border-radius:10px;text-align:center;color:${EMAIL_COLORS.muted};">${escapeHtml(
      emptyMessage
    )}</div>`;
  }
  const scheduleHeading = includeDate ? 'Fecha y hora' : 'Hora';
  return `
    <div style="overflow-x:auto;border:1px solid ${EMAIL_COLORS.border};border-radius:10px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:680px;color:${EMAIL_COLORS.text};font-size:14px;">
        <thead>
          <tr style="background:#ececef;color:#4e5057;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.4px;">
            <th style="padding:11px 12px;">${scheduleHeading}</th>
            <th style="padding:11px 12px;">Reserva</th>
            <th style="padding:11px 12px;text-align:center;">Personas</th>
            <th style="padding:11px 12px;">Contacto</th>
            <th style="padding:11px 12px;">Observaciones</th>
          </tr>
        </thead>
        <tbody>${reservations
          .map((reservation, index) => reservationRow(reservation, index, includeDate))
          .join('')}</tbody>
      </table>
    </div>`;
}

function metric(value, label) {
  return `
    <td width="33.33%" style="padding:0 5px;">
      <div style="padding:14px 10px;border:1px solid ${EMAIL_COLORS.border};border-radius:10px;text-align:center;background:#fafafa;">
        <div style="font-size:24px;font-weight:800;color:${EMAIL_COLORS.text};">${value}</div>
        <div style="margin-top:3px;color:${EMAIL_COLORS.muted};font-size:12px;">${label}</div>
      </div>
    </td>`;
}

function dailyDigestEmail({ todayStr, todayReservations, largeReservations }) {
  const today = sortedReservations(todayReservations);
  const alerts = sortedReservations(largeReservations, true);
  const totalPeople = today.reduce(
    (total, reservation) => total + peopleCount(reservation.peopleCount),
    0
  );
  const subject = `Resumen diario de reservas - ${todayStr}`;
  const todayText = today.length
    ? today.map((reservation, index) => reservationText(reservation, index)).join('\n\n')
    : 'No hay reservas para hoy.';
  const alertsText = alerts.length
    ? alerts
        .map((reservation, index) => reservationText(reservation, index, true))
        .join('\n\n')
    : 'Sin alertas.';
  const text = [
    'HARD ROCK CAFE USHUAIA',
    'RESUMEN DIARIO DE RESERVAS',
    formatDate(todayStr, true),
    '',
    `RESERVAS DE HOY (${plural(today.length, 'reserva', 'reservas')} · ${plural(
      totalPeople,
      'persona',
      'personas'
    )})`,
    todayText,
    '',
    'ALERTAS DE GRUPOS GRANDES',
    'Reservas de más de 15 personas dentro de los próximos 20 días.',
    alertsText
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:${EMAIL_COLORS.background};font-family:Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.text};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_COLORS.background};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="width:100%;max-width:760px;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#111317;color:#ffffff;border-bottom:4px solid ${EMAIL_COLORS.gold};">
                <div style="color:${EMAIL_COLORS.gold};font-size:12px;font-weight:800;letter-spacing:1.4px;">HARD ROCK CAFE USHUAIA</div>
                <div style="margin-top:8px;font-size:26px;line-height:1.2;font-weight:800;">Resumen diario de reservas</div>
                <div style="margin-top:7px;color:#d7d8dc;font-size:14px;">${escapeHtml(
                  formatDate(todayStr, true)
                )}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 23px 10px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metric(today.length, today.length === 1 ? 'Reserva de hoy' : 'Reservas de hoy')}
                    ${metric(totalPeople, totalPeople === 1 ? 'Persona' : 'Personas')}
                    ${metric(alerts.length, alerts.length === 1 ? 'Alerta próxima' : 'Alertas próximas')}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 10px;">
                <div style="font-size:19px;font-weight:800;">Reservas de hoy</div>
                <div style="margin:5px 0 16px;color:${EMAIL_COLORS.muted};font-size:13px;">Ordenadas cronológicamente.</div>
                ${reservationTable(today, false, 'No hay reservas para hoy.')}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 30px;">
                <div style="padding-top:24px;border-top:1px solid ${EMAIL_COLORS.border};">
                  <div style="font-size:19px;font-weight:800;">Alertas de grupos grandes</div>
                  <div style="margin:5px 0 16px;color:${EMAIL_COLORS.muted};font-size:13px;">Reservas de más de 15 personas dentro de los próximos 20 días.</div>
                  ${reservationTable(alerts, true, 'Sin alertas próximas.')}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:15px 28px;background:#f7f7f8;color:${EMAIL_COLORS.muted};font-size:12px;text-align:center;border-top:1px solid ${EMAIL_COLORS.border};">
                Mensaje automático de HRC-Reserve · Hard Rock Cafe Ushuaia
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

module.exports = {
  dailyDigestEmail,
  escapeHtml,
  formatDate,
  reservationTypeLabel,
  sourceLabel
};
