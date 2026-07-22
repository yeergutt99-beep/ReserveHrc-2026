# HRC Reserve

Panel de reservas de Hard Rock Cafe Ushuaia construido con Firebase Authentication, Firestore, Cloud Functions y Hosting.

## Funciones principales

- Acceso del equipo con Firebase Authentication.
- Agenda en tiempo real sobre `companies/{companyId}/reservations`.
- Alta y edición de reservas.
- Eliminación manual disponible para administradores, con confirmación.
- Búsqueda por nombre, contacto u observaciones.
- Vista diaria o de todas las próximas reservas.
- Identificación de reservas manuales y originadas por Sofía/WhatsApp.
- Creación de usuarios desde el panel de administración.
- Resumen diario por correo.
- Limpieza automática cada hora: elimina una reserva cuando ya pasaron 24 horas desde su fecha y hora.

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
