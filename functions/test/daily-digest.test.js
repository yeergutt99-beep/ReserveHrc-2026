const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { dailyDigestEmail } = require('../daily-digest');

test('el resumen muestra observaciones y todos los datos operativos', () => {
  const email = dailyDigestEmail({
    todayStr: '2026-09-06',
    todayReservations: [
      {
        time: '18:00',
        name: 'Diana Socha',
        peopleCount: 4,
        contact: '+54 9 2901 123456',
        comments: 'Cumpleaños, mesa cerca del escenario',
        reservationType: 'restaurant',
        source: 'sofia'
      }
    ],
    largeReservations: []
  });

  assert.equal(email.subject, 'Resumen diario de reservas - 2026-09-06');
  assert.match(email.text, /Observaciones: Cumpleaños, mesa cerca del escenario/);
  assert.match(email.text, /Contacto: \+54 9 2901 123456/);
  assert.match(email.text, /Origen: Sofía · WhatsApp/);
  assert.match(email.html, />Observaciones</);
  assert.match(email.html, /Cumpleaños, mesa cerca del escenario/);
  assert.match(email.html, /Diana Socha/);
  assert.match(email.html, /Sofía · WhatsApp/);
});

test('el resumen ordena reservas y aclara campos vacíos', () => {
  const email = dailyDigestEmail({
    todayStr: '2026-09-06',
    todayReservations: [
      { time: '21:00', name: 'Segunda', peopleCount: 2 },
      { time: '18:00', name: 'Primera', peopleCount: 3, comments: '' }
    ],
    largeReservations: [
      {
        date: '2026-09-18',
        time: '20:00',
        name: 'Grupo grande',
        peopleCount: 18,
        comments: 'Piso superior'
      }
    ]
  });

  assert.ok(email.text.indexOf('Primera') < email.text.indexOf('Segunda'));
  assert.match(email.text, /Observaciones: Sin observaciones/);
  assert.match(email.text, /18\/09\/2026 · 20:00/);
  assert.match(email.html, /Sin contacto/);
  assert.match(email.html, /Piso superior/);
});

test('el HTML escapa el contenido escrito por clientes', () => {
  const email = dailyDigestEmail({
    todayStr: '2026-09-06',
    todayReservations: [
      {
        time: '18:00',
        name: '<script>alert(1)</script>',
        peopleCount: 4,
        comments: 'Mesa <ventana> & torta'
      }
    ],
    largeReservations: []
  });

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(email.html, /Mesa &lt;ventana&gt; &amp; torta/);
});

test('la función programada conserva horario, destinatario y consulta de alertas', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

  assert.match(source, /schedule: '0 15 \* \* \*'/);
  assert.match(source, /timeZone: 'America\/Argentina\/Buenos_Aires'/);
  assert.match(source, /\.where\('peopleCount', '>', 15\)/);
  assert.match(source, /to: process\.env\.DIGEST_TO/);
  assert.match(source, /text: email\.text/);
  assert.match(source, /html: email\.html/);
});
