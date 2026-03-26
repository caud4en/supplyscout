/**
 * URL Verification Module
 *
 * Validates whether stored manufacturer URLs are real and reachable.
 * Uses three-layer verification:
 *   1. DNS resolution — does the domain exist?
 *   2. HTTP/S reachability — does it respond with a success or redirect code?
 *   3. Content sanity — is it a real page, not a domain-parking placeholder?
 *
 * Design:
 *   - All checks have hard timeouts to prevent hanging
 *   - Batch processing with concurrency control (no more than 5 parallel checks)
 *   - Idempotent — safe to call repeatedly; re-checks existing records
 *   - Never deletes rows; marks URL as null if invalid
 */

import { lookup as dnsLookup } from "dns";
import { promisify } from "util";
import { pool } from "./db";

const dnsResolve = promisify(dnsLookup);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerificationResult {
  url: string;
  valid: boolean;
  statusCode?: number;
  dnsOk: boolean;
  httpOk: boolean;
  contentOk: boolean;
  error?: string;
  latencyMs?: number;
}

// ─── Parking/placeholder page signals ─────────────────────────────────────────

const PARKING_SIGNALS = [
  "domain for sale",
  "buy this domain",
  "parked domain",
  "this domain is parked",
  "godaddy.com",
  "sedo.com",
  "dan.com",
  "hugedomains.com",
  "namecheap.com/domains/parking",
  "underconstruction",
  "under construction",
  "coming soon",
  "page not found",
  "website coming soon",
];

// ─── Single URL verification ──────────────────────────────────────────────────

export async function verifyUrl(rawUrl: string, timeoutMs = 6000): Promise<VerificationResult> {
  const result: VerificationResult = {
    url: rawUrl,
    valid: false,
    dnsOk: false,
    httpOk: false,
    contentOk: false,
  };

  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
    if (!hostname) throw new Error("No hostname");
  } catch {
    result.error = "Malformed URL";
    return result;
  }

  // ── Layer 1: DNS resolution ──────────────────────────────────────────────
  try {
    await dnsResolve(hostname);
    result.dnsOk = true;
  } catch (err: any) {
    result.error = `DNS failed: ${err.code ?? err.message}`;
    return result;
  }

  // ── Layer 2: HTTP reachability ───────────────────────────────────────────
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(rawUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SupplyScout/1.0; +https://supplyscout.replit.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    clearTimeout(timer);
    result.latencyMs = Date.now() - start;
    result.statusCode = response.status;

    // Accept 2xx and 3xx (redirects were already followed, so final status matters)
    if (response.status >= 200 && response.status < 400) {
      result.httpOk = true;
    } else {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    // ── Layer 3: Content sanity ────────────────────────────────────────────
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      // Non-HTML response is still a real endpoint (could be an API, CDN, etc.)
      result.contentOk = true;
    } else {
      const text = (await response.text()).toLowerCase().slice(0, 4096);
      const isParked = PARKING_SIGNALS.some((s) => text.includes(s));
      if (isParked) {
        result.error = "Domain-parking or placeholder page detected";
        return result;
      }
      // Must have some real content
      result.contentOk = text.length > 200;
      if (!result.contentOk) {
        result.error = "Page content too thin";
        return result;
      }
    }

    result.valid = result.dnsOk && result.httpOk && result.contentOk;
    return result;
  } catch (err: any) {
    clearTimeout(timer);
    const name = err?.name ?? "";
    result.error = name === "AbortError" ? `Timeout after ${timeoutMs}ms` : err.message;
    return result;
  }
}

// ─── Batch verification with concurrency control ───────────────────────────────

async function runBatch<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 5
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

// ─── Database verification pass ───────────────────────────────────────────────

export interface BatchVerifyOptions {
  /** Only check verified=true rows (the 84 real manufacturers). Default: true */
  verifiedOnly?: boolean;
  /** Maximum rows to check in this pass. Default: 500 */
  limit?: number;
  /** Concurrency of parallel HTTP checks. Default: 5 */
  concurrency?: number;
  /** HTTP timeout per URL in ms. Default: 6000 */
  timeoutMs?: number;
  /** Progress callback */
  onProgress?: (checked: number, total: number, last: VerificationResult) => void;
}

export interface BatchVerifyReport {
  total: number;
  valid: number;
  invalid: number;
  nulled: number;
  errors: string[];
}

export async function batchVerifyManufacturerUrls(
  opts: BatchVerifyOptions = {}
): Promise<BatchVerifyReport> {
  const {
    verifiedOnly = true,
    limit = 500,
    concurrency = 5,
    timeoutMs = 6000,
    onProgress,
  } = opts;

  const client = await pool.connect();
  let rows: Array<{ id: number; url: string }>;

  try {
    const whereClause = verifiedOnly
      ? `WHERE verified = true AND url IS NOT NULL`
      : `WHERE url IS NOT NULL AND verified = true`;

    const res = await client.query<{ id: number; url: string }>(
      `SELECT id, url FROM manufacturers ${whereClause} LIMIT $1`,
      [limit]
    );
    rows = res.rows;
  } finally {
    client.release();
  }

  const report: BatchVerifyReport = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    nulled: 0,
    errors: [],
  };

  let checked = 0;

  await runBatch(
    rows,
    async (row) => {
      const result = await verifyUrl(row.url, timeoutMs);
      checked++;
      onProgress?.(checked, rows.length, result);

      const dbClient = await pool.connect();
      try {
        if (result.valid) {
          // Confirm verified flag is set
          await dbClient.query(
            `UPDATE manufacturers SET verified = true WHERE id = $1`,
            [row.id]
          );
          report.valid++;
        } else {
          // Null out the bad URL and unset verified flag
          await dbClient.query(
            `UPDATE manufacturers SET url = null, verified = false WHERE id = $1`,
            [row.id]
          );
          report.invalid++;
          report.nulled++;
          if (result.error) {
            report.errors.push(`[${row.url}] ${result.error}`);
          }
        }
      } finally {
        dbClient.release();
      }
    },
    concurrency
  );

  return report;
}

// ─── Null out all template-generated fake URLs (one-time cleanup) ──────────────

export async function nullifyTemplateUrls(): Promise<{ updated: number }> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      UPDATE manufacturers
      SET url   = null,
          email = null
      WHERE verified = false
        AND url IS NOT NULL
        AND data_source ILIKE '%Generated%'
    `);
    return { updated: res.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

// ─── Quick URL stats ──────────────────────────────────────────────────────────

export async function getUrlStats(): Promise<{
  totalManufacturers: number;
  withUrl: number;
  withoutUrl: number;
  verifiedWithUrl: number;
  verifiedWithoutUrl: number;
  unverifiedWithUrl: number;
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        count(*)::int                                                  AS total,
        count(*) FILTER (WHERE url IS NOT NULL)::int                  AS with_url,
        count(*) FILTER (WHERE url IS NULL)::int                      AS without_url,
        count(*) FILTER (WHERE verified = true  AND url IS NOT NULL)::int AS verified_with_url,
        count(*) FILTER (WHERE verified = true  AND url IS NULL)::int     AS verified_without_url,
        count(*) FILTER (WHERE verified = false AND url IS NOT NULL)::int AS unverified_with_url
      FROM manufacturers
    `);
    const r = res.rows[0];
    return {
      totalManufacturers: r.total,
      withUrl: r.with_url,
      withoutUrl: r.without_url,
      verifiedWithUrl: r.verified_with_url,
      verifiedWithoutUrl: r.verified_without_url,
      unverifiedWithUrl: r.unverified_with_url,
    };
  } finally {
    client.release();
  }
}
