require('dotenv').config();

const { Resend } = require('resend');
const resend = new Resend(process.env.re_aFWBtNi8_762Stpsde1sNdbaKUtExyGnZ);

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

await pool.query(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    condition TEXT,
    diagnosis TEXT
  )
`);
await pool.query(`
  ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email TEXT
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
}

app.get('/', (_req, res) => {
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
  try {
    const result = await pool.query('SELECT * FROM patients ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

app.post('/api/patients', authRequired, async (req, res) => {
  try {
    const { name, email, phone, condition, diagnosis } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const id = genId('P');
    const result = await pool.query(
      `
      INSERT INTO patients (id, name, email, phone, condition, diagnosis)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        id,
        name,
        email || null,
        phone || 'N/A',
        condition || 'General',
        diagnosis || 'Pending assessment',
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

app.patch('/api/patients/:id', authRequired, async (req, res) => {
  try {
    const { name, email, phone, condition, diagnosis } = req.body || {};

    const result = await pool.query(
      `
      UPDATE patients
      SET name = $1,
          email = $2,
          phone = $3,
          condition = $4,
          diagnosis = $5
      WHERE id = $6
      RETURNING *
      `,
      [name, email, phone, condition, diagnosis, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

app.get('/api/records/:patientId', authRequired, async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch record' });
  }
});

app.get('/api/appointments', authRequired, async (_req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

app.post('/api/appointments', authRequired, async (req, res) => {
  try {
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

    const patientResult = await pool.query(
      `SELECT email, name FROM patients WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [patientName]
    );

    if (patientResult.rows.length && patientResult.rows[0].email) {
      await sendEmail(
        patientResult.rows[0].email,
        'Appointment Confirmed',
        `Hello ${patientResult.rows[0].name}, your appointment is scheduled for ${appointmentDate}.`
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

app.patch('/api/appointments/:id/status', authRequired, async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to update appointment status' });
  }
});

app.get('/api/billing/invoices', authRequired, async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bills ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

app.post('/api/billing/invoices', authRequired, async (req, res) => {
  try {
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

    const patientResult = await pool.query(
      `SELECT email, name FROM patients WHERE id = $1 LIMIT 1`,
      [patientId]
    );

    if (patientResult.rows.length && patientResult.rows[0].email) {
      await sendEmail(
        patientResult.rows[0].email,
        'New Billing Notice',
        `Hello ${patientResult.rows[0].name}, a new bill (${invoice}) for amount ${amount} has been added to your account.`
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

app.get('/api/notifications', authRequired, async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/send', authRequired, async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notification' });
  }
});
app.post('/api/email/send', authRequired, async (req, res) => {
  try {
    const { patientId, subject, message } = req.body || {};

    if (!patientId || !message) {
      return res.status(400).json({ error: 'patientId and message are required' });
    }

    const patientResult = await pool.query(
      `SELECT email, name FROM patients WHERE id = $1 LIMIT 1`,
      [patientId]
    );

    if (!patientResult.rows.length || !patientResult.rows[0].email) {
      return res.status(404).json({ error: 'Patient email not found' });
    }

    await sendEmail(
      patientResult.rows[0].email,
      subject || 'Healthcare Notification',
      message
    );

    res.status(201).json({ message: 'Email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email' });
  }
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

app.delete('/api/patients/:id', authRequired, async (req, res) => {
  try {
    const patientId = req.params.id;

    await pool.query('DELETE FROM appointments WHERE patient_name IN (SELECT name FROM patients WHERE id=$1)', [patientId]);
    await pool.query('DELETE FROM bills WHERE patient_id = $1', [patientId]);
    await pool.query('DELETE FROM notifications WHERE patient_name IN (SELECT name FROM patients WHERE id=$1)', [patientId]);

    const result = await pool.query(
      'DELETE FROM patients WHERE id = $1 RETURNING *',
      [patientId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({ message: 'Patient and related data deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

async function sendEmail(to, subject, message) {
  if (!process.env.re_aFWBtNi8_762Stpsde1sNdbaKUtExyGnZ) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const { data, error } = await resend.emails.send({
    from: 'Healthcare Portal <onboarding@resend.dev>',
    to: [to],
    subject,
    html: `<div style="font-family: Arial, sans-serif;">
      <h2>${subject}</h2>
      <p>${message}</p>
    </div>`
  });

  if (error) {
    throw new Error(error.message || 'Email send failed');
  }

  return data;
}


