require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace-this-in-production';

app.use(cors());
app.use(express.json());

const users = [
  { id: 'U1001', email: 'admin@hospital.com', password: 'admin123', role: 'admin', name: 'System Admin' },
  { id: 'U1002', email: 'doctor@hospital.com', password: 'doctor123', role: 'doctor', name: 'Doctor User' }
];

const patients = [
  { id: 'P1001', name: 'Maria Santos', phone: '09171234567', condition: 'Hypertension', diagnosis: 'Stage 1 hypertension' },
  { id: 'P1002', name: 'John Reyes', phone: '09179876543', condition: 'Dermatitis', diagnosis: 'Skin inflammation' },
  { id: 'P1003', name: 'Ana Cruz', phone: '09170001111', condition: 'Checkup', diagnosis: 'Routine follow-up' }
];

function todayDateString() { return new Date().toISOString().split('T')[0]; }

const appointments = [
  { id: 'A1001', patientName: 'Maria Santos', appointmentDate: `${todayDateString()} 09:00`, status: 'Scheduled' },
  { id: 'A1002', patientName: 'John Reyes', appointmentDate: `${todayDateString()} 11:30`, status: 'Scheduled' },
  { id: 'A1003', patientName: 'Ana Cruz', appointmentDate: `${todayDateString()} 14:00`, status: 'Done' }
];

const bills = [
  { id: 'B1001', invoice: 'INV-2001', amount: 2500, patientId: 'P1001', patientName: 'Maria Santos' },
  { id: 'B1002', invoice: 'INV-2002', amount: 1800, patientId: 'P1002', patientName: 'John Reyes' }
];

const notifications = [
  { id: 'N1001', patientName: 'Maria Santos', type: 'SMS', message: `Your appointment is confirmed for ${todayDateString()} 09:00.`, status: 'Sent' },
  { id: 'N1002', patientName: 'John Reyes', type: 'SMS', message: 'Please review your updated consultation details via SMS.', status: 'Sent' }
];

function genId(prefix) { return `${prefix}${Date.now()}`; }

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/', (req, res) => res.json({ service: 'Healthcare Portal Backend', status: 'ok' }));

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

app.get('/api/patients', authRequired, (req, res) => res.json(patients));

app.post('/api/patients', authRequired, (req, res) => {
  const { name, phone, condition, diagnosis } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const newPatient = {
    id: genId('P'),
    name,
    phone: phone || 'N/A',
    condition: condition || 'General',
    diagnosis: diagnosis || 'Pending assessment'
  };
  patients.unshift(newPatient);
  res.status(201).json(newPatient);
});

app.patch('/api/patients/:id', authRequired, (req, res) => {
  const index = patients.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Patient not found' });
  patients[index] = { ...patients[index], ...req.body, id: patients[index].id };
  res.json(patients[index]);
});

app.get('/api/records/:patientId', authRequired, (req, res) => {
  const patient = patients.find((p) => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Record not found' });
  res.json({
    patientId: patient.id,
    diagnosis: patient.diagnosis,
    condition: patient.condition,
    phone: patient.phone
  });
});

app.get('/api/appointments', authRequired, (req, res) => res.json(appointments));

app.post('/api/appointments', authRequired, (req, res) => {
  const { patientName, appointmentDate, status } = req.body || {};
  if (!patientName || !appointmentDate) {
    return res.status(400).json({ error: 'patientName and appointmentDate are required' });
  }
  const newAppointment = { id: genId('A'), patientName, appointmentDate, status: status || 'Scheduled' };
  appointments.unshift(newAppointment);
  res.status(201).json(newAppointment);
});

app.patch('/api/appointments/:id/status', authRequired, (req, res) => {
  const appointment = appointments.find((a) => a.id === req.params.id);
  if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
  appointment.status = req.body?.status || appointment.status;
  res.json(appointment);
});

app.get('/api/billing/invoices', authRequired, (req, res) => res.json(bills));

app.post('/api/billing/invoices', authRequired, (req, res) => {
  const { patientId, patientName, invoice, amount } = req.body || {};
  if (!patientId || !invoice || amount == null) {
    return res.status(400).json({ error: 'patientId, invoice, and amount are required' });
  }
  const newBill = { id: genId('B'), patientId, patientName: patientName || 'Unknown Patient', invoice, amount };
  bills.unshift(newBill);
  res.status(201).json(newBill);
});

app.get('/api/notifications', authRequired, (req, res) => res.json(notifications));

app.post('/api/notifications/send', authRequired, (req, res) => {
  const { patientName, patientId, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  const newNotification = {
    id: genId('N'),
    patientName: patientName || patientId || 'Unknown',
    type: 'SMS',
    message,
    status: 'Sent'
  };
  notifications.unshift(newNotification);
  res.status(201).json(newNotification);
});

app.listen(PORT, () => {
  console.log(`Healthcare backend running on port ${PORT}`);
});
