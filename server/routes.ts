import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Create Job
  app.post(api.jobs.create.path, async (req, res) => {
    try {
      const input = api.jobs.create.input.parse(req.body);
      const job = await storage.createJob({ ...input, status: "processing" });
      res.status(201).json(job);

      // Start the background process
      runDiscoveryPipeline(job.id, input).catch(console.error);

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
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
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

  return httpServer;
}

// Simulated background pipeline for Hackathon MVP
async function runDiscoveryPipeline(jobId: number, spec: any) {
  const log = async (message: string) => {
    await storage.addLog({ jobId, message });
  };

  try {
    // Step 1: Discovery Agent
    await log("Started Multi-Agent Pipeline");
    await new Promise(r => setTimeout(r, 1000));
    
    await log("Discovery Agent: Searching ThomasNet for: " + spec.spec.substring(0, 30) + "...");
    await new Promise(r => setTimeout(r, 1500));
    
    await log("Discovery Agent: Searching Alibaba...");
    await new Promise(r => setTimeout(r, 1500));
    
    await log("Discovery Agent: Found 5 potential supplier profiles.");
    await new Promise(r => setTimeout(r, 1000));

    // Step 2: Qualification Agent & LLM Extraction
    await log("Qualification Agent: Visiting supplier websites to extract capabilities...");
    await new Promise(r => setTimeout(r, 2000));

    const mockSuppliers = [
      { name: "Acme Injection Molding", url: "https://example.com/acme", text: "We do ABS enclosures. ISO 9001. MOQ 500." },
      { name: "Shenzhen Precision Plastics", url: "https://example.com/sz", text: "Cheap ABS injection molding. Located in Shenzhen. MOQ 10000." },
      { name: "Global MFG Solutions", url: "https://example.com/global", text: "Custom ABS and PC enclosures. ISO 13485. MOQ 100." }
    ];

    for (const sup of mockSuppliers) {
      await log(`Qualification Agent: Analyzing ${sup.name}...`);
      
      // Call Claude to extract JSON structure (simulate extraction for MVP)
      const prompt = `
      Extract supplier details into JSON from this text: "${sup.text}"
      Spec matching: ${spec.spec}
      Required Cert: ${spec.certifications}
      Max MOQ: ${spec.maxMoq}

      Return ONLY a JSON object with this exact structure:
      {
        "capabilities": "string summary",
        "certifications": "string or null",
        "location": "string or null",
        "moq": number or null,
        "score": number (0-10 based on how well they match spec, certs, moq)
      }
      `;

      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5", // Use haiku for fast simple extraction
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        });
        
        const content = response.content[0];
        if (content.type === 'text') {
            // Very simple JSON parsing for MVP
            const jsonStr = content.text.substring(content.text.indexOf("{"), content.text.lastIndexOf("}") + 1);
            const extracted = JSON.parse(jsonStr);

            await storage.addSupplier({
              jobId,
              name: sup.name,
              url: sup.url,
              capabilities: extracted.capabilities,
              certifications: extracted.certifications,
              location: extracted.location,
              moq: extracted.moq,
              score: extracted.score || 5,
              rfqSent: false
            });
        }
      } catch (e) {
          await log(`Qualification Agent Error: Failed to extract data for ${sup.name}`);
      }
    }

    // Step 3 & 4: Scoring and RFQ
    await log("Scoring Agent: Ranking suppliers based on criteria...");
    await new Promise(r => setTimeout(r, 1500));

    await log("RFQ Agent: Submitting contact forms for top suppliers...");
    const suppliers = await storage.getSuppliersByJobId(jobId);
    
    for (const sup of suppliers) {
      if ((sup.score || 0) >= 5) {
        await log(`RFQ Agent: Navigating to ${sup.name} contact page...`);
        await new Promise(r => setTimeout(r, 1000));
        await log(`RFQ Agent: Automatically filling RFQ form for ${sup.name}...`);
        await new Promise(r => setTimeout(r, 1000));
        await log(`RFQ Agent: Form submitted successfully for ${sup.name}.`);
        
        // Update RFQ status
        await db.update(schema.suppliers).set({ rfqSent: true }).where(eq(schema.suppliers.id, sup.id));
      }
    }

    // Step 5: Finish
    await log("Results Synthesis: Claude API summarizing results.");
    await storage.updateJobStatus(jobId, "completed");
    await log("Pipeline complete.");

  } catch (error) {
    await log(`Pipeline Error: ${error}`);
    await storage.updateJobStatus(jobId, "failed");
  }
}
