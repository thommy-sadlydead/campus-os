-- Schema steps `prisma db push` can't take on its own. It stops to ask
-- before adding a unique index to a table that already has rows (in case
-- there are duplicates), the build has no one to answer, and the deploy
-- fails. So the build runs this file first (package.json), and db push then
-- finds these steps already done. Every block is idempotent and does
-- nothing on an empty database, where db push creates everything itself.
-- Verify a new block against a copy of the current schema with data in it
-- before shipping it (see CLAUDE.md).

-- 2026-10, multi-LMS: LMS ids are unique per account, not globally.
-- Classmates share Canvas course and assignment ids, and the old global
-- unique indexes made a second student's sync update the first student's
-- class and assignments instead of creating their own. Runs once, while
-- the old index still exists. The new indexes can't hit duplicates: the
-- old global ones guaranteed none.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'Class_canvasCourseId_key'
  ) THEN
    ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "lmsProvider" TEXT;
    UPDATE "Class" SET "lmsProvider" = 'canvas'
    WHERE "canvasCourseId" IS NOT NULL AND "lmsProvider" IS NULL;

    -- Links to each synced assignment's and exam's Canvas page, from the
    -- student's own Canvas address. They used to be built from
    -- CANVAS_BASE_URL, so every student got Cedarville's.
    ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "lmsUrl" TEXT;
    UPDATE "Assignment" a
    SET "lmsUrl" = rtrim(ca."baseUrl", '/') || '/courses/' || c."canvasCourseId" || '/assignments/' || a."canvasAssignmentId"
    FROM "Class" c
    JOIN "CanvasAccount" ca ON ca."userId" = c."userId"
    WHERE a."classId" = c."id"
      AND c."canvasCourseId" IS NOT NULL
      AND a."canvasAssignmentId" IS NOT NULL
      AND a."lmsUrl" IS NULL;

    ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "lmsUrl" TEXT;
    UPDATE "Exam" e
    SET "lmsUrl" = rtrim(ca."baseUrl", '/') || '/courses/' || c."canvasCourseId" || '/assignments/' || e."canvasAssignmentId"
    FROM "Class" c
    JOIN "CanvasAccount" ca ON ca."userId" = c."userId"
    WHERE e."classId" = c."id"
      AND c."canvasCourseId" IS NOT NULL
      AND e."canvasAssignmentId" IS NOT NULL
      AND e."lmsUrl" IS NULL;

    DROP INDEX IF EXISTS "Class_canvasCourseId_key";
    DROP INDEX IF EXISTS "Assignment_canvasAssignmentId_key";
    DROP INDEX IF EXISTS "Exam_canvasAssignmentId_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "Class_userId_lmsProvider_canvasCourseId_key"
      ON "Class"("userId", "lmsProvider", "canvasCourseId");
    CREATE UNIQUE INDEX IF NOT EXISTS "Assignment_classId_canvasAssignmentId_key"
      ON "Assignment"("classId", "canvasAssignmentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "Exam_classId_canvasAssignmentId_key"
      ON "Exam"("classId", "canvasAssignmentId");
  END IF;
END $$;
