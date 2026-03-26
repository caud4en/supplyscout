/**
 * SupplyScout — Collection Campaign Engine
 *
 * Defines 105 manufacturing industry categories and a batch runner that
 * drives parallel TinyFish sessions against real public directories to
 * collect verified manufacturer data at scale.
 *
 * Architecture:
 *   CAMPAIGN_CONFIGS ─► batch runner ─► runIngestionPipeline (one per session)
 *                                     ─► Claude extraction
 *                                     ─► 3-layer URL verification
 *                                     ─► dedupe + append to DB
 *
 * Guarantees: same zero-tolerance data integrity as the main pipeline.
 *   ✓ Only verified companies with confirmed URLs enter the DB
 *   ✓ Append-only — never overwrites or deletes
 *   ✓ Each session creates an ingestion_runs audit record
 *   ✓ Concurrent sessions respect a configurable concurrency cap
 */

import { runIngestionPipeline } from "./ingestion";

// ── 105-industry taxonomy ─────────────────────────────────────────────────────

export const INDUSTRY_TAXONOMY: string[] = [
  // Electronics & Components (8)
  "Electronics Manufacturing",
  "PCB & Circuit Board Manufacturing",
  "Semiconductor & Electronic Components",
  "LED & Lighting Manufacturing",
  "Display & Screen Technology",
  "Power Electronics & Converters",
  "Sensors & IoT Devices",
  "Battery & Energy Storage",
  // Automotive (5)
  "Automotive Parts",
  "Electric Vehicle Components",
  "Automotive Body Stamping",
  "Automotive Interiors & Seating",
  "Automotive Lighting Systems",
  // Industrial Machinery (8)
  "Industrial Machinery",
  "Hydraulics & Pneumatics",
  "Pumps & Flow Control",
  "Bearings & Power Transmission",
  "CNC Machining & Precision Manufacturing",
  "Compressors & Vacuum Equipment",
  "Industrial Filtration Systems",
  "Agricultural Machinery & Equipment",
  // Chemicals (8)
  "Chemical Manufacturing",
  "Paints, Coatings & Finishes",
  "Adhesives & Sealants",
  "Agrochemicals & Fertilizers",
  "Cleaning Products & Detergents",
  "Lubricants & Greases",
  "Specialty Chemicals",
  "Petroleum & Petrochemicals",
  // Metal Processing (6)
  "Metal Fabrication",
  "Die Casting & Foundry",
  "Forgings & Metal Stampings",
  "Fasteners & Hardware",
  "Surface Finishing & Plating",
  "Springs & Wire Forms",
  // Medical & Life Sciences (7)
  "Medical Devices",
  "Surgical Instruments",
  "Diagnostic Equipment & IVD",
  "Dental Equipment & Supplies",
  "Ophthalmic Equipment",
  "Rehabilitation Equipment",
  "Medical Consumables & Disposables",
  // Pharma & Biotech (3)
  "Pharmaceutical Manufacturing",
  "Biotechnology & Bioprocessing",
  "Veterinary Pharmaceuticals",
  // Food & Agriculture (4)
  "Food & Beverage Processing",
  "Food Processing Equipment",
  "Dairy & Beverage Equipment",
  "Bakery & Confectionery Equipment",
  // Textiles (6)
  "Textiles & Apparel",
  "Technical Textiles & Nonwovens",
  "Performance Sportswear Manufacturing",
  "Workwear & Protective Clothing",
  "Leather & Leather Goods",
  "Footwear Manufacturing",
  // Advanced Materials (7)
  "Plastics & Rubber",
  "Composites & Advanced Materials",
  "Glass Manufacturing",
  "Ceramics & Refractories",
  "Foam & Insulation Materials",
  "Paper & Pulp Products",
  "Carbon & Graphite Products",
  // Energy (5)
  "Renewable Energy & Clean Technology",
  "Solar Panel Manufacturing",
  "Wind Turbine Components",
  "Hydrogen & Fuel Cell Technology",
  "Nuclear Components & Equipment",
  // Construction (5)
  "Construction & Building Materials",
  "Precast Concrete Products",
  "Structural Steel Fabrication",
  "Door & Window Systems",
  "Roofing & Waterproofing Systems",
  // Aerospace & Defense (4)
  "Aerospace & Defense",
  "Military Electronics & Systems",
  "Unmanned Systems & Drone Components",
  "Space Technology Components",
  // Oil, Gas & Energy (3)
  "Oil & Gas Equipment",
  "Subsea Equipment & Systems",
  "Pipeline Equipment & Services",
  // Marine (3)
  "Marine Equipment & Components",
  "Shipbuilding & Naval Systems",
  "Offshore Equipment",
  // Mining (3)
  "Mining Equipment",
  "Mineral Processing Equipment",
  "Drilling Equipment & Tools",
  // Safety & Environment (3)
  "Safety Equipment & PPE",
  "Fire Protection Systems",
  "Environmental Monitoring Equipment",
  // Lab & Scientific (3)
  "Test & Measurement Equipment",
  "Laboratory Equipment & Instruments",
  "Scientific Instruments & Optics",
  // Packaging (3)
  "Packaging",
  "Flexible Packaging Materials",
  "Rigid Containers & Bottles",
  // Furniture & Wood (3)
  "Furniture & Woodworking",
  "Office Furniture Systems",
  "Wood Panels & Engineered Wood",
  // Other Industrial (7)
  "Railway & Rail Systems",
  "Printing & Publishing Equipment",
  "Textile Machinery",
  "Semiconductor Manufacturing Equipment",
  "HVAC Equipment & Systems",
  "Telecommunications Equipment",
  "Data Center Infrastructure",
];

// ── Campaign configurations: one per industry + region pair ──────────────────

export interface CampaignConfig {
  industry: string;
  queries: string[];
  regions: string[];
  priority: 1 | 2 | 3;   // 1 = high, runs first
}

export const CAMPAIGN_CONFIGS: CampaignConfig[] = [
  // ── Priority 1: High-volume industries ─────────────────────────────────────
  { industry: "PCB & Circuit Board Manufacturing",      queries: ["PCB manufacturer", "printed circuit board fabrication"],               regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Battery & Energy Storage",               queries: ["battery manufacturer", "lithium battery pack manufacturer"],           regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Electric Vehicle Components",            queries: ["EV parts manufacturer", "electric vehicle component supplier"],        regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "LED & Lighting Manufacturing",           queries: ["LED manufacturer", "industrial lighting manufacturer"],               regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Hydraulics & Pneumatics",                queries: ["hydraulic components manufacturer", "pneumatic systems supplier"],    regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "Pumps & Flow Control",                   queries: ["industrial pump manufacturer", "flow control valve supplier"],        regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "Bearings & Power Transmission",          queries: ["bearing manufacturer", "power transmission components supplier"],    regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "CNC Machining & Precision Manufacturing",queries: ["CNC machining services", "precision machined parts manufacturer"],   regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Agricultural Machinery & Equipment",     queries: ["agricultural machinery manufacturer", "farm equipment supplier"],    regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "Paints, Coatings & Finishes",            queries: ["industrial paint manufacturer", "protective coatings supplier"],     regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "Adhesives & Sealants",                   queries: ["industrial adhesive manufacturer", "sealant supplier"],              regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "Die Casting & Foundry",                  queries: ["die casting manufacturer", "aluminum foundry supplier"],            regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Forgings & Metal Stampings",             queries: ["metal forging manufacturer", "precision stamping supplier"],        regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Fasteners & Hardware",                   queries: ["fastener manufacturer", "industrial bolt screw supplier"],          regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Composites & Advanced Materials",        queries: ["composite manufacturer", "carbon fiber composite supplier"],        regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "Glass Manufacturing",                    queries: ["industrial glass manufacturer", "architectural glass supplier"],    regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "Paper & Pulp Products",                  queries: ["paper manufacturer", "pulp paper board supplier"],                  regions: ["Europe", "North America", "Latin America"],  priority: 1 },
  { industry: "Solar Panel Manufacturing",              queries: ["solar panel manufacturer", "photovoltaic module supplier"],        regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Wind Turbine Components",                queries: ["wind turbine component manufacturer", "wind energy parts"],        regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "Oil & Gas Equipment",                    queries: ["oilfield equipment manufacturer", "oil gas equipment supplier"],   regions: ["North America", "Europe", "Middle East & Africa"], priority: 1 },
  { industry: "Marine Equipment & Components",          queries: ["marine equipment manufacturer", "maritime component supplier"],    regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },
  { industry: "Mining Equipment",                       queries: ["mining equipment manufacturer", "mineral processing supplier"],    regions: ["North America", "Europe", "Latin America"],  priority: 1 },
  { industry: "Safety Equipment & PPE",                 queries: ["PPE manufacturer", "personal protective equipment supplier"],     regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "Test & Measurement Equipment",           queries: ["test equipment manufacturer", "industrial measurement supplier"], regions: ["Europe", "North America", "Asia-Pacific"],   priority: 1 },
  { industry: "HVAC Equipment & Systems",               queries: ["HVAC manufacturer", "air conditioning chiller manufacturer"],     regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Structural Steel Fabrication",           queries: ["structural steel fabricator", "steel structure manufacturer"],    regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Technical Textiles & Nonwovens",         queries: ["technical textile manufacturer", "nonwoven fabric supplier"],    regions: ["Asia-Pacific", "Europe", "North America"],   priority: 1 },
  { industry: "Sensors & IoT Devices",                  queries: ["industrial sensor manufacturer", "IoT device manufacturer"],     regions: ["Europe", "Asia-Pacific", "North America"],   priority: 1 },

  // ── Priority 2: Medium-volume industries ───────────────────────────────────
  { industry: "Power Electronics & Converters",         queries: ["power electronics manufacturer", "inverter converter supplier"],  regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Display & Screen Technology",            queries: ["display manufacturer", "LCD OLED screen supplier"],              regions: ["Asia-Pacific", "Europe"],                    priority: 2 },
  { industry: "Automotive Body Stamping",               queries: ["automotive body stamping", "car body metal parts supplier"],    regions: ["Europe", "Asia-Pacific", "North America"],   priority: 2 },
  { industry: "Automotive Interiors & Seating",         queries: ["automotive interior manufacturer", "car seat cushion supplier"], regions: ["Europe", "Asia-Pacific", "North America"],  priority: 2 },
  { industry: "Compressors & Vacuum Equipment",         queries: ["air compressor manufacturer", "vacuum pump supplier"],          regions: ["Europe", "Asia-Pacific", "North America"],   priority: 2 },
  { industry: "Industrial Filtration Systems",          queries: ["industrial filter manufacturer", "filtration system supplier"], regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Agrochemicals & Fertilizers",            queries: ["agrochemical manufacturer", "fertilizer producer"],            regions: ["Asia-Pacific", "Europe", "Latin America"],   priority: 2 },
  { industry: "Lubricants & Greases",                   queries: ["industrial lubricant manufacturer", "grease supplier"],        regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Surface Finishing & Plating",            queries: ["metal plating services", "surface treatment supplier"],       regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Surgical Instruments",                   queries: ["surgical instrument manufacturer", "surgical tools supplier"], regions: ["Europe", "Asia-Pacific", "North America"],   priority: 2 },
  { industry: "Diagnostic Equipment & IVD",             queries: ["diagnostic equipment manufacturer", "IVD kit supplier"],      regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Dental Equipment & Supplies",            queries: ["dental equipment manufacturer", "dental supply distributor"], regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Medical Consumables & Disposables",      queries: ["medical disposables manufacturer", "hospital supplies"],     regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Biotechnology & Bioprocessing",          queries: ["bioprocess equipment manufacturer", "bioreactor supplier"],  regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Food Processing Equipment",              queries: ["food processing machinery manufacturer", "food equipment"],   regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Workwear & Protective Clothing",         queries: ["workwear manufacturer", "safety clothing supplier"],         regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Ceramics & Refractories",                queries: ["ceramics manufacturer", "refractory products supplier"],    regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Precast Concrete Products",              queries: ["precast concrete manufacturer", "concrete panel supplier"],  regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Door & Window Systems",                  queries: ["door window manufacturer", "fenestration supplier"],        regions: ["Europe", "North America", "Asia-Pacific"],   priority: 2 },
  { industry: "Railway & Rail Systems",                 queries: ["railway equipment manufacturer", "rail components supplier"], regions: ["Europe", "Asia-Pacific", "North America"],  priority: 2 },
  { industry: "Telecommunications Equipment",           queries: ["telecom equipment manufacturer", "network hardware supplier"], regions: ["Asia-Pacific", "Europe", "North America"],  priority: 2 },
  { industry: "Laboratory Equipment & Instruments",     queries: ["laboratory equipment manufacturer", "lab instrument supplier"], regions: ["Europe", "North America", "Asia-Pacific"], priority: 2 },
  { industry: "Flexible Packaging Materials",           queries: ["flexible packaging manufacturer", "film pouch supplier"],  regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Rigid Containers & Bottles",             queries: ["plastic bottle manufacturer", "rigid container supplier"], regions: ["Asia-Pacific", "Europe", "North America"],   priority: 2 },
  { industry: "Hydrogen & Fuel Cell Technology",        queries: ["fuel cell manufacturer", "hydrogen equipment supplier"],  regions: ["Europe", "Asia-Pacific", "North America"],   priority: 2 },

  // ── Priority 3: Niche / specialist industries ──────────────────────────────
  { industry: "Military Electronics & Systems",         queries: ["defense electronics manufacturer", "military system supplier"], regions: ["North America", "Europe"],                   priority: 3 },
  { industry: "Unmanned Systems & Drone Components",    queries: ["drone component manufacturer", "UAV parts supplier"],           regions: ["Asia-Pacific", "North America", "Europe"],   priority: 3 },
  { industry: "Space Technology Components",            queries: ["space component manufacturer", "satellite parts supplier"],    regions: ["North America", "Europe"],                   priority: 3 },
  { industry: "Subsea Equipment & Systems",             queries: ["subsea equipment manufacturer", "offshore subsea supplier"],  regions: ["Europe", "North America"],                   priority: 3 },
  { industry: "Shipbuilding & Naval Systems",           queries: ["shipbuilding company", "naval vessel manufacturer"],          regions: ["Asia-Pacific", "Europe"],                    priority: 3 },
  { industry: "Drilling Equipment & Tools",             queries: ["drilling equipment manufacturer", "downhole tools supplier"], regions: ["North America", "Europe"],                   priority: 3 },
  { industry: "Fire Protection Systems",                queries: ["fire suppression manufacturer", "fire safety supplier"],     regions: ["Europe", "North America", "Asia-Pacific"],   priority: 3 },
  { industry: "Environmental Monitoring Equipment",     queries: ["environmental monitoring manufacturer", "emission sensor"],  regions: ["Europe", "North America", "Asia-Pacific"],   priority: 3 },
  { industry: "Scientific Instruments & Optics",        queries: ["optical instrument manufacturer", "scientific optics"],     regions: ["Europe", "Asia-Pacific", "North America"],   priority: 3 },
  { industry: "Carbon & Graphite Products",             queries: ["carbon graphite manufacturer", "graphite electrode supplier"], regions: ["Asia-Pacific", "Europe"],                  priority: 3 },
  { industry: "Foam & Insulation Materials",            queries: ["foam manufacturer", "thermal insulation supplier"],          regions: ["Europe", "North America", "Asia-Pacific"],   priority: 3 },
  { industry: "Nuclear Components & Equipment",         queries: ["nuclear component manufacturer", "nuclear equipment supplier"], regions: ["North America", "Europe"],                  priority: 3 },
  { industry: "Semiconductor Manufacturing Equipment",  queries: ["semiconductor equipment manufacturer", "chip fab equipment"], regions: ["Asia-Pacific", "North America", "Europe"],   priority: 3 },
  { industry: "Printing & Publishing Equipment",        queries: ["printing machinery manufacturer", "press equipment supplier"], regions: ["Europe", "Asia-Pacific", "North America"],  priority: 3 },
  { industry: "Textile Machinery",                      queries: ["textile machinery manufacturer", "weaving loom supplier"],   regions: ["Asia-Pacific", "Europe", "North America"],   priority: 3 },
  { industry: "Veterinary Pharmaceuticals",             queries: ["veterinary pharmaceutical manufacturer", "animal drug supplier"], regions: ["Europe", "North America", "Asia-Pacific"], priority: 3 },
  { industry: "Leather & Leather Goods",                queries: ["leather manufacturer", "leather goods supplier"],            regions: ["Asia-Pacific", "Europe", "Latin America"],   priority: 3 },
  { industry: "Footwear Manufacturing",                 queries: ["footwear manufacturer", "shoe factory supplier"],            regions: ["Asia-Pacific", "Europe", "Latin America"],   priority: 3 },
  { industry: "Office Furniture Systems",               queries: ["office furniture manufacturer", "commercial furniture supplier"], regions: ["Europe", "North America", "Asia-Pacific"], priority: 3 },
  { industry: "Wood Panels & Engineered Wood",          queries: ["engineered wood manufacturer", "plywood MDF supplier"],     regions: ["Europe", "Asia-Pacific", "North America"],   priority: 3 },
  { industry: "Data Center Infrastructure",             queries: ["data center rack manufacturer", "server cabinet supplier"], regions: ["Asia-Pacific", "Europe", "North America"],   priority: 3 },
  { industry: "Pipeline Equipment & Services",          queries: ["pipeline equipment manufacturer", "pipe fitting supplier"],  regions: ["North America", "Europe", "Middle East & Africa"], priority: 3 },
  { industry: "Dairy & Beverage Equipment",             queries: ["dairy processing equipment manufacturer", "beverage filling"],regions: ["Europe", "North America", "Asia-Pacific"],  priority: 3 },
  { industry: "Bakery & Confectionery Equipment",       queries: ["bakery equipment manufacturer", "confectionery machinery"],  regions: ["Europe", "North America", "Asia-Pacific"],  priority: 3 },
  { industry: "Roofing & Waterproofing Systems",        queries: ["roofing manufacturer", "waterproofing membrane supplier"],  regions: ["Europe", "North America", "Asia-Pacific"],  priority: 3 },
  { industry: "Performance Sportswear Manufacturing",   queries: ["sportswear manufacturer", "activewear supplier"],           regions: ["Asia-Pacific", "Europe", "North America"],  priority: 3 },
  { industry: "Springs & Wire Forms",                   queries: ["spring manufacturer", "wire form component supplier"],      regions: ["Asia-Pacific", "Europe", "North America"],  priority: 3 },
];

// ── In-memory campaign status tracker ─────────────────────────────────────────

export interface CampaignSession {
  sessionId: string;
  industry: string;
  region: string;
  query: string;
  status: "queued" | "running" | "done" | "failed";
  added: number;
  duplicate: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface BatchCampaignState {
  id: string;
  startedAt: Date;
  sessions: CampaignSession[];
  totalAdded: number;
  totalDuplicate: number;
  completedSessions: number;
  failedSessions: number;
  status: "running" | "done" | "idle";
}

// Global state — one campaign at a time
let activeCampaign: BatchCampaignState | null = null;

export function getActiveCampaign(): BatchCampaignState | null {
  return activeCampaign;
}

// ── Batch campaign runner ─────────────────────────────────────────────────────

export interface BatchCampaignOptions {
  priorityLevel?: 1 | 2 | 3;      // run campaigns up to this priority (1=only high, 3=all)
  industriesFilter?: string[];      // restrict to specific industries
  regionsFilter?: string[];         // restrict to specific regions
  concurrency?: number;             // max parallel TinyFish sessions (default: 3)
  maxPerSession?: number;           // max records extracted per TinyFish call
}

export async function startBatchCampaign(
  opts: BatchCampaignOptions = {}
): Promise<BatchCampaignState> {
  const {
    priorityLevel = 2,
    industriesFilter,
    regionsFilter,
    concurrency = 3,
    maxPerSession = 30,
  } = opts;

  // Build the work queue
  const sessions: CampaignSession[] = [];

  const filteredCampaigns = CAMPAIGN_CONFIGS.filter(c =>
    c.priority <= priorityLevel &&
    (!industriesFilter || industriesFilter.includes(c.industry))
  );

  for (const campaign of filteredCampaigns) {
    const regionsToUse = regionsFilter
      ? campaign.regions.filter(r => regionsFilter.includes(r))
      : campaign.regions.slice(0, 2); // max 2 regions per industry by default

    for (const region of regionsToUse) {
      sessions.push({
        sessionId: `${campaign.industry}-${region}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "_"),
        industry: campaign.industry,
        region,
        query: campaign.queries[0],
        status: "queued",
        added: 0,
        duplicate: 0,
      });
    }
  }

  const campaignId = `campaign-${Date.now()}`;
  activeCampaign = {
    id: campaignId,
    startedAt: new Date(),
    sessions,
    totalAdded: 0,
    totalDuplicate: 0,
    completedSessions: 0,
    failedSessions: 0,
    status: "running",
  };

  // Run async in background — do NOT await
  runCampaignBackground(activeCampaign, concurrency, maxPerSession).catch(console.error);

  return activeCampaign;
}

async function runCampaignBackground(
  campaign: BatchCampaignState,
  concurrency: number,
  maxPerSession: number
): Promise<void> {
  const queue = [...campaign.sessions];
  let active = 0;

  async function runOne(session: CampaignSession): Promise<void> {
    session.status = "running";
    session.startedAt = new Date();
    active++;

    try {
      const result = await runIngestionPipeline({
        industry: session.industry,
        region: session.region,
        query: session.query,
        maxRecords: maxPerSession,
        timeoutMs: 480_000,
      });

      session.status = result.error ? "failed" : "done";
      session.added = result.added;
      session.duplicate = result.duplicate;
      if (result.error) session.error = result.error;

      campaign.totalAdded += result.added;
      campaign.totalDuplicate += result.duplicate;
      if (result.error) campaign.failedSessions++;
      else campaign.completedSessions++;
    } catch (err) {
      session.status = "failed";
      session.error = err instanceof Error ? err.message : String(err);
      campaign.failedSessions++;
    } finally {
      session.completedAt = new Date();
      active--;
    }
  }

  // Semaphore-based concurrency
  const runWithConcurrency = async () => {
    const running: Promise<void>[] = [];

    for (const session of queue) {
      // Wait until a slot is available
      while (active >= concurrency) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      running.push(runOne(session));
    }

    await Promise.all(running);
  };

  await runWithConcurrency();
  campaign.status = "done";
  console.log(
    `[campaigns] Batch complete — added ${campaign.totalAdded} companies, ` +
    `${campaign.failedSessions} sessions failed`
  );
}
