-- Generated tsvector column + GIN index for Memory full-text search.
-- Prisma can't express generated columns, so this is raw SQL —
-- docs/database-design.md "Memory".
ALTER TABLE "Memory" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

CREATE INDEX "Memory_searchVector_idx" ON "Memory" USING GIN ("searchVector");
