import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { suppliers as suppliersTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runAgent, extractSupplierInfo, submitRFQForm } from "./tinyfish";

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

  app.get("/api/manufacturers/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const m = await storage.getManufacturerById(id);
    if (!m) return res.status(404).json({ message: "Manufacturer not found" });
    res.json(m);
  });

  return httpServer;
}

// ---------------------------------------------------------------------------
// Scoring Logic
// ---------------------------------------------------------------------------
function scoreSupplier(
  supplierData: Record<string, any>,
  criteria: { certifications: string; maxMoq?: number | null; preferredLocation: string; spec: string }
): number {
  let score = 0;

  const certs = (supplierData.certifications || "").toLowerCase();
  const location = (supplierData.location || "").toLowerCase();
  const capabilities = (supplierData.capabilities || "").toLowerCase();
  const supplierMoq = supplierData.estimated_moq || supplierData.moq;

  // +3 for certification match
  if (criteria.certifications) {
    const requiredCerts = criteria.certifications.toLowerCase().split(/[,;]+/);
    const anyMatch = requiredCerts.some(c => certs.includes(c.trim()));
    if (anyMatch) score += 3;
  }

  // +2 for location match
  if (criteria.preferredLocation && location.includes(criteria.preferredLocation.toLowerCase())) {
    score += 2;
  }

  // +2 for MOQ below threshold
  if (criteria.maxMoq && supplierMoq && Number(supplierMoq) <= Number(criteria.maxMoq)) {
    score += 2;
  }

  // +1 for capabilities matching spec keywords
  const specKeywords = criteria.spec.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const capabilityMatches = specKeywords.filter(kw => capabilities.includes(kw));
  if (capabilityMatches.length > 0) score += 1;

  return score;
}

// ---------------------------------------------------------------------------
// Real TinyFish Discovery Pipeline
// ---------------------------------------------------------------------------
async function runDiscoveryPipeline(jobId: number, job: any) {
  const log = async (message: string) => {
    console.log(`[Job ${jobId}] ${message}`);
    await storage.addLog({ jobId, message });
  };

  try {
    await log("Multi-Agent Pipeline started.");

    // -----------------------------------------------------------------------
    // STEP 1: Discovery Agent — search real supplier directories
    // -----------------------------------------------------------------------
    await log("Discovery Agent: Searching ThomasNet for suppliers...");

    const searchGoal = `Search for manufacturers and suppliers of "${job.spec}".
Find at least 6 real company listings with their names and profile URLs.
Return JSON array: [{"name": "Company Name", "url": "https://full-profile-url"}]
Only return real companies with individual profile pages, not category pages.`;

    // Try multiple directories
    const directories = [
      {
        name: "ThomasNet",
        url: `https://www.thomasnet.com/search/?searchTerm=${encodeURIComponent(job.spec)}&what=${encodeURIComponent(job.spec)}&heading=${encodeURIComponent(job.spec)}`,
      },
      {
        name: "GlobalSources",
        url: `https://www.globalsources.com/Manufacturers/${encodeURIComponent(job.spec.split(" ").slice(0, 3).join("+"))}.htm`,
      },
    ];

    let discoveredSuppliers: Array<{ name: string; url: string }> = [];

    for (const dir of directories) {
      await log(`Discovery Agent: Querying ${dir.name}...`);
      const result = await runAgent(dir.url, searchGoal, { browserProfile: "stealth", proxy: { country: "US" } });

      if (result.success && result.data) {
        let suppliers: any[] = [];
        if (Array.isArray(result.data)) {
          suppliers = result.data;
        } else if (Array.isArray(result.data.suppliers)) {
          suppliers = result.data.suppliers;
        } else if (Array.isArray(result.data.results)) {
          suppliers = result.data.results;
        }

        const valid = suppliers.filter((s: any) => s.name && s.url && s.url.startsWith("http"));
        await log(`Discovery Agent: Found ${valid.length} supplier profiles on ${dir.name}.`);
        discoveredSuppliers.push(...valid);
      } else {
        await log(`Discovery Agent: ${dir.name} returned no results (${result.error || "empty response"}). Continuing...`);
      }

      if (discoveredSuppliers.length >= 6) break;
    }

    // Fallback: if we couldn't get real suppliers, use a known list of real manufacturers
    // based on the spec type for demo purposes
    if (discoveredSuppliers.length === 0) {
      await log("Discovery Agent: Using fallback supplier list from known manufacturer databases...");
      discoveredSuppliers = getFallbackSuppliers(job.spec);
      await log(`Discovery Agent: Loaded ${discoveredSuppliers.length} known manufacturers.`);
    }

    await log(`Discovery Agent: Total of ${discoveredSuppliers.length} supplier profiles queued for qualification.`);

    // -----------------------------------------------------------------------
    // STEP 2: Qualification Agent — visit each supplier and extract data
    // -----------------------------------------------------------------------
    await log("Qualification Agent: Visiting supplier websites to extract capabilities...");

    const qualifiedSuppliers: Array<{
      name: string;
      url: string;
      extracted: Record<string, any>;
    }> = [];

    const limit = Math.min(discoveredSuppliers.length, 8);

    for (let i = 0; i < limit; i++) {
      const sup = discoveredSuppliers[i];
      await log(`Qualification Agent: Visiting ${sup.name} (${sup.url})...`);

      try {
        const extracted = await extractSupplierInfo(sup.url, job.spec);

        if (extracted) {
          await log(`Qualification Agent: Extracted capabilities for ${sup.name}. Certifications: ${extracted.certifications || "none found"}`);
          qualifiedSuppliers.push({ name: sup.name, url: sup.url, extracted });
        } else {
          await log(`Qualification Agent: Could not extract data from ${sup.name}. Skipping.`);
        }
      } catch (err) {
        await log(`Qualification Agent: Error visiting ${sup.name}: ${err}`);
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 800));
    }

    await log(`Qualification Agent: Successfully qualified ${qualifiedSuppliers.length} suppliers.`);

    // -----------------------------------------------------------------------
    // STEP 3: Scoring Agent
    // -----------------------------------------------------------------------
    await log("Scoring Agent: Ranking suppliers based on your criteria...");

    const criteria = {
      certifications: job.certifications || "",
      maxMoq: job.maxMoq,
      preferredLocation: job.preferredLocation || "",
      spec: job.spec,
    };

    const scored = qualifiedSuppliers.map(sup => {
      const score = scoreSupplier(sup.extracted, criteria);
      return { ...sup, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    await log(`Scoring Agent: Top supplier scored ${scored[0]?.score ?? 0}/8 points.`);

    // Save all suppliers to DB
    for (const sup of scored) {
      await storage.addSupplier({
        jobId,
        name: sup.extracted.supplier_name || sup.name,
        url: sup.url,
        location: sup.extracted.location || null,
        certifications: sup.extracted.certifications || null,
        capabilities: sup.extracted.capabilities || null,
        moq: sup.extracted.estimated_moq ? Number(sup.extracted.estimated_moq) : null,
        score: sup.score,
        rfqSent: false,
        confidenceScore: sup.extracted.confidence_score ? Number(sup.extracted.confidence_score) : null,
      });
    }

    // -----------------------------------------------------------------------
    // STEP 4: RFQ Agent — submit contact forms for top-scoring suppliers
    // -----------------------------------------------------------------------
    await log("RFQ Agent: Identifying top suppliers for RFQ submission...");

    const threshold = 4;
    const topSuppliers = scored.filter(s => s.score >= threshold).slice(0, 4);

    if (topSuppliers.length === 0) {
      await log("RFQ Agent: No suppliers met the score threshold. Skipping RFQ submissions.");
    } else {
      await log(`RFQ Agent: Submitting RFQ to ${topSuppliers.length} qualifying suppliers.`);
    }

    for (const sup of topSuppliers) {
      await log(`RFQ Agent: Navigating to ${sup.name} contact page...`);

      const rfqResult = await submitRFQForm(sup.url, {
        name: "Procurement Team",
        company: "SupplyScout Client",
        email: "procurement@supplyscout.io",
        spec: job.spec,
      });

      if (rfqResult.success) {
        await log(`RFQ Agent: RFQ form submitted successfully to ${sup.name}. Confirmation: "${rfqResult.message}"`);
      } else {
        await log(`RFQ Agent: Could not submit RFQ to ${sup.name}: ${rfqResult.message}`);
      }

      // Mark RFQ as sent in DB regardless (we attempted it)
      const allSuppliers = await storage.getSuppliersByJobId(jobId);
      const dbSupplier = allSuppliers.find(s => s.url === sup.url || s.name === (sup.extracted.supplier_name || sup.name));
      if (dbSupplier) {
        await db.update(suppliersTable)
          .set({ rfqSent: rfqResult.success })
          .where(eq(suppliersTable.id, dbSupplier.id));
      }

      await new Promise(r => setTimeout(r, 600));
    }

    // -----------------------------------------------------------------------
    // STEP 5: Results Synthesis — Claude summarizes findings
    // -----------------------------------------------------------------------
    await log("Results Synthesis: Claude API summarizing all supplier findings...");

    try {
      const supplierSummaries = scored.map(s =>
        `${s.extracted.supplier_name || s.name} (Score: ${s.score}/8) — ${s.extracted.location || "Unknown location"} — ${s.extracted.certifications || "No certs"}`
      ).join("\n");

      const summaryResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: `Summarize these supplier discovery results in 2-3 sentences for a procurement manager. Product spec: "${job.spec}". Suppliers found:\n${supplierSummaries}`
        }]
      });

      const summaryContent = summaryResponse.content[0];
      if (summaryContent.type === "text") {
        await log(`Summary: ${summaryContent.text}`);
      }
    } catch (err) {
      await log("Results Synthesis: Summary generation skipped.");
    }

    // Complete the job
    await storage.updateJobStatus(jobId, "completed");
    await log("Pipeline complete. All agents finished successfully.");

  } catch (error) {
    console.error(`[Job ${jobId}] Pipeline error:`, error);
    await storage.addLog({ jobId, message: `Pipeline Error: ${String(error)}` });
    await storage.updateJobStatus(jobId, "failed");
  }
}

// ---------------------------------------------------------------------------
// Fallback: Known real manufacturers for demo when TinyFish can't access dirs
// ---------------------------------------------------------------------------
function getFallbackSuppliers(spec: string): Array<{ name: string; url: string }> {
  // A curated list of real, verifiable manufacturers across categories
  const allSuppliers = [
    // Plastics / Injection Molding
    { name: "Nypro (Jabil)", url: "https://www.jabil.com/capabilities/healthcare/nypro.html", tags: ["plastic", "injection", "enclosure", "ABS"] },
    { name: "Rodon Group", url: "https://www.rodongroup.com", tags: ["plastic", "injection", "molding", "ABS"] },
    { name: "Kaysun Corporation", url: "https://www.kaysun.com", tags: ["plastic", "injection", "molding"] },
    { name: "Triangle Package Machinery", url: "https://www.trianglepackage.com", tags: ["packaging", "machine"] },
    { name: "Proto Labs", url: "https://www.protolabs.com", tags: ["plastic", "CNC", "metal", "injection", "3D"] },
    { name: "Fictiv", url: "https://www.fictiv.com", tags: ["plastic", "CNC", "metal", "3D", "injection"] },
    // Electronics
    { name: "Jabil", url: "https://www.jabil.com", tags: ["electronics", "PCB", "assembly", "EMS"] },
    { name: "Foxconn Industrial Internet", url: "https://www.fii-foxconn.com", tags: ["electronics", "assembly", "PCB"] },
    { name: "Celestica", url: "https://www.celestica.com", tags: ["electronics", "PCB", "assembly"] },
    // Metal / Machining
    { name: "Precision Castparts", url: "https://www.precastparts.com", tags: ["metal", "casting", "aerospace"] },
    { name: "Proto Labs CNC", url: "https://www.protolabs.com/services/cnc-machining/", tags: ["CNC", "metal", "machining"] },
    { name: "Xometry", url: "https://www.xometry.com", tags: ["CNC", "metal", "sheet metal", "3D"] },
    // Textiles
    { name: "American & Efird", url: "https://www.amefird.com", tags: ["textile", "fabric", "thread", "sewing"] },
    { name: "Hanesbrands", url: "https://www.hanesbrands.com", tags: ["textile", "apparel", "clothing"] },
    // Food / Pharma
    { name: "Cambrex", url: "https://www.cambrex.com", tags: ["pharma", "API", "chemical", "drug"] },
    { name: "contract manufacturing pharma", url: "https://www.patheon.com", tags: ["pharma", "drug", "FDA", "GMP"] },
  ];

  const specLower = spec.toLowerCase();
  const specWords = specLower.split(/\s+/);

  // Score each supplier based on tag matches
  const scored = allSuppliers.map(s => {
    const tagMatches = s.tags.filter(t => specWords.some(w => w.includes(t) || t.includes(w)));
    return { ...s, relevance: tagMatches.length };
  });

  scored.sort((a, b) => b.relevance - a.relevance);

  // Return the top 7 most relevant
  return scored.slice(0, 7).map(s => ({ name: s.name, url: s.url }));
}
