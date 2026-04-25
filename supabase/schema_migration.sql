-- ============================================================
-- SCHEMA MIGRATION: New vocabulary & homework structure
-- Run this in your Supabase SQL Editor
-- ============================================================

-- --------------------------------------------------------
-- 1. VOCABULARY SOURCES
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS vocabulary_sources (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  type        text        NOT NULL DEFAULT 'custom' CHECK (type IN ('schoolbook', 'custom', 'web')),
  description text,
  created_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE vocabulary_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vs_authenticated_read" ON vocabulary_sources FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "vs_admin_write"        ON vocabulary_sources FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- --------------------------------------------------------
-- 2. LEARNING SETS  (replaces level + chapter on vocabulary)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_sets (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id   uuid        NOT NULL REFERENCES vocabulary_sources(id) ON DELETE RESTRICT,
  name        text        NOT NULL,
  level       text        NOT NULL,
  description text,
  tags        text[]      NOT NULL DEFAULT '{}',
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE learning_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ls_authenticated_read" ON learning_sets FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ls_admin_write"        ON learning_sets FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- --------------------------------------------------------
-- 3. MIGRATE vocabulary: add set_id, populate, drop old columns
-- --------------------------------------------------------

-- 3a. Insert the default source
INSERT INTO vocabulary_sources (name, type)
VALUES ('Default', 'custom');

-- 3b. Create one learning_set per unique (level, chapter) combo
INSERT INTO learning_sets (source_id, name, level)
SELECT vs.id, v.chapter::text, v.level
FROM (SELECT DISTINCT level, chapter FROM vocabulary) v
CROSS JOIN (SELECT id FROM vocabulary_sources WHERE name = 'Default' LIMIT 1) vs;

-- 3c. Add set_id column to vocabulary
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS set_id uuid REFERENCES learning_sets(id) ON DELETE RESTRICT;

-- 3d. Populate set_id
UPDATE vocabulary v
SET    set_id = ls.id
FROM   learning_sets ls
WHERE  v.chapter::text = ls.name
  AND  v.level         = ls.level;

-- 3e. Make set_id NOT NULL and drop the old columns
ALTER TABLE vocabulary ALTER COLUMN set_id SET NOT NULL;
ALTER TABLE vocabulary DROP COLUMN IF EXISTS level;
ALTER TABLE vocabulary DROP COLUMN IF EXISTS chapter;

-- --------------------------------------------------------
-- 4. UNLOCKED SETS  (replaces unlocked_chapters)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS unlocked_sets (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id      uuid        NOT NULL REFERENCES learning_sets(id) ON DELETE CASCADE,
  unlocked_by uuid        REFERENCES auth.users(id),
  unlocked_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (student_id, set_id)
);

ALTER TABLE unlocked_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "us_student_read"   ON unlocked_sets FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "us_admin_write"    ON unlocked_sets FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 4a. Migrate existing unlocked_chapters → unlocked_sets
INSERT INTO unlocked_sets (student_id, set_id, unlocked_at)
SELECT uc.student_id, ls.id, now()
FROM   unlocked_chapters uc
JOIN   learning_sets ls ON uc.chapter::text = ls.name AND uc.level = ls.level
ON CONFLICT (student_id, set_id) DO NOTHING;

-- 4b. Drop old table
DROP TABLE IF EXISTS unlocked_chapters;

-- --------------------------------------------------------
-- 5. UNLOCKED VOCABULARY  (individual word overrides)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS unlocked_vocabulary (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vocabulary_id bigint      NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  unlocked_by   uuid        REFERENCES auth.users(id),
  unlocked_at   timestamptz DEFAULT now() NOT NULL,
  UNIQUE (student_id, vocabulary_id)
);

ALTER TABLE unlocked_vocabulary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uv_student_read" ON unlocked_vocabulary FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "uv_admin_write"  ON unlocked_vocabulary FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- --------------------------------------------------------
-- 6. EXERCISES  (reusable exercise library)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercises (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by    uuid        REFERENCES auth.users(id),
  exercise_type text        NOT NULL,
  title         text        NOT NULL,
  content       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ex_authenticated_read" ON exercises FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ex_admin_write"        ON exercises FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- --------------------------------------------------------
-- 7. ASSIGNMENT_EXERCISES  (which exercises belong to which assignment)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_exercises (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id uuid    NOT NULL REFERENCES homework_assignments(id) ON DELETE CASCADE,
  exercise_id   uuid    NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  order_index   integer NOT NULL DEFAULT 0
);

ALTER TABLE assignment_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ae_read" ON assignment_exercises FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM homework_assignments ha
    WHERE  ha.id = assignment_id
      AND  (ha.teacher_id = auth.uid() OR ha.student_id = auth.uid())
  )
);
CREATE POLICY "ae_write" ON assignment_exercises FOR ALL USING (
  EXISTS (
    SELECT 1 FROM homework_assignments ha
    WHERE  ha.id = assignment_id AND ha.teacher_id = auth.uid()
  )
);

-- 7a. Migrate existing exercises from homework_assignments JSONB
DO $$
DECLARE
  asgmt      RECORD;
  ex         JSONB;
  new_ex_id  UUID;
  order_idx  INT;
BEGIN
  FOR asgmt IN
    SELECT id, teacher_id, exercises
    FROM   homework_assignments
    WHERE  exercises IS NOT NULL
      AND  exercises != '[]'::jsonb
      AND  jsonb_array_length(exercises) > 0
  LOOP
    order_idx := 0;
    FOR ex IN SELECT * FROM jsonb_array_elements(asgmt.exercises)
    LOOP
      INSERT INTO exercises (created_by, exercise_type, title, content)
      VALUES (
        asgmt.teacher_id,
        COALESCE(ex->>'type',        'unknown'),
        COALESCE(ex->>'instruction', ''),
        COALESCE(ex->'content',      '{}'::jsonb)
      )
      RETURNING id INTO new_ex_id;

      INSERT INTO assignment_exercises (assignment_id, exercise_id, order_index)
      VALUES (asgmt.id, new_ex_id, order_idx);

      order_idx := order_idx + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- --------------------------------------------------------
-- 8. EXERCISE RESPONSES  (per-exercise student answers)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercise_responses (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id    uuid        NOT NULL REFERENCES homework_submissions(id) ON DELETE CASCADE,
  exercise_id      uuid        NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  response         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_correct       boolean,
  time_spent_seconds integer
);

ALTER TABLE exercise_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "er_student" ON exercise_responses FOR ALL USING (
  EXISTS (
    SELECT 1 FROM homework_submissions hs
    WHERE  hs.id = submission_id AND hs.student_id = auth.uid()
  )
);
CREATE POLICY "er_teacher_read" ON exercise_responses FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM homework_submissions hs
    JOIN   homework_assignments ha ON ha.id = hs.assignment_id
    WHERE  hs.id = submission_id AND ha.teacher_id = auth.uid()
  )
);

-- --------------------------------------------------------
-- 9. UPDATE homework_assignments
-- --------------------------------------------------------
ALTER TABLE homework_assignments ADD COLUMN IF NOT EXISTS instructions text;
ALTER TABLE homework_assignments ADD COLUMN IF NOT EXISTS due_date     date;

-- Copy lesson_notes → instructions before dropping
UPDATE homework_assignments SET instructions = lesson_notes WHERE lesson_notes IS NOT NULL AND instructions IS NULL;

ALTER TABLE homework_assignments DROP COLUMN IF EXISTS exercises;
ALTER TABLE homework_assignments DROP COLUMN IF EXISTS lesson_notes;

-- --------------------------------------------------------
-- 10. UPDATE homework_submissions
-- --------------------------------------------------------
ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS feedback text;
ALTER TABLE homework_submissions DROP COLUMN IF EXISTS answers;
