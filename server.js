require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-in-production";

app.use(cors());
app.use(express.json());

// ==================== BREVO EMAIL FUNCTION ====================
const brevoApiKey = process.env.BREVO_API_KEY;
const brevoFromEmail = process.env.BREVO_FROM_EMAIL || "no-reply@careflow.example.com";
const brevoFromName = process.env.BREVO_FROM_NAME || "CareFlow";

async function sendEmail(to, subject, message) {
  if (!brevoApiKey) {
    console.log("📧 Email skipped: BREVO_API_KEY not set");
    return { sent: false, reason: "BREVO_API_KEY is not configured" };
  }
  if (!to) {
    return { sent: false, reason: "Recipient email missing" };
  }

  console.log(`📧 Sending via Brevo to ${to} | Subject: ${subject}`);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: brevoFromName, email: brevoFromEmail },
        to: [{ email: to }],
        subject: subject || "CareFlow Notification",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>${subject}</h2>
            <p>${message}</p>
            <hr>
            <small>This is an automated message from CareFlow Appointment System.</small>
          </div>
        `,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log("✅ Email sent successfully via Brevo");
      return { sent: true };
    } else {
      console.error("❌ Brevo Error:", data);
      return { sent: false, reason: data.message || "Brevo API error" };
    }
  } catch (e) {
    console.error("❌ Email Exception:", e);
    return { sent: false, reason: e.message };
  }
}

// ==================== Other code remains the same ====================

function genId(p) { return `${p}${Date.now()}`; }

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

// ... (rest of your routes - login, patients, appointments, etc. stay the same)

app.post("/api/appointments", authRequired, async (req, res) => {
  // ... your existing code ...
  // When sending email:
  const emailResult = patient?.email 
    ? await sendEmail(patient.email, "Appointment Confirmed", `Hello ${patient.name}, your appointment is scheduled for ${appointmentDate}.`)
    : { sent: false };

  res.status(201).json({
    ...r.rows[0],
    emailSent: emailResult.sent,
    emailReason: emailResult.reason || null
  });
});

// Same for /api/email/send and patient appointments

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => console.log(`🚀 CareFlow backend running on port ${PORT}`));
  } catch (e) {
    console.error("Startup failed:", e);
  }
}

start();
