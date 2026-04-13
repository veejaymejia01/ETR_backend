require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace-this-in-production';

app.use(cors());
app.use(express.json());

const users = [
  {
    id: 'U1001',
    email: 'admin@hospital.com',
    password: 'admin123',
    role: 'admin',
    name: 'System Admin',
  },
  {
    id: 'U1002',
    email: 'doctor@hospital.com',
    password: 'doctor123',
    role: 'doctor',
    name: 'Doctor User',
  },
];

function genId(prefix) {
  return `${prefix}${Date.now()}`;
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      condition TEXT,
      diagnosis TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      status TEXT DEFAULT 'Scheduled'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      invoice TEXT NOT NULL,
      amount NUMERIC NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

  const patientCount = await pool.query('SELECT COUNT(*)::int AS count FROM patients');
  if (patientCount.rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO patients (id, name, phone, condition, diagnosis)
      VALUES
        ($1, $2, $3, $4, $5),
        ($6, $7, $8, $9, $10),
        ($11, $12, $13, $14, $15)
      `,
      [
        'P1001',
        'Maria Santos',
        '09171234567',
        'Hypertension',
        'Stage 1 hypertension',
        'P1002',
        'John Reyes',
        '09179876543',
        'Dermatitis',
        'Skin inflammation',
        'P1003',
        'Ana Cruz',
        '09170001111',
        'Checkup',
        'Routine follow-up',
      ]
    );
  }

  const today = new Date().toISOString().split('T')[0];

  const appointmentCount = await pool.query('SELECT COUNT(*)::int AS count FROM appointments');
  if (appointmentCount.rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO appointments (id, patient_name, appointment_date, status)
      VALUES
        ($1, $2, $3, $4),
        ($5, $6, $7, $8),
        ($9, $10, $11, $12)
      `,
      [
        'A1001',
        'Maria Santos',
        `${today} 09:00`,
        'Scheduled',
        'A1002',
        'John Reyes',
        `${today} 11:30`,
        'Scheduled',
        'A1003',
        'Ana Cruz',
        `${today} 14:00`,
        'Done',
      ]
    );
  }

  const billCount = await pool.query('SELECT COUNT(*)::int AS count FROM bills');
  if (billCount.rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO bills (id, patient_id, patient_name, invoice, amount)
      VALUES
        ($1, $2, $3, $4, $5),
        ($6, $7, $8, $9, $10)
      `,
      [
        'B1001',
        'P1001',
        'Maria Santos',
        'INV-2001',
        2500,
        'B1002',
        'P1002',
        'John Reyes',
        'INV-2002',
        1800,
      ]
    );
  }

  const notificationCount = await pool.query('SELECT COUNT(*)::int AS count FROM notifications');
  if (notificationCount.rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO notifications (id, patient_name, type, message, status)
      VALUES
        ($1, $2, $3, $4, $5),
        ($6, $7, $8, $9, $10)
      `,
      [
        'N1001',
        'Maria Santos',
        'SMS',
        `Your appointment is confirmed for ${today} 09:00.`,
        'Sent',
        'N1002',
        'John Reyes',
        'SMS',
        'Please review your updated consultation details via SMS.',
        'Sent',
      ]
    );
  }
}

app.get('/', async (_req, res) => {
  res.json({ service: 'Healthcare Portal Backend', status: 'ok' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.find((u) => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
  });
});

app.get('/api/patients', authRequired, async (_req, res) => {
  const result = await pool.query('SELECT * FROM patients ORDER BY name');
  res.json(result.rows);
});

app.post('/api/patients', authRequired, async (req, res) => {
  const { name, phone, condition, diagnosis } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const id = genId('P');
  const result = await pool.query(
    `
    INSERT INTO patients (id, name, phone, condition, diagnosis)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      id,
      name,
      phone || 'N/A',
      condition || 'General',
      diagnosis || 'Pending assessment',
    ]
  );

  res.status(201).json(result.rows[0]);
});

app.patch('/api/patients/:id', authRequired, async (req, res) => {
  const { name, phone, condition, diagnosis } = req.body || {};

  const result = await pool.query(
    `
    UPDATE patients
    SET name = $1,
        phone = $2,
        condition = $3,
        diagnosis = $4
    WHERE id = $5
    RETURNING *
    `,
    [name, phone, condition, diagnosis, req.params.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.json(result.rows[0]);
});

app.get('/api/records/:patientId', authRequired, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM patients WHERE id = $1',
    [req.params.patientId]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Record not found' });
  }

  const patient = result.rows[0];
  res.json({
    patientId: patient.id,
    diagnosis: patient.diagnosis,
    condition: patient.condition,
    phone: patient.phone,
  });
});

app.get('/api/appointments', authRequired, async (_req, res) => {
  const result = await pool.query(`
    SELECT
      id,
      patient_name AS "patientName",
      appointment_date AS "appointmentDate",
      status
    FROM appointments
    ORDER BY appointment_date
  `);
  res.json(result.rows);
});

app.post('/api/appointments', authRequired, async (req, res) => {
  const { patientName, appointmentDate, status } = req.body || {};

  if (!patientName || !appointmentDate) {
    return res.status(400).json({ error: 'patientName and appointmentDate are required' });
  }

  const id = genId('A');
  const result = await pool.query(
    `
    INSERT INTO appointments (id, patient_name, appointment_date, status)
    VALUES ($1, $2, $3, $4)
    RETURNING
      id,
      patient_name AS "patientName",
      appointment_date AS "appointmentDate",
      status
    `,
    [id, patientName, appointmentDate, status || 'Scheduled']
  );

  res.status(201).json(result.rows[0]);
});

app.patch('/api/appointments/:id/status', authRequired, async (req, res) => {
  const result = await pool.query(
    `
    UPDATE appointments
    SET status = $1
    WHERE id = $2
    RETURNING
      id,
      patient_name AS "patientName",
      appointment_date AS "appointmentDate",
      status
    `,
    [req.body?.status || 'Scheduled', req.params.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  res.json(result.rows[0]);
});

app.get('/api/billing/invoices', authRequired, async (_req, res) => {
  const result = await pool.query('SELECT * FROM bills ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/billing/invoices', authRequired, async (req, res) => {
  const { patientId, patientName, invoice, amount } = req.body || {};

  if (!patientId || !invoice || amount == null) {
    return res.status(400).json({ error: 'patientId, invoice, and amount are required' });
  }

  const id = genId('B');
  const result = await pool.query(
    `
    INSERT INTO bills (id, patient_id, patient_name, invoice, amount)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [id, patientId, patientName || 'Unknown Patient', invoice, amount]
  );

  res.status(201).json(result.rows[0]);
});

app.get('/api/notifications', authRequired, async (_req, res) => {
  const result = await pool.query('SELECT * FROM notifications ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/notifications/send', authRequired, async (req, res) => {
  const { patientName, patientId, message } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const id = genId('N');
  const result = await pool.query(
    `
    INSERT INTO notifications (id, patient_name, type, message, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [id, patientName || patientId || 'Unknown', 'SMS', message, 'Sent']
  );

  res.status(201).json(result.rows[0]);
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Healthcare backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
}

start();
