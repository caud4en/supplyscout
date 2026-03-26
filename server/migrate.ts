/**
 * SupplyScout Database Migration & Bootstrap
 *
 * Runs automatically on every app startup (development and production).
 * All operations are idempotent — safe to run multiple times.
 *
 * Stages:
 *   1. Schema   — CREATE TABLE IF NOT EXISTS for all tables
 *   2. Columns  — ADD COLUMN IF NOT EXISTS for generated columns (search_vector)
 *   3. Indexes  — GIN full-text search index + supplementary b-tree indexes
 *   4. Seeding  — populate manufacturers if the table has fewer than 1,000 rows
 *   5. Validate — row counts + required index/column presence
 *
 * Design principles:
 *   ✓ Append-only (never drops tables or deletes rows)
 *   ✓ Idempotent (safe to call repeatedly across restarts)
 *   ✓ No circular dependencies (uses local mlog() not server/index log)
 *   ✓ Fails loudly on critical errors; warns on non-critical ones
 *   ✓ Works identically in development and production
 */

import { pool } from "./db";

function mlog(msg: string) {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${t} [migrate] ${msg}`);
}

// ─── Schema DDL (all idempotent) ──────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id                  SERIAL PRIMARY KEY,
    spec                TEXT NOT NULL,
    certifications      TEXT NOT NULL DEFAULT '',
    max_moq             INTEGER,
    preferred_location  TEXT NOT NULL DEFAULT '',
    quantity            INTEGER,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS logs (
    id          SERIAL PRIMARY KEY,
    job_id      INTEGER NOT NULL REFERENCES jobs(id),
    message     TEXT NOT NULL,
    timestamp   TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id               SERIAL PRIMARY KEY,
    job_id           INTEGER NOT NULL REFERENCES jobs(id),
    name             TEXT NOT NULL,
    location         TEXT,
    certifications   TEXT,
    capabilities     TEXT,
    moq              INTEGER,
    score            INTEGER,
    rfq_sent         BOOLEAN DEFAULT FALSE,
    url              TEXT,
    confidence_score INTEGER
  );

  CREATE TABLE IF NOT EXISTS manufacturers (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    country         TEXT NOT NULL,
    city            TEXT,
    region          TEXT,
    industry        TEXT NOT NULL,
    sub_industry    TEXT,
    certifications  TEXT,
    capabilities    TEXT,
    employee_count  TEXT,
    annual_revenue  TEXT,
    moq_min         INTEGER,
    moq_max         INTEGER,
    lead_time_days  INTEGER,
    url             TEXT,
    email           TEXT,
    phone           TEXT,
    verified        BOOLEAN DEFAULT FALSE,
    data_source     TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id                  SERIAL PRIMARY KEY,
    source              TEXT NOT NULL,
    industry            TEXT,
    region              TEXT,
    country             TEXT,
    query               TEXT,
    status              TEXT NOT NULL,
    records_found       INTEGER DEFAULT 0,
    records_added       INTEGER DEFAULT 0,
    records_skipped     INTEGER DEFAULT 0,
    records_duplicate   INTEGER DEFAULT 0,
    notes               TEXT,
    started_at          TIMESTAMP DEFAULT NOW(),
    completed_at        TIMESTAMP
  );
`;

// ─── Generated column (must be separate from CREATE TABLE) ────────────────────
// PostgreSQL GENERATED ALWAYS AS columns cannot be added via IF NOT EXISTS
// in a single statement — we use a PL/pgSQL DO block.

const SEARCH_VECTOR_DDL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'manufacturers'
        AND column_name = 'search_vector'
    ) THEN
      ALTER TABLE manufacturers
        ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('english',
            coalesce(name, '')          || ' ' ||
            coalesce(capabilities, '')  || ' ' ||
            coalesce(industry, '')      || ' ' ||
            coalesce(certifications, '') || ' ' ||
            coalesce(city, '')          || ' ' ||
            coalesce(country, '')       || ' ' ||
            coalesce(region, '')
          )
        ) STORED;
    END IF;
  END;
  $$;
`;

// ─── Indexes ──────────────────────────────────────────────────────────────────

const INDEX_STEPS: Array<{ label: string; sql: string }> = [
  {
    label: "manufacturers_country_idx",
    sql: `CREATE INDEX IF NOT EXISTS manufacturers_country_idx  ON manufacturers(country)`,
  },
  {
    label: "manufacturers_industry_idx",
    sql: `CREATE INDEX IF NOT EXISTS manufacturers_industry_idx ON manufacturers(industry)`,
  },
  {
    label: "manufacturers_region_idx",
    sql: `CREATE INDEX IF NOT EXISTS manufacturers_region_idx   ON manufacturers(region)`,
  },
  {
    label: "manufacturers_moq_idx",
    sql: `CREATE INDEX IF NOT EXISTS manufacturers_moq_idx      ON manufacturers(moq_min)`,
  },
  {
    label: "manufacturers_search_idx (GIN)",
    // Must come AFTER the search_vector column has been created
    sql: `CREATE INDEX IF NOT EXISTS manufacturers_search_idx   ON manufacturers USING GIN(search_vector)`,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    mlog("Core tables: ✓");

    await client.query(SEARCH_VECTOR_DDL);
    mlog("search_vector column: ✓");

    for (const step of INDEX_STEPS) {
      try {
        await client.query(step.sql);
        mlog(`Index ${step.label}: ✓`);
      } catch (err: any) {
        mlog(`Index warning [${step.label}]: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

async function getManufacturerCount(): Promise<number> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT count(*)::int AS n FROM manufacturers`);
    return r.rows[0]?.n ?? 0;
  } finally {
    client.release();
  }
}

// ─── Validation (also exported for /api/health) ───────────────────────────────

export async function validateDatabase(): Promise<{
  ok: boolean;
  manufacturers: number;
  jobs: number;
  suppliers: number;
  ingestionRuns: number;
  hasSearchIndex: boolean;
  hasSearchVector: boolean;
  issues: string[];
}> {
  const client = await pool.connect();
  try {
    const [mfrRes, jobRes, supRes, runRes, idxRes, colRes] = await Promise.all([
      client.query(`SELECT count(*)::int AS n FROM manufacturers`),
      client.query(`SELECT count(*)::int AS n FROM jobs`),
      client.query(`SELECT count(*)::int AS n FROM suppliers`),
      client.query(`SELECT count(*)::int AS n FROM ingestion_runs`),
      client.query(`
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'manufacturers'
          AND indexname  = 'manufacturers_search_idx'
      `),
      client.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'manufacturers'
          AND column_name = 'search_vector'
      `),
    ]);

    const manufacturers  = mfrRes.rows[0]?.n ?? 0;
    const jobs           = jobRes.rows[0]?.n ?? 0;
    const suppliers      = supRes.rows[0]?.n ?? 0;
    const ingestionRuns  = runRes.rows[0]?.n ?? 0;
    const hasSearchIndex  = idxRes.rows.length > 0;
    const hasSearchVector = colRes.rows.length > 0;

    const issues: string[] = [];
    if (manufacturers < 1000) issues.push(`Low manufacturer count: ${manufacturers}`);
    if (!hasSearchIndex)      issues.push("Missing GIN search index");
    if (!hasSearchVector)     issues.push("Missing search_vector generated column");

    return { ok: issues.length === 0, manufacturers, jobs, suppliers, ingestionRuns, hasSearchIndex, hasSearchVector, issues };
  } finally {
    client.release();
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  mlog("Starting database migrations…");

  // Stage 1–3: Schema + indexes
  await applySchema();

  // Stage 4: Seed if empty
  const count = await getManufacturerCount();
  mlog(`Manufacturer count: ${count}`);

  if (count < 1000) {
    mlog("Database appears empty — running seed (this takes ~60 s on first deploy)…");
    const { seedManufacturersForMigration } = await import("./seed-manufacturers");
    await seedManufacturersForMigration();
  } else {
    mlog("Seeding skipped — database already populated");
  }

  // Stage 5: Validate
  const health = await validateDatabase();
  if (health.ok) {
    mlog(
      `Migrations complete ✓ — ` +
      `${health.manufacturers.toLocaleString()} manufacturers, ` +
      `GIN index: ${health.hasSearchIndex ? "✓" : "✗"}, ` +
      `search_vector: ${health.hasSearchVector ? "✓" : "✗"}`
    );
  } else {
    mlog(`Migrations complete with warnings: ${health.issues.join("; ")}`);
  }
}
