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

// ==================== BREVO SMTP (Email) ====================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
});

async function sendEmail(to, subject, message) {
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    console.log("📧 Email skipped - Brevo SMTP not configured");
    return { sent: false, reason: "Brevo SMTP not configured" };
  }
  if (!to) return { sent: false, reason: "Recipient email missing" };

  try {
    const info = await transporter.sendMail({
      from: `"CareFlow" <${process.env.BREVO_FROM_EMAIL || "no-reply@careflow.example.com"}>`,
      to: to,
      subject: subject || "CareFlow Notification",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>${subject}</h2><p>${message}</p></div>`,
    });
    console.log("✅ Email sent successfully!");
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
  // ... your original initDb code (unchanged) ...
  await pool.query(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT NOT NULL,email TEXT,phone TEXT,condition TEXT,diagnosis TEXT)`);
  // (keep the rest of your initDb exactly as it was)
  // I kept it short here - copy your original initDb if needed
}

// ==================== ROUTES (all your original routes) ====================
app.get("/", (_, res) => res.json({ service: "CareFlow Backend", status: "ok" }));

// Login, Register, etc. (keep all your existing routes)
app.post("/api/auth/login", async (req, res) => { /* your original login code */ });
app.post("/api/auth/register-patient", async (req, res) => { /* your original */ });
app.post("/api/auth/forgot-password", async (req, res) => { /* your original */ });

app.get("/api/patients", authRequired, async (_, res) => { /* your original */ });
app.post("/api/patients", authRequired, async (req, res) => { /* your original */ });
app.delete("/api/patients/:id", authRequired, async (req, res) => { /* your original */ });

app.get("/api/appointments", authRequired, async (_, res) => { /* your original */ });
app.post("/api/appointments", authRequired, async (req, res) => { /* your original + sendEmail */ });
app.patch("/api/appointments/:id/status", authRequired, async (req, res) => { /* your original */ });

app.post("/api/email/send", authRequired, async (req, res) => { /* your original + sendEmail */ });

app.get("/api/patient/profile", authRequired, async (req, res) => { /* your original */ });
app.get("/api/patient/appointments", authRequired, async (req, res) => { /* your original */ });
app.post("/api/patient/appointments", authRequired, async (req, res) => { /* your original + sendEmail */ });

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
