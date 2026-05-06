# ReserveHrc-2026

SaaS de reservas con Firebase (Auth, Firestore, Functions y Reglas de Seguridad).

## Funcionalidades incluidas

- Login con Firebase Auth.
- Listado de reservas con filtro por fecha.
- Alta de reservas con campos:
  - cantidad de personas
  - nombre
  - hora
  - día
  - comentarios
  - `companyId`
- Panel de administrador para crear usuarios.
- Reglas de seguridad multi-tenant por `companyId`.
- Tarea programada diaria a las **15:00 (America/Argentina/Buenos_Aires)** que:
  - envía mail con reservas del día,
  - avisa reservas con más de 15 personas en próximos 20 días.

## Estructura

- `web/`: app frontend (HTML/CSS/JS).
- `functions/`: Cloud Functions v2.
- `firestore.rules`: reglas de seguridad.
- `firestore.indexes.json`: índices para consultas.

## Configuración

1. Instalar dependencias de Cloud Functions:

```bash
cd functions
npm install
```

2. Configurar `web/main.js` con tu `firebaseConfig`.

3. Definir variables para email (en Functions):

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `DIGEST_TO`

4. Desplegar:

```bash
firebase deploy
```

## Modelo sugerido de usuario (`/users/{uid}`)

```json
{
  "companyId": "acme-001",
  "role": "admin",
  "email": "owner@acme.com",
  "displayName": "Owner"
}
```
