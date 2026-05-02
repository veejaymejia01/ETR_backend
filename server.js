require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-in-production";

app.use(cors());
app.use(express.json());

// ==================== BREVO SMTP EMAIL ====================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
  connectionTimeout: 10000,   // 10 seconds
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

async function sendEmail(to, subject, message) {
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    console.log("📧 Email skipped: Brevo SMTP not configured");
    return { sent: false, reason: "Brevo SMTP credentials missing" };
  }
  if (!to) return { sent: false, reason: "Recipient email missing" };

  try {
    const info = await transporter.sendMail({
      from: `"CareFlow" <${process.env.BREVO_FROM_EMAIL || "no-reply@careflow.example.com"}>`,
      to: to,
      subject: subject || "CareFlow Notification",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>${subject}</h2><p>${message}</p></div>`,
    });
    console.log("✅ Email sent via Brevo!");
    return { sent: true };
  } catch (e) {
    console.error("❌ Brevo Error:", e.message);
    return { sent: false, reason: e.message };
  }
}

// ==================== HELPER FUNCTIONS ====================
function genId(p) {
  return `${p}${Date.now()}`;
}

function signUser(u) {
  return jwt.sign({ sub: u.id, email: u.email, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: "8h" });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function validateAppointmentDate(v) {
  if (!v) return "appointmentDate is required";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "Invalid appointment date";
  const day = d.getDay(), h = d.getHours(), m = d.getMinutes();
  if (day === 0 || day === 6) return "Appointments are only allowed Monday to Friday";
  if (h < 8 || h > 18 || (h === 18 && m > 0)) return "Appointments are only allowed from 8:00 AM to 6:00 PM";
  return "";
}

// ==================== INIT DB ====================
async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT NOT NULL,email TEXT,phone TEXT,condition TEXT,diagnosis TEXT)`);
  for (const c of ["user_id TEXT","email TEXT","phone TEXT","condition TEXT","diagnosis TEXT"])
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS ${c}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,patient_id TEXT,patient_name TEXT NOT NULL,appointment_date TEXT NOT NULL,status TEXT DEFAULT 'Scheduled')`);
  await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,patient_name TEXT NOT NULL,invoice TEXT NOT NULL,amount NUMERIC NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,patient_name TEXT NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL)`);

  // Demo accounts
  const a = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", ["admin@hospital.com"]);
  if (!a.rows.length)
    await pool.query("INSERT INTO users(id,email,password,role,name) VALUES($1,$2,$3,$4,$5)", ["U1001", "admin@hospital.com", "admin123", "admin", "System Admin"]);

  const d = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", ["doctor@hospital.com"]);
  if (!d.rows.length)
    await pool.query("INSERT INTO users(id,email,password,role,name) VALUES($1,$2,$3,$4,$5)", ["U1002", "doctor@hospital.com", "doctor123", "doctor", "Doctor User"]);
}

// ==================== ROUTES ====================
app.get("/", (_, res) => res.json({ service: "CareFlow Backend", status: "ok" }));

app.get("/test-db", async (_, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ status: "database connected", time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const r = await pool.query("SELECT * FROM users WHERE email=$1 AND password=$2 LIMIT 1", [email, password]);
    if (!r.rows.length) return res.status(401).json({ error: "Invalid email or password" });
    const u = r.rows[0];
    res.json({ token: signUser(u), user: { id: u.id, email: u.email, role: u.role, name: u.name } });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/register-patient", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "name, email, and password are required" });
    const ex = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", [email]);
    if (ex.rows.length) return res.status(400).json({ error: "Email already registered" });
    const userId = genId("U"), patientId = genId("P");
    await pool.query("INSERT INTO users(id,email,password,role,name) VALUES($1,$2,$3,$4,$5)", [userId, email, password, "patient", name]);
    await pool.query("INSERT INTO patients(id,user_id,name,email,phone,condition,diagnosis) VALUES($1,$2,$3,$4,$5,$6,$7)", [patientId, userId, name, email, phone || "N/A", "General", "Pending assessment"]);
    res.status(201).json({ message: "Patient registered successfully" });
  } catch {
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    const u = await pool.query("SELECT * FROM users WHERE email=$1 LIMIT 1", [email]);
    if (!u.rows.length) return res.status(404).json({ error: "Email not found" });
    const er = await sendEmail(email, "CareFlow Password Reset", `Hello ${u.rows[0].name}, please contact the system administrator to reset your password.`);
    res.json({ message: "Password reset request processed", emailSent: er.sent, emailReason: er.reason || null });
  } catch {
    res.status(500).json({ error: "Failed to process forgot password request" });
  }
});

app.get("/api/patients", authRequired, async (_, res) => {
  try {
    const r = await pool.query("SELECT * FROM patients ORDER BY name");
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch patients" });
  }
});

app.post("/api/patients", authRequired, async (req, res) => {
  try {
    const { name, email, phone, condition, diagnosis } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const id = genId("P");
    const r = await pool.query("INSERT INTO patients(id,name,email,phone,condition,diagnosis) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [id, name, email || null, phone || "N/A", condition || "General", diagnosis || "Pending assessment"]);
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create patient" });
  }
});

app.delete("/api/patients/:id", authRequired, async (req, res) => {
  try {
    const id = req.params.id;
    const pr = await pool.query("SELECT * FROM patients WHERE id=$1", [id]);
    if (!pr.rows.length) return res.status(404).json({ error: "Patient not found" });
    const p = pr.rows[0];
    await pool.query("DELETE FROM appointments WHERE patient_id=$1 OR patient_name=$2", [id, p.name]);
    await pool.query("DELETE FROM bills WHERE patient_id=$1", [id]);
    await pool.query("DELETE FROM notifications WHERE patient_name=$1", [p.name]);
    await pool.query("DELETE FROM patients WHERE id=$1", [id]);
    if (p.user_id) await pool.query("DELETE FROM users WHERE id=$1", [p.user_id]);
    res.json({ message: "Patient deleted successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to delete patient" });
  }
});

app.get("/api/appointments", authRequired, async (_, res) => {
  try {
    const r = await pool.query(`SELECT id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status FROM appointments ORDER BY appointment_date`);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

app.post("/api/appointments", authRequired, async (req, res) => {
  try {
    const { patientId, patientName, appointmentDate, status } = req.body || {};
    const err = validateAppointmentDate(appointmentDate);
    if (err) return res.status(400).json({ error: err });
    if (!patientName && !patientId) return res.status(400).json({ error: "patientName or patientId is required" });
    let patient = null;
    if (patientId) {
      const r = await pool.query("SELECT * FROM patients WHERE id=$1 LIMIT 1", [patientId]);
      patient = r.rows[0] || null;
    }
    if (!patient && patientName) {
      const r = await pool.query("SELECT * FROM patients WHERE LOWER(name)=LOWER($1) LIMIT 1", [patientName]);
      patient = r.rows[0] || null;
    }
    const id = genId("A"), finalName = patient ? patient.name : patientName;
    const r = await pool.query(`INSERT INTO appointments(id,patient_id,patient_name,appointment_date,status) VALUES($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status`, [id, patient ? patient.id : null, finalName, appointmentDate, status || "Scheduled"]);
    let er = { sent: false };
    if (patient && patient.email) er = await sendEmail(patient.email, "Appointment Confirmed", `Hello ${patient.name}, your appointment is scheduled for ${appointmentDate}.`);
    res.status(201).json({ ...r.rows[0], emailSent: er.sent, emailReason: er.reason || null });
  } catch {
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

app.patch("/api/appointments/:id/status", authRequired, async (req, res) => {
  try {
    const r = await pool.query(`UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status`, [req.body?.status || "Scheduled", req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Appointment not found" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update appointment status" });
  }
});

app.post("/api/email/send", authRequired, async (req, res) => {
  try {
    const { patientId, subject, message } = req.body || {};
    if (!patientId || !message) return res.status(400).json({ error: "patientId and message are required" });
    const p = await pool.query("SELECT email,name FROM patients WHERE id=$1 LIMIT 1", [patientId]);
    if (!p.rows.length || !p.rows[0].email) return res.status(404).json({ error: "Patient email not found" });
    const er = await sendEmail(p.rows[0].email, subject || "CareFlow Notification", message);
    res.status(201).json({ message: er.sent ? "Email sent successfully" : "Email was not sent", emailSent: er.sent, emailReason: er.reason || null });
  } catch {
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.get("/api/patient/profile", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient") return res.status(403).json({ error: "Forbidden" });
    const r = await pool.query("SELECT * FROM patients WHERE user_id=$1 LIMIT 1", [req.user.sub]);
    if (!r.rows.length) return res.status(404).json({ error: "Patient profile not found" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch patient profile" });
  }
});

app.get("/api/patient/appointments", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient") return res.status(403).json({ error: "Forbidden" });
    const p = await pool.query("SELECT * FROM patients WHERE user_id=$1 LIMIT 1", [req.user.sub]);
    if (!p.rows.length) return res.status(404).json({ error: "Patient profile not found" });
    const r = await pool.query(`SELECT id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status FROM appointments WHERE patient_id=$1 ORDER BY appointment_date`, [p.rows[0].id]);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch patient appointments" });
  }
});

app.post("/api/patient/appointments", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient") return res.status(403).json({ error: "Forbidden" });
    const { appointmentDate } = req.body || {};
    const err = validateAppointmentDate(appointmentDate);
    if (err) return res.status(400).json({ error: err });
    const p = await pool.query("SELECT * FROM patients WHERE user_id=$1 LIMIT 1", [req.user.sub]);
    if (!p.rows.length) return res.status(404).json({ error: "Patient profile not found" });
    const patient = p.rows[0], id = genId("A");
    const r = await pool.query(`INSERT INTO appointments(id,patient_id,patient_name,appointment_date,status) VALUES($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status`, [id, patient.id, patient.name, appointmentDate, "Scheduled"]);
    let er = { sent: false };
    if (patient.email) er = await sendEmail(patient.email, "Appointment Confirmed", `Hello ${patient.name}, your appointment is scheduled for ${appointmentDate}.`);
    res.status(201).json({ ...r.rows[0], emailSent: er.sent, emailReason: er.reason || null });
  } catch {
    res.status(500).json({ error: "Failed to create patient appointment" });
  }
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => console.log(`🚀 CareFlow backend running on port ${PORT}`));
  } catch (e) {
    console.error("Startup failed:", e);
    process.exit(1);
  }
}

start();
