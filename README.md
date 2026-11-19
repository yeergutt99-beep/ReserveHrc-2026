# HRC Reserve

Panel de reservas de Hard Rock Cafe Ushuaia construido con Firebase Authentication, Firestore, Cloud Functions y Hosting.

## Funciones principales

- Acceso del equipo con Firebase Authentication.
- Agenda en tiempo real sobre `companies/{companyId}/reservations`.
- Panel de shows consumido directamente por Sofía.
- Panel de alertas humanas con estados Pendiente, En atención y Resuelta.
- Botón administrativo para apagar o encender globalmente a Sofía.
- Correo inmediato de derivación y un único recordatorio al superar 24 horas pendiente.
- Alta y edición de reservas.
- Eliminación manual disponible para administradores, con confirmación.
- Búsqueda por nombre, contacto u observaciones.
- Vista diaria o de todas las próximas reservas.
- Identificación de reservas manuales y originadas por Sofía/WhatsApp.
- Creación de usuarios desde el panel de administración.
- Pestaña interna de Año Nuevo con pagos, clientes, plano, mesas compartidas, combinaciones y exportación CSV.
- Resumen diario por correo.
- Limpieza automática cada hora: elimina una reserva cuando ya pasaron 24 horas desde su fecha y hora.

Las alertas humanas son independientes del resumen diario de reservas de las 15:00. Usan las
mismas variables SMTP. Opcionalmente, `HUMAN_ALERT_TO` permite configurar destinatarios
separados por comas y `ALERT_COMPANY_IDS` define las empresas revisadas por el recordatorio.

## Año Nuevo 2026

El módulo usa `companies/{companyId}/newYearEvents/new-year-2026` y su subcolección
`bookings`. Solo los roles `admin` y `user` de la empresa pueden leerlo. Todas las
modificaciones pasan por `updateNewYearEvent`, que valida versiones, cupo y lugares
en una transacción. El tope inicial es de 176 cubiertos y el administrador puede
reducirlo. Los pendientes no descuentan cupo y la cancelación conserva el pago
registrado. El 2 de enero de 2027 a las 00:00 de Ushuaia se oculta la pestaña y se
cierran las modificaciones. Los registros permanecen guardados para el equipo.

## Modelo de reserva

```json
{
  "companyId": "hrc-ushuaia",
  "name": "Nombre del cliente",
  "peopleCount": 4,
  "date": "2026-07-21",
  "time": "20:30",
  "contact": "+54 9 2901 ...",
  "comments": "Observaciones",
  "source": "manual",
  "expiresAt": "Timestamp: fecha/hora de reserva + 24 h"
}
```

Los documentos anteriores que no tengan `expiresAt` también son eliminados correctamente: la función programada calcula el vencimiento usando `date` y `time`.

## Desarrollo y validación

```bash
cd functions
npm install
npm run check
npm test
```

Para validar el proyecto completo con Firebase CLI:

```bash
firebase emulators:exec --only firestore "npm --prefix functions test"
```

## Despliegue

```bash
firebase deploy --only hosting,firestore:rules,firestore:indexes,functions
```

El proyecto Firebase configurado es `hrc-reserve` y la región de Functions existente es `us-central1`.
