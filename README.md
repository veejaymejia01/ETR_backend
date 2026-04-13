# Healthcare Portal Backend

Ready-to-deploy Express backend for your Healthcare Portal frontend.

## Demo login

Admin:
- email: `admin@hospital.com`
- password: `admin123`

Doctor:
- email: `doctor@hospital.com`
- password: `doctor123`

## Endpoints

- `POST /api/auth/login`
- `GET /api/patients`
- `POST /api/patients`
- `PATCH /api/patients/:id`
- `GET /api/records/:patientId`
- `GET /api/appointments`
- `POST /api/appointments`
- `PATCH /api/appointments/:id/status`
- `GET /api/billing/invoices`
- `POST /api/billing/invoices`
- `GET /api/notifications`
- `POST /api/notifications/send`

## Run locally

```bash
npm install
npm start
```

## Deploy on Render

Create a new **Web Service** from this repo and use:

- Build Command: `npm install`
- Start Command: `npm start`

The included `render.yaml` can also be used for Blueprint deploys.

## Environment variables

Set:

- `JWT_SECRET` = any strong secret string
- `PORT` = `3000` (optional)

## Frontend connection

After deployment, replace this line in your frontend `app.js`:

```js
const API = 'https://your-backend-url.onrender.com/api';
```
