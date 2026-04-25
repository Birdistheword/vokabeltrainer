-- ============================================================
-- SCHEMA MIGRATION V2: Homework redesign
-- Run this in your Supabase SQL Editor
-- All changes are additive — no data loss.
-- ============================================================

-- v2 library-readiness columns
ALTER TABLE exercises            ADD COLUMN IF NOT EXISTS tags  text[] NOT NULL DEFAULT '{}';
ALTER TABLE exercises            ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE homework_assignments ADD COLUMN IF NOT EXISTS tags  text[] NOT NULL DEFAULT '{}';
ALTER TABLE homework_assignments ADD COLUMN IF NOT EXISTS level text;

-- Teacher correction override per exercise response
ALTER TABLE exercise_responses   ADD COLUMN IF NOT EXISTS teacher_correct boolean;

-- New status: pending → submitted → corrected
-- Old 'completed' = student submitted (no teacher review step existed).
-- Map to 'corrected' so they don't clog the new correction queue.
UPDATE homework_assignments SET status = 'corrected' WHERE status = 'completed';
