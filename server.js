require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-in-production";

const resend = process.env.RESEND_API_KEY 
  ? new Resend(process.env.RESEND_API_KEY) 
  : null;

app.use(cors());
app.use(express.json());

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

// ==================== IMPROVED EMAIL FUNCTION ====================
async function sendEmail(to, subject, message) {
  if (!resend || !process.env.RESEND_API_KEY) {
    console.log("📧 Email skipped: RESEND_API_KEY not configured");
    return { sent: false, reason: "RESEND_API_KEY is not set" };
  }
  if (!to) {
    console.log("📧 Email skipped: No recipient email");
    return { sent: false, reason: "Recipient email missing" };
  }

  const from = process.env.RESEND_FROM || "CareFlow <onboarding@resend.dev>";
  
  console.log(`📧 Attempting to send email | From: ${from} | To: ${to} | Subject: ${subject}`);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: subject || "CareFlow Notification",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">${subject}</h2>
          <p>${message}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <small style="color: #64748b;">This is an automated message from CareFlow Appointment System.</small>
        </div>
      `,
    });

    if (error) {
      console.error("❌ Resend API Error:", error);
      return { sent: false, reason: error.message || "Resend API error" };
    }

    console.log("✅ Email sent successfully! ID:", data?.id);
    return { sent: true, id: data?.id };
  } catch (e) {
    console.error("❌ Email Exception:", e);
    return { sent: false, reason: e.message };
  }
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

// Auth routes (unchanged)
app.post("/api/auth/login", async (req, res) => { /* ... same as before ... */ });
app.post("/api/auth/register-patient", async (req, res) => { /* ... same ... */ });
app.post("/api/auth/forgot-password", async (req, res) => { /* ... same ... */ });

// Patients, Appointments, etc. (most routes unchanged, only email calls updated)

app.get("/api/patients", authRequired, async (_, res) => { /* ... */ });
app.post("/api/patients", authRequired, async (req, res) => { /* ... */ });
app.delete("/api/patients/:id", authRequired, async (req, res) => { /* ... */ });

app.get("/api/appointments", authRequired, async (_, res) => { /* ... */ });

app.post("/api/appointments", authRequired, async (req, res) => {
  try {
    const { patientId, patientName, appointmentDate, status } = req.body || {};
    const err = validateAppointmentDate(appointmentDate);
    if (err) return res.status(400).json({ error: err });

    // ... existing logic to create appointment ...

    const r = await pool.query(/* insert query */);

    let emailResult = { sent: false, reason: "No patient email" };
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
    console.error(e);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

app.post("/api/email/send", authRequired, async (req, res) => {
  try {
    const { patientId, subject, message } = req.body || {};
    if (!patientId || !message)
      return res.status(400).json({ error: "patientId and message are required" });

    const p = await pool.query("SELECT email, name FROM patients WHERE id=$1 LIMIT 1", [patientId]);
    if (!p.rows.length || !p.rows[0].email)
      return res.status(404).json({ error: "Patient email not found" });

    const emailResult = await sendEmail(
      p.rows[0].email,
      subject || "CareFlow Notification",
      message
    );

    res.status(201).json({
      message: emailResult.sent ? "Email sent successfully" : "Email request processed",
      emailSent: emailResult.sent,
      emailReason: emailResult.reason || null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Patient self-service routes (similar updates applied)
app.get("/api/patient/profile", authRequired, async (req, res) => { /* ... */ });
app.get("/api/patient/appointments", authRequired, async (req, res) => { /* ... */ });

app.post("/api/patient/appointments", authRequired, async (req, res) => {
  // ... same logic with improved sendEmail call ...
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
