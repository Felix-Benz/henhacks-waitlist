-- Migration 001: severity scoring reliability
-- Run once against the existing `waitlist` database (MySQL 8.0+):
--   mysql -u <user> -p waitlist < migrations/001_severity_reliability.sql

-- Step 1: Gemini's one-sentence explanation of the score.
ALTER TABLE patients
  ADD COLUMN severity_rationale VARCHAR(500) NULL;

-- Step 2: validation fallback.
-- pain_level is the effective severity used for ordering. It becomes nullable
-- because a patient whose AI scoring failed is inserted without a score.
-- If your column was declared with a type other than INT, keep that type here.
-- ai_severity preserves what the model said, even after a staff override.
ALTER TABLE patients
  MODIFY COLUMN pain_level INT NULL,
  ADD COLUMN ai_severity INT NULL,
  ADD COLUMN needs_review TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN review_reason VARCHAR(255) NULL;

-- Step 4: staff override. review_reason is kept after an override so the
-- history of why a patient was flagged is not lost.
ALTER TABLE patients
  ADD COLUMN severity_overridden TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN overridden_at DATETIME NULL;

-- Existing rows were all scored by the model.
UPDATE patients SET ai_severity = pain_level WHERE ai_severity IS NULL;

-- Queue order: flagged patients first (staff must triage them before anyone
-- else is called), unscored before provisionally scored, then highest
-- severity, then earliest arrival. NULL pain_level would otherwise sort last
-- under DESC and silently send a patient whose scoring failed to the back of
-- the line.
-- This replaces the existing patient_waitlist view; index.js reads `position`
-- from it for check-in, the management page and the public waitlist.
CREATE OR REPLACE VIEW patient_waitlist AS
SELECT
  id,
  ROW_NUMBER() OVER (
    ORDER BY needs_review DESC, pain_level IS NULL DESC, pain_level DESC,
             timestamp ASC, id ASC
  ) AS position
FROM patients;
