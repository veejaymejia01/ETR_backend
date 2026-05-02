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

// ==================== BREVO SMTP TRANSPORTER ====================
const transporter = nodemailer.createTransporter({
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
    console.log("📧 Email skipped: Brevo SMTP credentials not set");
    return { sent: false, reason: "Brevo SMTP not configured" };
  }

  try {
    const info = await transporter.sendMail({
      from: `"CareFlow" <${process.env.BREVO_FROM_EMAIL || "no-reply@careflow.example.com"}>`,
      to: to,
      subject: subject || "CareFlow Notification",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px;">
          <h2 style="color: #2563eb;">${subject}</h2>
          <p>${message}</p>
          <hr style="margin: 20px 0;">
          <small style="color: #64748b;">This is an automated message from CareFlow Appointment System.</small>
        </div>
      `,
    });

    console.log("✅ Email sent successfully! ID:", info.messageId);
    return { sent: true };
  } catch (e) {
    console.error("❌ Brevo SMTP Error:", e);
    return { sent: false, reason: e.message };
  }
}

// ==================== HELPER FUNCTIONS ====================
function genId(p) {
  return `${p}${Date.now()}`;
}

function signUser(u) {
  return jwt.sign(
    { sub: u.id, email: u.email, role: u.role, name: u.name },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
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

// ==================== DATABASE INIT ====================
async function initDb() {
  // ... your existing initDb code (keep it as is) ...
}

// ==================== ROUTES ====================
// (Keep all your existing routes, just make sure sendEmail is used)

app.get("/", (_, res) => res.json({ service: "CareFlow Backend", status: "ok" }));

// Example of how to use sendEmail in appointments route:
app.post("/api/appointments", authRequired, async (req, res) => {
  try {
    const { patientId, patientName, appointmentDate } = req.body || {};
    // ... your existing appointment creation logic ...

    const r = await pool.query(/* your insert query */);

    let emailResult = { sent: false };
    if (patient && patient.email) {
      emailResult = await sendEmail(
        patient.email,
        "Appointment Confirmed",
        `Hello ${patient.name}, your appointment is scheduled for <strong>${appointmentDate}</strong>.`
      );
    }

    res.status(201).json({
      ...r.rows[0],
      emailSent: emailResult.sent,
      emailReason: emailResult.reason || null
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

// Add similar updates to /api/email/send and patient routes

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => console.log(`🚀 CareFlow backend running on port ${PORT}`));
  } catch (e) {
    console.error("Startup failed:", e);
  }
}

start();
