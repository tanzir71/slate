import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const { computeStats, parseSheet } = await importBuilt("../packages/core/dist/index.js");

const sqliteIndexSchema = `
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
);

CREATE VIRTUAL TABLE IF NOT EXISTS sheets_fts USING fts5(
  path UNINDEXED,
  title,
  body,
  tags
);
`;

const results = [];

const largeSheet = `---
title: Large Fixture
---
# Large Fixture

${makeWords(50_000)}
`;
results.push(
  measure("open-50k-word-sheet", 400, () => {
    const sheet = parseSheet(largeSheet, "Perf/Large Fixture.md");
    return `${sheet.stats.words.toLocaleString()} words`;
  })
);

const typingFixture = makeWords(5_000);
results.push(
  measure("typing-hud-5k-word-sheet", 50, () => {
    const stats = computeStats(`${typingFixture} next`);
    return `${stats.words.toLocaleString()} words`;
  })
);

results.push(await measureSqliteSearchBudget());

console.log("Performance budgets:");
for (const result of results) {
  console.log(
    `- ${result.name}: ${result.durationMs.toFixed(1)}ms <= ${result.budgetMs}ms (${result.detail})`
  );
}

const failures = results.filter((result) => result.durationMs > result.budgetMs);
if (failures.length > 0) {
  throw new Error(
    `Performance budget exceeded: ${failures
      .map((result) => `${result.name} ${result.durationMs.toFixed(1)}ms > ${result.budgetMs}ms`)
      .join(", ")}`
  );
}

async function importBuilt(path) {
  try {
    return await import(path);
  } catch (error) {
    throw new Error(`Unable to load built artifact ${path}. Run pnpm build before pnpm perf.`, {
      cause: error
    });
  }
}

function measure(name, budgetMs, run) {
  const start = performance.now();
  const detail = run();
  const durationMs = performance.now() - start;
  return { name, budgetMs, durationMs, detail };
}

async function measureSqliteSearchBudget() {
  const root = await mkdtemp(join(tmpdir(), "slate-perf-"));
  const database = new DatabaseSync(join(root, "index.sqlite"));
  let inTransaction = false;

  try {
    database.exec(sqliteIndexSchema);
    database.exec("BEGIN IMMEDIATE");
    inTransaction = true;
    const insertSheet = database.prepare(`
      INSERT INTO sheets (id, path, title, body, tags_json, links_json, words, updated_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = database.prepare(`
      INSERT INTO sheets_fts (path, title, body, tags)
      VALUES (?, ?, ?, ?)
    `);

    for (let index = 0; index < 10_000; index += 1) {
      const path = `Perf/sheet-${index}.md`;
      const title = `Perf Sheet ${index}`;
      const body =
        index === 7_777
          ? "A searchable needle passage for the perf budget."
          : "Ordinary searchable body text for the perf budget.";
      insertSheet.run(
        `perf-${index}`,
        path,
        title,
        body,
        JSON.stringify(["perf"]),
        JSON.stringify([]),
        body.split(/\s+/).length,
        null,
        `hash-${index}`
      );
      insertFts.run(path, title, body, "perf");
    }
    database.exec("COMMIT");
    inTransaction = false;

    return measure("sqlite-fts-search-10k-sheets", 100, () => {
      const rows = database
        .prepare(
          `
          SELECT sheets.path
          FROM sheets_fts
          JOIN sheets ON sheets.path = sheets_fts.path
          WHERE sheets_fts MATCH ?
          ORDER BY bm25(sheets_fts), sheets.path ASC
        `
        )
        .all('"needle"');
      return `${rows.length} hit`;
    });
  } catch (error) {
    if (inTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function makeWords(count) {
  return Array.from({ length: count }, (_, index) => `word${index % 997}`).join(" ");
}
