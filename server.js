require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const pool = require("./db");
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-in-production";
const resend = process.re_12g72XJo_5CzFjhYyqFVLPXxBt3ZLFwTd
  ? new Resend(process.re_12g72XJo_5CzFjhYyqFVLPXxBt3ZLFwTd)
  : null;
app.use(cors());
app.use(express.json());
function genId(prefix) {
  return `${prefix}${Date.now()}`;
}
function signUser(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "8h" },
  );
}
function authRequired(req, res, next) {
  const a = req.headers.authorization || "";
  const token = a.startsWith("Bearer ") ? a.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
async function sendEmail(to, subject, message) {
  if (!resend) return null;
  const { data, error } = await resend.emails.send({
    from: "Healthcare Portal <onboarding@resend.dev>",
    to: [to],
    subject,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2>${subject}</h2><p>${message}</p></div>`,
  });
  if (error) throw new Error(error.message || "Email send failed");
  return data;
}
async function initDb() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL)`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT NOT NULL,email TEXT,phone TEXT,condition TEXT,diagnosis TEXT)`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY,patient_id TEXT,patient_name TEXT NOT NULL,appointment_date TEXT NOT NULL,status TEXT DEFAULT 'Scheduled')`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bills (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,patient_name TEXT NOT NULL,invoice TEXT NOT NULL,amount NUMERIC NOT NULL)`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,patient_name TEXT NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL)`,
  );
  const admin = await pool.query(
    "SELECT id FROM users WHERE email=$1 LIMIT 1",
    ["admin@hospital.com"],
  );
  if (!admin.rows.length)
    await pool.query(
      "INSERT INTO users (id,email,password,role,name) VALUES ($1,$2,$3,$4,$5)",
      ["U1001", "admin@hospital.com", "admin123", "admin", "System Admin"],
    );
  const doctor = await pool.query(
    "SELECT id FROM users WHERE email=$1 LIMIT 1",
    ["doctor@hospital.com"],
  );
  if (!doctor.rows.length)
    await pool.query(
      "INSERT INTO users (id,email,password,role,name) VALUES ($1,$2,$3,$4,$5)",
      ["U1002", "doctor@hospital.com", "doctor123", "doctor", "Doctor User"],
    );
}
app.get("/", (_req, res) =>
  res.json({ service: "Healthcare Portal Backend", status: "ok" }),
);
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const r = await pool.query(
      "SELECT * FROM users WHERE email=$1 AND password=$2 LIMIT 1",
      [email, password],
    );
    if (!r.rows.length)
      return res.status(401).json({ error: "Invalid email or password" });
    const user = r.rows[0];
    res.json({
      token: signUser(user),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});
app.post("/api/auth/register-patient", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: "name, email, and password are required" });
    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1 LIMIT 1",
      [email],
    );
    if (existing.rows.length)
      return res.status(400).json({ error: "Email already registered" });
    const userId = genId("U");
    const patientId = genId("P");
    await pool.query(
      "INSERT INTO users (id,email,password,role,name) VALUES ($1,$2,$3,$4,$5)",
      [userId, email, password, "patient", name],
    );
    await pool.query(
      "INSERT INTO patients (id,user_id,name,email,phone,condition,diagnosis) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        patientId,
        userId,
        name,
        email,
        phone || "N/A",
        "General",
        "Pending assessment",
      ],
    );
    res.status(201).json({ message: "Patient registered successfully" });
  } catch {
    res.status(500).json({ error: "Registration failed" });
  }
});
app.get("/api/patients", authRequired, async (_req, res) => {
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
    const r = await pool.query(
      "INSERT INTO patients (id,name,email,phone,condition,diagnosis) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        id,
        name,
        email || null,
        phone || "N/A",
        condition || "General",
        diagnosis || "Pending assessment",
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create patient" });
  }
});
app.patch("/api/patients/:id", authRequired, async (req, res) => {
  try {
    const { name, email, phone, condition, diagnosis } = req.body || {};
    const r = await pool.query(
      "UPDATE patients SET name=$1,email=$2,phone=$3,condition=$4,diagnosis=$5 WHERE id=$6 RETURNING *",
      [name, email, phone, condition, diagnosis, req.params.id],
    );
    if (!r.rows.length)
      return res.status(404).json({ error: "Patient not found" });
    const patient = r.rows[0];
    if (patient.user_id)
      await pool.query("UPDATE users SET name=$1,email=$2 WHERE id=$3", [
        patient.name,
        patient.email,
        patient.user_id,
      ]);
    res.json(patient);
  } catch {
    res.status(500).json({ error: "Failed to update patient" });
  }
});
app.delete("/api/patients/:id", authRequired, async (req, res) => {
  try {
    const patientId = req.params.id;

    const patientResult = await pool.query(
      "SELECT * FROM patients WHERE id = $1",
      [patientId]
    );

    if (!patientResult.rows.length) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = patientResult.rows[0];

    await pool.query(
      "DELETE FROM appointments WHERE patient_id = $1 OR patient_name = $2",
      [patientId, patient.name]
    );

    await pool.query(
      "DELETE FROM bills WHERE patient_id = $1",
      [patientId]
    );

    await pool.query(
      "DELETE FROM notifications WHERE patient_name = $1",
      [patient.name]
    );

    await pool.query(
      "DELETE FROM patients WHERE id = $1",
      [patientId]
    );

    if (patient.user_id) {
      await pool.query(
        "DELETE FROM users WHERE id = $1",
        [patient.user_id]
      );
    }

    res.json({ message: "Patient deleted successfully" });
  } catch (error) {
    console.error("Delete patient error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete patient"
    });
  }
});
app.get("/api/records/:patientId", authRequired, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM patients WHERE id=$1", [
      req.params.patientId,
    ]);
    if (!r.rows.length)
      return res.status(404).json({ error: "Record not found" });
    const p = r.rows[0];
    res.json({
      patientId: p.id,
      diagnosis: p.diagnosis,
      condition: p.condition,
      phone: p.phone,
      email: p.email,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch record" });
  }
});
app.get("/api/appointments", authRequired, async (_req, res) => {
  try {
    const r = await pool.query(
      'SELECT id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status FROM appointments ORDER BY appointment_date',
    );
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});
app.post("/api/appointments", authRequired, async (req, res) => {
  try {
    const { patientName, appointmentDate, status } = req.body || {};
    if (!patientName || !appointmentDate)
      return res
        .status(400)
        .json({ error: "patientName and appointmentDate are required" });
    const patientR = await pool.query(
      "SELECT * FROM patients WHERE LOWER(name)=LOWER($1) LIMIT 1",
      [patientName],
    );
    const patient = patientR.rows[0] || null;
    const id = genId("A");
    const r = await pool.query(
      'INSERT INTO appointments (id,patient_id,patient_name,appointment_date,status) VALUES ($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status',
      [
        id,
        patient?.id || null,
        patientName,
        appointmentDate,
        status || "Scheduled",
      ],
    );
    if (patient?.email) {
      try {
        await sendEmail(
          patient.email,
          "Appointment Confirmed",
          `Hello ${patient.name}, your appointment is scheduled for ${appointmentDate}.`,
        );
      } catch (e) {
        console.error("Appointment email error:", e.message);
      }
    }
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

app.patch("/api/appointments/:id/status", authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status',
      [req.body?.status || "Scheduled", req.params.id],
    );
    if (!r.rows.length)
      return res.status(404).json({ error: "Appointment not found" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update appointment status" });
  }
});
app.get("/api/billing/invoices", authRequired, async (_req, res) => {
  try {
    const r = await pool.query("SELECT * FROM bills ORDER BY id DESC");
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});
app.post("/api/billing/invoices", authRequired, async (req, res) => {
  try {
    const { patientId, patientName, invoice, amount } = req.body || {};
    if (!patientId || !invoice || amount == null)
      return res
        .status(400)
        .json({ error: "patientId, invoice, and amount are required" });
    const id = genId("B");
    const r = await pool.query(
      "INSERT INTO bills (id,patient_id,patient_name,invoice,amount) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, patientId, patientName || "Unknown Patient", invoice, amount],
    );
    const p = await pool.query(
      "SELECT email,name FROM patients WHERE id=$1 LIMIT 1",
      [patientId],
    );
    if (p.rows.length && p.rows[0].email) {
      try {
        await sendEmail(
          p.rows[0].email,
          "New Billing Notice",
          `Hello ${p.rows[0].name}, a new bill (${invoice}) for amount ${amount} has been added to your account.`,
        );
      } catch (e) {
        console.error("Billing email error:", e.message);
      }
    }
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create invoice" });
  }
});
app.get("/api/notifications", authRequired, async (_req, res) => {
  try {
    const r = await pool.query("SELECT * FROM notifications ORDER BY id DESC");
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
app.post("/api/notifications/send", authRequired, async (req, res) => {
  try {
    const { patientName, patientId, message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message is required" });
    const id = genId("N");
    const r = await pool.query(
      "INSERT INTO notifications (id,patient_name,type,message,status) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, patientName || patientId || "Unknown", "Email", message, "Sent"],
    );
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create notification" });
  }
});
app.post("/api/email/send", authRequired, async (req, res) => {
  try {
    const { patientId, subject, message } = req.body || {};
    if (!patientId || !message)
      return res
        .status(400)
        .json({ error: "patientId and message are required" });
    const p = await pool.query(
      "SELECT email,name FROM patients WHERE id=$1 LIMIT 1",
      [patientId],
    );
    if (!p.rows.length || !p.rows[0].email)
      return res.status(404).json({ error: "Patient email not found" });
    await sendEmail(
      p.rows[0].email,
      subject || "Healthcare Notification",
      message,
    );
    res.status(201).json({ message: "Email sent successfully" });
  } catch {
    res.status(500).json({ error: "Failed to send email" });
  }
});
app.get("/api/patient/profile", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient")
      return res.status(403).json({ error: "Forbidden" });
    const r = await pool.query(
      "SELECT * FROM patients WHERE user_id=$1 LIMIT 1",
      [req.user.sub],
    );
    if (!r.rows.length)
      return res.status(404).json({ error: "Patient profile not found" });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch patient profile" });
  }
});
app.get("/api/patient/appointments", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient")
      return res.status(403).json({ error: "Forbidden" });
    const p = await pool.query(
      "SELECT * FROM patients WHERE user_id=$1 LIMIT 1",
      [req.user.sub],
    );
    if (!p.rows.length)
      return res.status(404).json({ error: "Patient profile not found" });
    const patient = p.rows[0];
    const r = await pool.query(
      'SELECT id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status FROM appointments WHERE patient_id=$1 ORDER BY appointment_date',
      [patient.id],
    );
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch patient appointments" });
  }
});
app.post("/api/patient/appointments", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "patient")
      return res.status(403).json({ error: "Forbidden" });
    const { appointmentDate } = req.body || {};
    if (!appointmentDate)
      return res.status(400).json({ error: "appointmentDate is required" });
    const p = await pool.query(
      "SELECT * FROM patients WHERE user_id=$1 LIMIT 1",
      [req.user.sub],
    );
    if (!p.rows.length)
      return res.status(404).json({ error: "Patient profile not found" });
    const patient = p.rows[0];
    const id = genId("A");
    const r = await pool.query(
      'INSERT INTO appointments (id,patient_id,patient_name,appointment_date,status) VALUES ($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",patient_name AS "patientName",appointment_date AS "appointmentDate",status',
      [id, patient.id, patient.name, appointmentDate, "Scheduled"],
    );
    if (patient.email) {
      try {
        await sendEmail(
          patient.email,
          "Appointment Confirmed",
          `Hello ${patient.name}, your appointment is scheduled for ${appointmentDate}.`,
        );
      } catch (e) {
        console.error("Patient email error:", e.message);
      }
    }
    res.status(201).json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create patient appointment" });
  }
});
async function start() {
  try {
    await initDb();
    app.listen(PORT, () =>
      console.log(`Healthcare backend running on port ${PORT}`),
    );
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
}
start();
