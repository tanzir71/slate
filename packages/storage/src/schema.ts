export const sqliteIndexSchemaStatements = [
  `
CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  words INTEGER NOT NULL,
  updated_at TEXT,
  content_hash TEXT NOT NULL
)
`.trim(),
  `
CREATE VIRTUAL TABLE IF NOT EXISTS sheets_fts USING fts5(
  path UNINDEXED,
  title,
  body,
  tags
)
`.trim()
] as const;

export const sqliteIndexSchema = `${sqliteIndexSchemaStatements.join(";\n")};`;
