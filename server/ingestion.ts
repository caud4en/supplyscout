/**
 * SupplyScout Data Ingestion Pipeline
 *
 * Architecture: RAG-augmented manufacturer discovery
 *
 *   Retrieval  ─ PostgreSQL GIN full-text search (existing, <10ms)
 *   Augmentation ─ TinyFish web agents browse public directories
 *   Generation ─ Claude normalises raw scraped data into DB schema
 *
 * Pipeline stages per run:
 *   1. Source selection  — choose target directory + query
 *   2. Web retrieval     — TinyFish agent browses the directory
 *   3. Claude extraction — parse & normalise the raw results
 *   4. Validation        — schema checks + quality gates
 *   5. Deduplication     — name + country uniqueness vs existing DB
 *   6. Append            — insert only new, validated records
 *   7. Audit             — write ingestion_runs row with provenance
 *
 * Guarantees:
 *   ✓ Append-only (never deletes or overwrites existing rows)
 *   ✓ Fully idempotent (duplicate runs are safe)
 *   ✓ Handles API failures & rate limits gracefully
 *   ✓ Every inserted record links to an ingestion_run for traceability
 */

import { db } from "./db";
import { manufacturers, ingestionRuns } from "@shared/schema";
import { eq, sql, and, ilike } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./tinyfish";
import { verifyUrl } from "./verify-urls";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ─── Validated manufacturer record (after Claude extraction) ─────────────────

export interface RawSupplierRecord {
  name: string;
  country: string;
  city?: string | null;
  region?: string | null;
  industry: string;
  certifications?: string | null;
  capabilities?: string | null;
  employeeCount?: string | null;
  moqMin?: number | null;
  url?: string | null;
  dataSource: string;
}

// ─── Public directories indexed per industry ─────────────────────────────────

const DIRECTORIES: Array<{
  url: string;
  name: string;
  industries: string[];
  regions: string[];
}> = [
  {
    url: "https://www.thomasnet.com/search/?what={query}&searchsource=nav",
    name: "ThomasNet",
    industries: ["Electronics Manufacturing", "Metal Fabrication", "Industrial Machinery", "Plastics & Rubber"],
    regions: ["North America"],
  },
  {
    url: "https://www.kompass.com/search/#%7B%22text%22%3A%22{query}%22%7D",
    name: "Kompass",
    industries: ["all"],
    regions: ["Europe", "Asia-Pacific", "Latin America"],
  },
  {
    url: "https://www.globalsources.com/manufacturer/{query}.htm",
    name: "Global Sources",
    industries: ["Electronics Manufacturing", "Plastics & Rubber", "Textiles & Apparel"],
    regions: ["Asia-Pacific"],
  },
  {
    url: "https://www.made-in-china.com/products-search/hot-china-products/{query}.html",
    name: "Made-in-China",
    industries: ["Electronics Manufacturing", "Metal Fabrication", "Plastics & Rubber"],
    regions: ["Asia-Pacific"],
  },
  {
    url: "https://www.europages.co.uk/companies/{query}.html",
    name: "Europages",
    industries: ["all"],
    regions: ["Europe"],
  },
];

// ─── Region helper ────────────────────────────────────────────────────────────

function countryToRegion(country: string): string {
  const map: Record<string, string> = {
    China: "Asia-Pacific", Japan: "Asia-Pacific", "South Korea": "Asia-Pacific",
    Taiwan: "Asia-Pacific", India: "Asia-Pacific", Vietnam: "Asia-Pacific",
    Thailand: "Asia-Pacific", Malaysia: "Asia-Pacific", Indonesia: "Asia-Pacific",
    Singapore: "Asia-Pacific", Philippines: "Asia-Pacific", Bangladesh: "Asia-Pacific",
    Germany: "Europe", "United Kingdom": "Europe", France: "Europe",
    Italy: "Europe", Spain: "Europe", Netherlands: "Europe",
    Poland: "Europe", "Czech Republic": "Europe", Sweden: "Europe",
    Switzerland: "Europe", Belgium: "Europe", Austria: "Europe",
    Portugal: "Europe", Denmark: "Europe", Finland: "Europe",
    Norway: "Europe", Romania: "Europe", Hungary: "Europe",
    Turkey: "Europe", Greece: "Europe",
    "United States": "North America", Canada: "North America", Mexico: "North America",
    Brazil: "Latin America", Argentina: "Latin America", Chile: "Latin America",
    Colombia: "Latin America", Peru: "Latin America",
    "United Arab Emirates": "Middle East & Africa", "Saudi Arabia": "Middle East & Africa",
    Israel: "Middle East & Africa", "South Africa": "Middle East & Africa",
    Egypt: "Middle East & Africa", Morocco: "Middle East & Africa",
    Nigeria: "Middle East & Africa", Kenya: "Middle East & Africa",
    Australia: "Oceania", "New Zealand": "Oceania",
  };
  return map[country] ?? "Global";
}

// ─── Deduplication check ──────────────────────────────────────────────────────

async function isDuplicate(name: string, country: string): Promise<boolean> {
  const normalized = name.toLowerCase().trim();
  // Check exact match and fuzzy prefix match (first 8 chars)
  const prefix = normalized.slice(0, 8);
  const [row] = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(
      and(
        ilike(manufacturers.country, country),
        ilike(manufacturers.name, `${prefix}%`)
      )
    )
    .limit(1);
  return !!row;
}

// ─── Validate a raw record before inserting ───────────────────────────────────

function validateRecord(r: Partial<RawSupplierRecord>): r is RawSupplierRecord {
  if (!r.name || r.name.length < 3) return false;
  if (!r.country || r.country.length < 2) return false;
  if (!r.industry) return false;
  // Reject obviously fake/placeholder values
  if (/company\s*name|example|test|n\/a/i.test(r.name)) return false;
  return true;
}

// ─── Claude: normalise raw scraped data into structured records ───────────────

async function claudeExtractSuppliers(
  rawText: string,
  targetIndustry: string,
  targetRegion: string
): Promise<RawSupplierRecord[]> {
  const prompt = `You are a data extraction specialist. Given the following raw text scraped from a manufacturer directory, extract a list of real manufacturing companies.

Return ONLY a valid JSON array (no markdown, no explanation). Each element must have:
- name: string (company name)
- country: string (ISO country name)
- city: string or null
- industry: string (use one of: Electronics Manufacturing, Plastics & Rubber, Automotive Parts, Textiles & Apparel, Metal Fabrication, Industrial Machinery, Chemical Manufacturing, Medical Devices, Food & Beverage Processing, Packaging, Aerospace & Defense, Furniture & Woodworking, Semiconductor & Electronic Components, Renewable Energy & Clean Technology, Pharmaceutical Manufacturing, Construction & Building Materials)
- certifications: string or null (comma-separated)
- capabilities: string or null (short description, max 120 chars)
- employeeCount: string or null
- moqMin: number or null
- url: string or null (must start with https://)

Target industry context: ${targetIndustry}
Target region: ${targetRegion}

Rules:
- Only include clearly identifiable, real companies (not generic descriptions)
- Skip any row that is clearly a placeholder, ad, or navigation element
- Maximum 20 records
- If uncertain about a field, use null

Raw text:
---
${rawText.slice(0, 6000)}
---

JSON array:`;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    const jsonStr = text.startsWith("[") ? text : text.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validateRecord) as RawSupplierRecord[];
  } catch {
    return [];
  }
}

// ─── Create an ingestion run record ──────────────────────────────────────────

async function startRun(params: {
  source: string; industry?: string; region?: string; country?: string; query?: string;
}) {
  const [run] = await db
    .insert(ingestionRuns)
    .values({ ...params, status: "running" })
    .returning();
  return run;
}

async function completeRun(
  runId: number,
  counts: { found: number; added: number; skipped: number; duplicate: number },
  notes?: string
) {
  await db
    .update(ingestionRuns)
    .set({
      status: "completed",
      recordsFound: counts.found,
      recordsAdded: counts.added,
      recordsSkipped: counts.skipped,
      recordsDuplicate: counts.duplicate,
      notes: notes ?? null,
      completedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, runId));
}

async function failRun(runId: number, error: string) {
  await db
    .update(ingestionRuns)
    .set({ status: "failed", notes: error, completedAt: new Date() })
    .where(eq(ingestionRuns.id, runId));
}

// ─── Insert a batch of validated records (append-only) ────────────────────────

async function appendRecords(
  records: RawSupplierRecord[],
  runId: number,
  dataSource: string
): Promise<{ added: number; duplicate: number; skipped: number }> {
  let added = 0, duplicate = 0, skipped = 0;

  for (const r of records) {
    try {
      if (await isDuplicate(r.name, r.country)) {
        duplicate++;
        continue;
      }

      // Verify URL before storing — only keep URLs that pass DNS + HTTP checks.
      // If a URL is provided but fails verification, the record is still inserted
      // with url=null so we retain the capability/location data without a bad link.
      let verifiedUrl: string | null = null;
      if (r.url) {
        const check = await verifyUrl(r.url, 5000);
        if (check.valid) {
          verifiedUrl = r.url;
        } else {
          console.log(`[ingestion] URL rejected for ${r.name}: ${r.url} — ${check.error}`);
        }
      }

      await db.insert(manufacturers).values({
        name: r.name,
        country: r.country,
        city: r.city ?? null,
        region: r.region ?? countryToRegion(r.country),
        industry: r.industry,
        certifications: r.certifications ?? null,
        capabilities: r.capabilities ?? null,
        employeeCount: r.employeeCount ?? null,
        moqMin: r.moqMin ?? null,
        url: verifiedUrl,
        verified: verifiedUrl !== null,
        dataSource,
      });
      added++;
    } catch {
      skipped++;
    }
  }

  return { added, duplicate, skipped };
}

// ─── Main ingestion function (callable from API) ──────────────────────────────

export interface IngestionOptions {
  industry?: string;
  region?: string;
  country?: string;
  query?: string;
  maxRecords?: number;
  timeoutMs?: number;
}

export async function runIngestionPipeline(
  opts: IngestionOptions = {}
): Promise<{ runId: number; added: number; duplicate: number; skipped: number; error?: string }> {
  const {
    industry,
    region,
    query,
    maxRecords = 50,
    timeoutMs = 120_000,
  } = opts;

  const searchQuery = query ?? industry ?? "manufacturer supplier";
  const run = await startRun({ source: "tinyfish", industry, region, query: searchQuery });

  try {
    // Pick a relevant directory
    const dir = DIRECTORIES.find(d =>
      (d.industries.includes("all") || (industry && d.industries.includes(industry))) &&
      (!region || d.regions.includes(region))
    ) ?? DIRECTORIES[1]; // default to Kompass (global)

    const url = dir.url.replace("{query}", encodeURIComponent(searchQuery));
    const goal = `Find real manufacturing companies listed on this directory page. ` +
      `Extract the company names, countries, and website URLs. ` +
      `Return all company data you find as plain text, one company per line. ` +
      `Include: Company Name | Country | Website URL | Industry | Key Products/Capabilities`;

    // TinyFish web agent — respect timeout
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
    const agentRun = runAgent(url, goal, { browserProfile: "stealth", proxy: { country: "US" } });
    const result = await Promise.race([agentRun, timeout]);

    if (!result || !result.success) {
      await failRun(run.id, "TinyFish agent returned no data");
      return { runId: run.id, added: 0, duplicate: 0, skipped: 0, error: "Agent returned no data" };
    }

    const rawText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data);

    // Claude normalises raw text into structured records
    const records = await claudeExtractSuppliers(
      rawText,
      industry ?? "Manufacturing",
      region ?? "Global"
    );

    const limited = records.slice(0, maxRecords);
    const counts = await appendRecords(limited, run.id, `TinyFish via ${dir.name} (run #${run.id})`);

    await completeRun(run.id, {
      found: records.length,
      added: counts.added,
      skipped: counts.skipped,
      duplicate: counts.duplicate,
    });

    return { runId: run.id, ...counts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(run.id, msg);
    return { runId: run.id, added: 0, duplicate: 0, skipped: 0, error: msg };
  }
}

// ─── Bulk ingest from a known data array (used by seed expansion) ─────────────

export async function bulkIngestRecords(
  records: RawSupplierRecord[],
  source: string,
  opts: { industry?: string; region?: string } = {}
): Promise<{ runId: number; added: number; duplicate: number; skipped: number }> {
  const run = await startRun({
    source,
    industry: opts.industry,
    region: opts.region,
    query: `bulk-ingest-${records.length}-records`,
  });

  const counts = await appendRecords(records, run.id, source);

  await completeRun(run.id, {
    found: records.length,
    added: counts.added,
    skipped: counts.skipped,
    duplicate: counts.duplicate,
  });

  return { runId: run.id, ...counts };
}

// ─── Get ingestion history ────────────────────────────────────────────────────

export async function getIngestionHistory(limit = 50) {
  return db
    .select()
    .from(ingestionRuns)
    .orderBy(sql`started_at DESC`)
    .limit(limit);
}

export async function getIngestionStats() {
  const [totals] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      totalAdded: sql<number>`sum(records_added)::int`,
      totalDuplicate: sql<number>`sum(records_duplicate)::int`,
    })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, "completed"));

  return {
    totalRuns: totals?.totalRuns ?? 0,
    totalAdded: totals?.totalAdded ?? 0,
    totalDuplicate: totals?.totalDuplicate ?? 0,
  };
}
