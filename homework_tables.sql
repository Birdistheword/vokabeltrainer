-- Run this in your Supabase SQL Editor
-- Creates homework_assignments and homework_submissions tables with RLS

CREATE TABLE IF NOT EXISTS homework_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  lesson_notes text,
  exercises jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed'))
);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES homework_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer,
  submitted_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE homework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_submissions ENABLE ROW LEVEL SECURITY;

-- Teachers: full access to their own assignments
CREATE POLICY "teachers_manage_assignments" ON homework_assignments
  FOR ALL USING (teacher_id = auth.uid());

-- Students: read assignments addressed to them
CREATE POLICY "students_read_own_assignments" ON homework_assignments
  FOR SELECT USING (student_id = auth.uid());

-- Students: update status on their own assignments (mark completed)
CREATE POLICY "students_update_own_assignments" ON homework_assignments
  FOR UPDATE USING (student_id = auth.uid());

-- Students: full access to their own submissions
CREATE POLICY "students_manage_submissions" ON homework_submissions
  FOR ALL USING (student_id = auth.uid());

-- Teachers: read submissions for assignments they created
CREATE POLICY "teachers_read_submissions" ON homework_submissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM homework_assignments
      WHERE id = assignment_id AND teacher_id = auth.uid()
    )
  );
