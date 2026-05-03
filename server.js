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

// ==================== BREVO SMTP ====================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  tls: { rejectUnauthorized: false }
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

// ==================== HELPERS ====================
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

// ==================== INIT DB (with specializations) ====================
async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT NOT NULL,email TEXT,phone TEXT,condition TEXT,diagnosis TEXT,specialization_id TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,patient_id TEXT,doctor_id TEXT,patient_name TEXT NOT NULL,appointment_date TEXT NOT NULL,status TEXT DEFAULT 'Scheduled',specialization_id TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS specializations(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,description TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,patient_name TEXT NOT NULL,invoice TEXT NOT NULL,amount NUMERIC NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,patient_name TEXT NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL)`);

  // Demo specializations
  const specs = [
    ['SPEC1', 'OB-Gyne', 'Obstetrics and Gynecology'],
    ['SPEC2', 'Dermatology', 'Skin conditions'],
    ['SPEC3', 'Oncology', 'Cancer care'],
    ['SPEC4', 'Neurology', 'Brain and nervous system'],
    ['SPEC5', 'Pediatrics', 'Child health'],
    ['SPEC6', 'Cardiology', 'Heart conditions']
  ];
  for (const [id, name, desc] of specs) {
    await pool.query("INSERT OR IGNORE INTO specializations(id,name,description) VALUES($1,$2,$3)", [id, name, desc]);
  }

  // Demo users
  const a = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", ["admin@hospital.com"]);
  if (!a.rows.length)
    await pool.query("INSERT INTO users(id,email,password,role,name) VALUES($1,$2,$3,$4,$5)", ["U1001", "admin@hospital.com", "admin123", "admin", "System Admin"]);

  const d = await pool.query("SELECT id FROM users WHERE email=$1 LIMIT 1", ["doctor@hospital.com"]);
  if (!d.rows.length)
    await pool.query("INSERT INTO users(id,email,password,role,name) VALUES($1,$2,$3,$4,$5)", ["U1002", "doctor@hospital.com", "doctor123", "doctor", "Doctor User"]);
}

// ==================== ROUTES ====================
app.get("/", (_, res) => res.json({ service: "CareFlow Backend", status: "ok" }));

// Auth routes (login, register, forgot-password) - same as before
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

// Specializations
app.get("/api/specializations", async (_, res) => {
  try {
    const r = await pool.query("SELECT * FROM specializations ORDER BY name");
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch specializations" });
  }
});

// Appointments by specialization
app.get("/api/appointments/specialization/:specId", authRequired, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*, s.name as specialization_name 
      FROM appointments a 
      LEFT JOIN specializations s ON a.specialization_id = s.id 
      WHERE a.specialization_id = $1 
      ORDER BY a.appointment_date`, [req.params.specId]);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

// All appointments (for admin dashboard)
app.get("/api/appointments", authRequired, async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*, s.name as specialization_name 
      FROM appointments a 
      LEFT JOIN specializations s ON a.specialization_id = s.id 
      ORDER BY a.appointment_date`);
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

// Patients
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
    const { name, email, phone, condition, diagnosis, specialization_id } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const id = genId("P");
    const r = await pool.query("INSERT INTO patients(id,name,email,phone,condition,diagnosis,specialization_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [id, name, email || null, phone || "N/A", condition || "General", diagnosis || "Pending assessment", specialization_id]);
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create patient" });
  }
});

// Email Send (unchanged)
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

// Add more routes as needed (doctor scheduling, etc.)

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
