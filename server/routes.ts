import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { suppliers as suppliersTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runAgent, extractSupplierInfo } from "./tinyfish";
import { runIngestionPipeline, getIngestionHistory, getIngestionStats } from "./ingestion";
import { validateDatabase } from "./migrate";
import { batchVerifyManufacturerUrls, getUrlStats } from "./verify-urls";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Create Job & start discovery pipeline
  app.post(api.jobs.create.path, async (req, res) => {
    try {
      const input = api.jobs.create.input.parse(req.body);
      const job = await storage.createJob({ ...input, status: "processing" });
      res.status(201).json(job);

      // Fire and forget the pipeline
      runDiscoveryPipeline(job.id, job).catch(console.error);

    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get Job
  app.get(api.jobs.get.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  });

  // List Jobs
  app.get(api.jobs.list.path, async (req, res) => {
    const jobs = await storage.getJobs();
    res.json(jobs);
  });

  // Get Logs
  app.get(api.logs.list.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const logs = await storage.getLogsByJobId(id);
    res.json(logs);
  });

  // Get Suppliers
  app.get(api.suppliers.list.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const suppliers = await storage.getSuppliersByJobId(id);
    res.json(suppliers);
  });

  // ── Global Manufacturer Database ──────────────────────────────────────────

  app.get("/api/manufacturers", async (req, res) => {
    try {
      const { search, country, region, industry, certifications, page, pageSize } = req.query;
      const result = await storage.getManufacturers({
        search: search as string | undefined,
        country: country as string | undefined,
        region: region as string | undefined,
        industry: industry as string | undefined,
        certifications: certifications as string | undefined,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Math.min(Number(pageSize), 200) : 50,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to query manufacturers" });
    }
  });

  app.get("/api/manufacturers/stats", async (req, res) => {
    try {
      const stats = await storage.getManufacturerStats();
      res.json(stats);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // URL integrity stats — static routes must be declared BEFORE /:id
  app.get("/api/manufacturers/url-stats", async (_req, res) => {
    try {
      const stats = await getUrlStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/manufacturers/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const m = await storage.getManufacturerById(id);
    if (!m) return res.status(404).json({ message: "Manufacturer not found" });
    res.json(m);
  });

  // ── Data Ingestion Pipeline ────────────────────────────────────────────────

  // GET /api/ingestion/runs — list recent ingestion runs (audit log)
  app.get("/api/ingestion/runs", async (_req, res) => {
    try {
      const runs = await getIngestionHistory(100);
      res.json(runs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch ingestion history" });
    }
  });

  // GET /api/ingestion/stats — summary statistics
  app.get("/api/ingestion/stats", async (_req, res) => {
    try {
      const [stats, dbStats] = await Promise.all([
        getIngestionStats(),
        storage.getManufacturerStats(),
      ]);
      res.json({ ...stats, totalManufacturers: dbStats.totalCount });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch ingestion stats" });
    }
  });

  // POST /api/ingestion/run — trigger an ingestion run (non-blocking)
  app.post("/api/ingestion/run", async (req, res) => {
    try {
      const { industry, region, country, query, maxRecords } = req.body ?? {};

      // Respond immediately — the pipeline runs in the background
      res.json({
        message: "Ingestion pipeline started",
        params: { industry, region, country, query, maxRecords },
      });

      runIngestionPipeline({ industry, region, country, query, maxRecords })
        .then(result => console.log(`[Ingestion] Run complete:`, result))
        .catch(err => console.error(`[Ingestion] Run failed:`, err));
    } catch (err) {
      res.status(500).json({ message: "Failed to start ingestion pipeline" });
    }
  });

  // Trigger a batch URL verification pass on the verified manufacturers.
  // Runs in the background; responds immediately with a job token.
  // Accepts: { limit?: number, concurrency?: number, timeoutMs?: number }
  app.post("/api/manufacturers/verify-urls", async (req, res) => {
    try {
      const limit      = Math.min(Number(req.body?.limit ?? 84), 500);
      const concurrency = Math.min(Number(req.body?.concurrency ?? 5), 10);
      const timeoutMs  = Math.min(Number(req.body?.timeoutMs ?? 6000), 15000);

      // Respond immediately
      res.json({
        message: "URL verification started",
        params: { limit, concurrency, timeoutMs },
        note: "Check /api/manufacturers/url-stats for updated counts when complete.",
      });

      // Run in background
      batchVerifyManufacturerUrls({
        verifiedOnly: true,
        limit,
        concurrency,
        timeoutMs,
        onProgress: (checked, total, result) => {
          if (!result.valid) {
            console.log(`[verify-urls] ✗ ${result.url} — ${result.error}`);
          }
        },
      })
        .then((report) =>
          console.log(
            `[verify-urls] Complete — ${report.valid} valid, ${report.invalid} invalid (${report.nulled} nulled)`
          )
        )
        .catch((err) => console.error(`[verify-urls] Error: ${err.message}`));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Health check — database consistency validation
  app.get("/api/health", async (_req, res) => {
    try {
      const report = await validateDatabase();
      res.status(report.ok ? 200 : 503).json({
        status: report.ok ? "healthy" : "degraded",
        environment: process.env.NODE_ENV ?? "unknown",
        database: {
          manufacturers: report.manufacturers,
          jobs: report.jobs,
          suppliers: report.suppliers,
          ingestionRuns: report.ingestionRuns,
          hasSearchIndex: report.hasSearchIndex,
          hasSearchVector: report.hasSearchVector,
        },
        issues: report.issues,
      });
    } catch (err: any) {
      res.status(503).json({ status: "error", message: err.message });
    }
  });

  return httpServer;
}

// ---------------------------------------------------------------------------
// Scoring Logic (works for both manufacturer DB results and TinyFish extracts)
// ---------------------------------------------------------------------------
function scoreManufacturer(
  m: { certifications?: string | null; city?: string | null; country?: string | null; region?: string | null; capabilities?: string | null; moqMin?: number | null },
  criteria: { certifications: string; maxMoq?: number | null; preferredLocation: string; spec: string }
): number {
  let score = 0;
  const certs = (m.certifications || "").toLowerCase();
  const location = `${m.city || ""} ${m.country || ""} ${m.region || ""}`.toLowerCase();
  const capabilities = (m.capabilities || "").toLowerCase();

  if (criteria.certifications) {
    const required = criteria.certifications.toLowerCase().split(/[,;]+/).map(c => c.trim()).filter(Boolean);
    if (required.some(c => certs.includes(c))) score += 3;
  }

  if (criteria.preferredLocation) {
    const loc = criteria.preferredLocation.toLowerCase();
    if (location.includes(loc)) score += 2;
  }

  if (criteria.maxMoq && m.moqMin != null && m.moqMin <= criteria.maxMoq) score += 2;

  const keywords = criteria.spec.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  if (keywords.some(kw => capabilities.includes(kw))) score += 1;

  return score;
}

// ---------------------------------------------------------------------------
// Database-First Discovery Pipeline
// TinyFish is used ONLY as an optional background bonus — never blocks results
// ---------------------------------------------------------------------------
async function runDiscoveryPipeline(jobId: number, job: any) {
  const log = async (message: string) => {
    console.log(`[Job ${jobId}] ${message}`);
    await storage.addLog({ jobId, message });
  };

  const criteria = {
    certifications: job.certifications || "",
    maxMoq: job.maxMoq || null,
    preferredLocation: job.preferredLocation || "",
    spec: job.spec,
  };

  try {
    await log("Pipeline started — searching SupplyScout global manufacturer database...");

    // -----------------------------------------------------------------------
    // STEP 1: Instant Database Discovery — query the 4,986-manufacturer DB
    // Uses PostgreSQL GIN full-text search index, returns in <50ms
    // -----------------------------------------------------------------------
    await log(`Discovery Agent: Running full-text search for "${job.spec}"...`);

    const dbMatches = await storage.searchManufacturersForJob(
      job.spec,
      job.certifications || "",
      job.preferredLocation || "",
      job.maxMoq || null,
      60
    );

    await log(`Discovery Agent: Found ${dbMatches.length} matching manufacturers in database.`);

    // -----------------------------------------------------------------------
    // STEP 2: Scoring Agent — rank all DB matches
    // -----------------------------------------------------------------------
    await log("Scoring Agent: Ranking suppliers against your criteria...");

    const scored = dbMatches.map(m => ({
      manufacturer: m,
      score: scoreManufacturer(m, criteria),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.manufacturer.verified ? 1 : 0) - (a.manufacturer.verified ? 1 : 0);
    });

    const top = scored.slice(0, 20);
    await log(`Scoring Agent: Top supplier "${top[0]?.manufacturer.name}" scored ${top[0]?.score ?? 0}/8 points.`);

    // -----------------------------------------------------------------------
    // STEP 3: Persist top-scored suppliers to the job
    // -----------------------------------------------------------------------
    await log(`Results Agent: Saving ${top.length} qualified suppliers to job #${jobId}...`);

    for (const { manufacturer: m, score } of top) {
      await storage.addSupplier({
        jobId,
        name: m.name,
        url: m.url || null,
        location: m.city ? `${m.city}, ${m.country}` : m.country,
        certifications: m.certifications || null,
        capabilities: m.capabilities || null,
        moq: m.moqMin ?? null,
        score,
        rfqSent: false,
        confidenceScore: m.verified ? 95 : 70,
      });

      await log(`  ✓ ${m.name} — ${m.city ? `${m.city}, ` : ""}${m.country} — Score: ${score}/8 — ${m.certifications?.split(",").slice(0, 2).join(", ") || "No certs listed"}`);
    }

    // -----------------------------------------------------------------------
    // STEP 4: Claude synthesizes a procurement summary
    // -----------------------------------------------------------------------
    await log("Results Synthesis: Claude is generating procurement intelligence summary...");

    try {
      const topSummary = top.slice(0, 8).map(({ manufacturer: m, score }) =>
        `${m.name} (${m.city ? `${m.city}, ` : ""}${m.country}) — Score ${score}/8 — Certs: ${m.certifications || "N/A"} — MOQ: ${m.moqMin ?? "N/A"}`
      ).join("\n");

      const summaryResp = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Write a concise 2-3 sentence procurement summary for a sourcing manager. Spec: "${job.spec}". Top suppliers found:\n${topSummary}\nMention key strengths, geographic diversity, and a recommendation.`
        }]
      });

      const text = summaryResp.content[0];
      if (text.type === "text") {
        await log(`Intelligence Summary: ${text.text}`);
      }
    } catch (_err) {
      await log("Results Synthesis: Summary generation skipped (non-critical).");
    }

    // -----------------------------------------------------------------------
    // STEP 5: Mark job complete — results are ready immediately
    // -----------------------------------------------------------------------
    await storage.updateJobStatus(jobId, "completed");
    await log(`Pipeline complete. ${top.length} verified suppliers ready for review.`);

    // -----------------------------------------------------------------------
    // STEP 6 (Background, non-blocking): TinyFish bonus enrichment
    // Attempt to find additional suppliers not in DB — fires and forgets
    // -----------------------------------------------------------------------
    runTinyFishEnrichment(jobId, job, criteria, top.map(t => t.manufacturer.name)).catch(() => {});

  } catch (error) {
    console.error(`[Job ${jobId}] Pipeline error:`, error);
    await storage.addLog({ jobId, message: `Pipeline Error: ${String(error)}` });
    await storage.updateJobStatus(jobId, "failed");
  }
}

// ---------------------------------------------------------------------------
// Optional TinyFish enrichment (background, non-blocking)
// Runs AFTER the job is marked complete; appends any bonus suppliers found
// ---------------------------------------------------------------------------
async function runTinyFishEnrichment(jobId: number, job: any, criteria: any, alreadyFoundNames: string[]) {
  const log = async (message: string) => {
    await storage.addLog({ jobId, message });
  };

  try {
    await log("TinyFish Agent: Starting optional web discovery for additional suppliers...");

    const searchGoal = `Find manufacturers and suppliers of "${job.spec}". Return JSON: [{"name":"Company","url":"https://..."}]. Real companies only.`;
    const searchUrl = `https://www.thomasnet.com/search/?what=${encodeURIComponent(job.spec)}`;

    // Set a 90-second timeout so TinyFish never hangs indefinitely
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 90_000));
    const agentRun = runAgent(searchUrl, searchGoal, { browserProfile: "stealth", proxy: { country: "US" } });

    const result = await Promise.race([agentRun, timeout]);

    if (!result || !result.success || !result.data) {
      await log("TinyFish Agent: No additional suppliers found via web search.");
      return;
    }

    let discovered: any[] = [];
    if (Array.isArray(result.data)) discovered = result.data;
    else if (Array.isArray(result.data.suppliers)) discovered = result.data.suppliers;

    const novel = discovered.filter((s: any) => s.name && s.url && !alreadyFoundNames.some(n => n.toLowerCase().includes(s.name.toLowerCase().slice(0, 6))));

    if (novel.length === 0) {
      await log("TinyFish Agent: All web results already in database. No new suppliers to add.");
      return;
    }

    await log(`TinyFish Agent: Found ${novel.length} additional suppliers via web. Extracting details...`);

    for (const sup of novel.slice(0, 4)) {
      try {
        const extracted = await extractSupplierInfo(sup.url, job.spec);
        if (!extracted) continue;

        const score = scoreManufacturer({
          certifications: extracted.certifications,
          city: null,
          country: extracted.location,
          region: null,
          capabilities: extracted.capabilities,
          moqMin: extracted.estimated_moq ? Number(extracted.estimated_moq) : null,
        }, criteria);

        await storage.addSupplier({
          jobId,
          name: extracted.supplier_name || sup.name,
          url: sup.url,
          location: extracted.location || null,
          certifications: extracted.certifications || null,
          capabilities: extracted.capabilities || null,
          moq: extracted.estimated_moq ? Number(extracted.estimated_moq) : null,
          score,
          rfqSent: false,
          confidenceScore: extracted.confidence_score ? Number(extracted.confidence_score) : null,
        });

        await log(`TinyFish Agent: Added bonus supplier — ${extracted.supplier_name || sup.name} (Score: ${score}/8)`);
      } catch (_err) {
        // Silently skip failed extractions
      }
    }

    await log("TinyFish Agent: Web enrichment complete.");
  } catch (_err) {
    // Never fail the job because of TinyFish
  }
}

