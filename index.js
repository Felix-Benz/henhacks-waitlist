const express = require("express");
const path = require("path");
const cors = require("cors");
const app = express();
const port = 3000;
const mysql = require("mysql2");

// Create a connection to the MySQL database
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "@MWsql123",
  database: "waitlist",
});

// Middleware
app.use(cors()); // Allows cross-origin requests
app.use(express.json()); // Parses JSON request bodies

app.use(express.static(path.join(__dirname, "public")));

const { googleKey } = require("./config.json");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(googleKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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

    const result = await model.generateContent([
      `The following symptoms are given from a patient that has just arrived at a medical office. Asses the severity of their condition, and give it a rank from 1-100. 1 being the least severe, and 100 being the most. Use the entire range and be specific as possible. The number you give will be used to give them a spot on the waitlist and will determine when they can be seen by a doctor. Be as specific and precise as possible. Only return the number, nothing else.\n\n${symptoms}`,
    ]);

    const priorityRating = await result.response.text(); // Await the text response

    // Usage:
    insertPatient(firstName, lastName, parseInt(priorityRating), symptoms)
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
 * @property {number} pain_level - Urgency level (1-100).
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
        p.symptoms, 
        p.timestamp,
        (
          SELECT COUNT(*) + 1 
          FROM patients AS p2 
          WHERE p2.pain_level > p.pain_level 
            OR (p2.pain_level = p.pain_level AND p2.timestamp < p.timestamp)
        ) AS \`rank\`
      FROM patients AS p
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
 * Retrieves each patient's name and orders them by the urgency level, then the timestamp.
 *
 * @route POST /getWaitListNames
 * @returns {Object[]} List of first and last names.
 */
app.post("/getWaitlistNames", (req, res) => {
  const query = `
      SELECT first_name, last_name
      FROM patients
      ORDER BY pain_level DESC, timestamp ASC;
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
 * @param {number} painLevel - The urgency level (1-100).
 * @param {string} symptoms - A description of the patient's symptoms.
 * @returns {Promise<number>} Resolves with the patient's position in the waitlist.
 * @throws {Error} If the pain level is out of range or a database error occurs.
 *
 */
function insertPatient(firstName, lastName, painLevel, symptoms) {
  return new Promise((resolve, reject) => {
    if (painLevel < 1 || painLevel > 100) {
      reject("Error: Pain level must be between 1 and 100.");
      return;
    }

    const query = `INSERT INTO patients (first_name, last_name, pain_level, symptoms) VALUES (?, ?, ?, ?)`;
    connection.execute(
      query,
      [firstName, lastName, parseInt(painLevel), symptoms],
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
