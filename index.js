require("dotenv").config(); // Loads secrets from .env into process.env
const express = require("express");
const path = require("path");
const cors = require("cors");
const app = express();
const port = 3000;
const mysql = require("mysql2");

// Fail fast at startup rather than on the first patient check-in.
const missingEnv = ["DB_HOST", "DB_USER", "DB_NAME", "GEMINI_API_KEY"].filter(
  (name) => !process.env[name]
);
if (missingEnv.length > 0) {
  console.error(
    `Missing environment variables: ${missingEnv.join(", ")}. Copy .env.example to .env and fill it in.`
  );
  process.exit(1);
}

// Create a connection to the MySQL database
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
});

// Middleware
app.use(cors()); // Allows cross-origin requests
app.use(express.json()); // Parses JSON request bodies

app.use(express.static(path.join(__dirname, "public")));

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  assessSeverity,
  generationConfig,
  isValidSeverity,
} = require("./severity");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  generationConfig,
});

/**
 * Serves the home page.
 * @route GET /
 */
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "public", "home.html");
  res.sendFile(filePath, async (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status).end();
    }
  });
});

/**
 * Serves the check-in page.
 * @route GET /checkin
 */
app.get("/checkin", (req, res) => {
  const filePath = path.join(__dirname, "public", "checkin.html");
  res.sendFile(filePath, async (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status).end();
    }
  });
});

/**
 * Serves the management page.
 * @route GET /management
 */
app.get("/management", (req, res) => {
  const filePath = path.join(__dirname, "public", "management.html");
  res.sendFile(filePath, async (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status).end();
    }
  });
});

/**
 * Serves the waitlist page.
 * @route GET /waitlist
 */
app.get("/waitlist", (req, res) => {
  const filePath = path.join(__dirname, "public", "waitlist.html");
  res.sendFile(filePath, async (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status).end();
    }
  });
});

/**
 * Processes patient symptoms and assigns an urgency ranking.
 *
 * @route POST /prompt
 * @param {string} req.body.firstName - Patient's first name.
 * @param {string} req.body.lastName - Patient's last name.
 * @param {string} req.body.symptoms - Description of symptoms.
 * @returns {Object} JSON containing the patient's waitlist position.
 *
 */
app.post("/prompt", async (req, res) => {
  try {
    const { firstName, lastName, symptoms } = req.body;
    if (!firstName || !lastName || !symptoms) {
      return res.status(400).json({ error: "No prompt provided" });
    }

    const assessment = await assessSeverity(model, symptoms);

    insertPatient(firstName, lastName, symptoms, assessment)
      .then((position) => {
        res.json({ position: position }); // Send position in JSON response
      })
      .catch((err) => {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" }); // Handle errors properly
      });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Retrieves the list of patients ordered by urgency (pain level) and arrival time.
 *
 * @route POST /getPatients
 * @returns {Object[]} JSON array containing patient details and waitlist ranking.
 * @throws {Error} If a database error occurs.
 *
 * @typedef {Object} Patient
 * @property {number} id - Unique patient ID.
 * @property {string} first_name - Patient's first name.
 * @property {string} last_name - Patient's last name.
 * @property {number|null} pain_level - Effective urgency level (1-100); null until staff triage an unscored patient.
 * @property {number|null} ai_severity - Severity originally assigned by Gemini.
 * @property {string|null} severity_rationale - Gemini's explanation of its score.
 * @property {number} needs_review - 1 if staff must triage manually.
 * @property {string|null} review_reason - Why the patient was flagged.
 * @property {number} severity_overridden - 1 if staff set the severity manually.
 * @property {string} symptoms - Description of symptoms.
 * @property {string} timestamp - Time when the patient checked in.
 * @property {number} rank - Position in the waitlist.
 */
app.post("/getPatients", (req, res) => {
  const query = `
      SELECT 
        p.id, 
        p.first_name,
        p.last_name, 
        p.pain_level,
        p.ai_severity,
        p.severity_rationale,
        p.needs_review,
        p.review_reason,
        p.severity_overridden,
        p.symptoms,
        p.timestamp,
        w.position AS \`rank\`
      FROM patients AS p
      JOIN patient_waitlist AS w ON w.id = p.id
      ORDER BY \`rank\` ASC;
    `;

  connection.execute(query, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error." });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No patients found." });
    }

    res.json(results);
  });
});

/**
 * Deletes a patient from the database by ID.
 *
 * @route DELETE /removePatient/:id
 * @param {number} req.params.id - The ID of the patient to remove.
 * @returns {Object} JSON response indicating success or failure.
 *
 */
app.delete("/removePatient/:id", (req, res) => {
  const patientId = req.params.id;

  const query = "DELETE FROM patients WHERE id = ?";
  connection.execute(query, [patientId], (err, result) => {
    if (err) {
      console.error("Error deleting patient:", err);
      return res
        .status(500)
        .json({ success: false, error: "Error removing patient." });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Patient not found." });
    }

    res.json({ success: true, message: "Patient removed successfully." });
  });
});

/**
 * Lets staff manually set a patient's severity. The AI's original score is
 * kept in ai_severity, and the override clears any needs_review flag.
 *
 * @route PUT /overrideSeverity/:id
 * @param {number} req.params.id - The ID of the patient.
 * @param {number} req.body.severity - New severity (integer 1-100).
 * @returns {Object} JSON response indicating success or failure.
 */
app.put("/overrideSeverity/:id", (req, res) => {
  const patientId = req.params.id;
  const { severity } = req.body;

  if (!isValidSeverity(severity)) {
    return res
      .status(400)
      .json({ success: false, error: "Severity must be an integer between 1 and 100." });
  }

  const query = `
      UPDATE patients
      SET pain_level = ?,
          severity_overridden = 1,
          overridden_at = NOW(),
          needs_review = 0
      WHERE id = ?
  `;
  connection.execute(query, [severity, patientId], (err, result) => {
    if (err) {
      console.error("Error overriding severity:", err);
      return res
        .status(500)
        .json({ success: false, error: "Error updating severity." });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Patient not found." });
    }

    res.json({ success: true, message: "Severity updated." });
  });
});

/**
 * Retrieves each patient's name and orders them by the urgency level, then the timestamp.
 *
 * @route POST /getWaitListNames
 * @returns {Object[]} List of first and last names.
 */
app.post("/getWaitlistNames", (req, res) => {
  const query = `
      SELECT p.first_name, p.last_name
      FROM patients AS p
      JOIN patient_waitlist AS w ON w.id = p.id
      ORDER BY w.position ASC;
  `;

  connection.execute(query, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error." });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No patients found." });
    }

    res.json(results);
  });
});

/**
 * Inserts a new patient into the database and retrieves their waitlist position.
 *
 * @param {string} firstName - The first name of the patient.
 * @param {string} lastName - The last name of the patient.
 * @param {string} symptoms - A description of the patient's symptoms.
 * @param {Object} assessment - Result of AI severity scoring.
 * @param {number|null} assessment.painLevel - The urgency level (1-100), or null if scoring failed.
 * @param {string|null} assessment.rationale - Gemini's one-sentence explanation of the score.
 * @param {boolean} assessment.needsReview - Whether staff must triage the patient manually.
 * @param {string} [assessment.reviewReason] - Why the patient was flagged for review.
 * @returns {Promise<number>} Resolves with the patient's position in the waitlist.
 * @throws {Error} If the pain level is invalid or a database error occurs.
 *
 */
function insertPatient(firstName, lastName, symptoms, assessment) {
  const { painLevel, rationale, needsReview, reviewReason = null } = assessment;
  return new Promise((resolve, reject) => {
    if (painLevel === null ? !needsReview : !isValidSeverity(painLevel)) {
      reject("Error: Pain level must be an integer between 1 and 100.");
      return;
    }

    const query = `INSERT INTO patients (first_name, last_name, pain_level, ai_severity, symptoms, severity_rationale, needs_review, review_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    connection.execute(
      query,
      [firstName, lastName, painLevel, painLevel, symptoms, rationale, needsReview, reviewReason],
      (err, results) => {
        if (err) {
          reject("Error inserting patient: " + err);
          return;
        }

        const getPosition = `SELECT position FROM patient_waitlist WHERE id = ?`;
        connection.execute(
          getPosition,
          [results.insertId],
          (err, positionResults) => {
            if (err) {
              reject("Error getting position: " + err);
              return;
            }

            resolve(positionResults[0].position);
          }
        );
      }
    );
  });
}

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
