**Waitlist for Medical Offices, Powered by Gemini**

_An intelligent waitlist system that prioritizes patients based on symptom severity using AI._ 

<p>
    <img src="https://github.com/user-attachments/assets/a0037b12-a6d0-49c1-ba10-c642c6d75da4" width="150">
    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
    <img src="https://github.com/user-attachments/assets/85ec9cc7-6c4e-4988-b2c5-b0852ca60bff" width="150">
</p>

It uses a severity scale from 1-100 to ensure that high-priority cases get the medical attention they need.
Patients can view their spot on the waitlist, and the offices can view the list with the patients' information and take them off the waitlist once they are treated.

Technologies:
- **Backend**: Node.js & express
- **Database**: MySQL
- **Symptom Analytics**: Google's Gemini AI
- **Frontend**: Javascript, HTML, CSS

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Create your environment file and fill in your values:
   ```
   cp .env.example .env
   ```
   | Variable | Description |
   |---|---|
   | `DB_HOST` | MySQL host, e.g. `localhost` |
   | `DB_USER` | MySQL user |
   | `DB_PASSWORD` | MySQL password |
   | `DB_NAME` | Database name, e.g. `waitlist` |
   | `GEMINI_API_KEY` | Google Gemini API key from [AI Studio](https://aistudio.google.com/apikey) |
   | `GEMINI_MODEL` | Optional, defaults to `gemini-3.8-flash` |

   `.env` is listed in `.gitignore`, so it is never committed. The server exits at startup if a required variable is missing.
3. Apply the database migration (MySQL 8.0+):
   ```
   mysql -u <user> -p waitlist < migrations/001_severity_reliability.sql
   ```
4. Start the server and open http://localhost:3000:
   ```
   node index.js
   ```

## Reliable AI Triage

An AI score decides when someone sees a doctor, so the app never blindly trusts a single model response. The scoring logic lives in `severity.js`.

- **Structured output.** Gemini responds in JSON constrained by a schema: an integer `severity` (1-100) and a one-sentence `rationale`. The rationale is stored and shown to staff so every score is explainable.
- **Validation and retry.** Each response is checked before use: valid JSON, an integer from 1 to 100, and a non-empty rationale. An invalid response or a failed API call is retried once after a 1-second pause. Rate-limit errors (HTTP 429) are not retried, since quota resets on the order of a minute and an immediate retry would only burn more of it; the patient is flagged for staff instead.
- **Consistency check.** Every patient is scored 3 times in parallel and the median is used, so one outlier response can't skew the score. If the highest and lowest scores differ by more than `MAX_SCORE_SPREAD` (20), the model is treated as uncertain and the patient is flagged.
- **Needs review.** A patient is flagged `needs_review` when scoring fails entirely (they are added with no score), when only some samples are valid, or when the samples disagree. Flagged patients are placed at the **top** of the queue so staff triage them first; a scoring failure never pushes someone to the back of the line.
- **Human override.** Staff can set any patient's severity from the management page (`PUT /overrideSeverity/:id`). This clears the review flag and records that the score was overridden and when. The model's original score is kept in `ai_severity` for auditing.
- **Prompt injection mitigation.** Patient-written symptoms are delimited and labelled as data in the prompt. The consistency check and staff review act as backstops.

2025 HenHacks. Williams, Benz & Padrone. All rights reserved.

