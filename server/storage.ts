import { db } from "./db";
import { jobs, logs, suppliers, manufacturers, type InsertJob, type InsertLog, type InsertSupplier, type Manufacturer } from "@shared/schema";
import { eq, ilike, and, or, sql, desc, lte, gte } from "drizzle-orm";

export interface ManufacturerQuery {
  search?: string;
  country?: string;
  region?: string;
  industry?: string;
  certifications?: string;
  page?: number;
  pageSize?: number;
}

export interface IStorage {
  // Jobs
  createJob(job: InsertJob): Promise<typeof jobs.$inferSelect>;
  getJob(id: number): Promise<typeof jobs.$inferSelect | undefined>;
  getJobs(): Promise<(typeof jobs.$inferSelect)[]>;
  updateJobStatus(id: number, status: string): Promise<void>;

  // Logs
  addLog(log: InsertLog): Promise<typeof logs.$inferSelect>;
  getLogsByJobId(jobId: number): Promise<(typeof logs.$inferSelect)[]>;

  // Suppliers
  addSupplier(supplier: InsertSupplier): Promise<typeof suppliers.$inferSelect>;
  getSuppliersByJobId(jobId: number): Promise<(typeof suppliers.$inferSelect)[]>;

  // Global Manufacturer Database
  getManufacturers(query: ManufacturerQuery): Promise<{ data: Manufacturer[]; total: number }>;
  getManufacturerById(id: number): Promise<Manufacturer | undefined>;
  getManufacturerStats(): Promise<{ totalCount: number; countByRegion: Record<string, number>; countByIndustry: Record<string, number>; countryCount: number }>;

  // Database-powered job sourcing
  searchManufacturersForJob(spec: string, certifications: string, preferredLocation: string, maxMoq?: number | null, limit?: number): Promise<Manufacturer[]>;
}

export class DatabaseStorage implements IStorage {
  async createJob(job: InsertJob) {
    const [newJob] = await db.insert(jobs).values(job).returning();
    return newJob;
  }

  async getJob(id: number) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job;
  }

  async getJobs() {
    return await db.select().from(jobs);
  }

  async updateJobStatus(id: number, status: string) {
    await db.update(jobs).set({ status }).where(eq(jobs.id, id));
  }

  async addLog(log: InsertLog) {
    const [newLog] = await db.insert(logs).values(log).returning();
    return newLog;
  }

  async getLogsByJobId(jobId: number) {
    return await db.select().from(logs).where(eq(logs.jobId, jobId));
  }

  async addSupplier(supplier: InsertSupplier) {
    const [newSupplier] = await db.insert(suppliers).values(supplier).returning();
    return newSupplier;
  }

  async getSuppliersByJobId(jobId: number) {
    return await db.select().from(suppliers).where(eq(suppliers.jobId, jobId));
  }

  async getManufacturers({ search, country, region, industry, certifications, page = 1, pageSize = 50 }: ManufacturerQuery) {
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(manufacturers.name, `%${search}%`),
          ilike(manufacturers.capabilities, `%${search}%`),
          ilike(manufacturers.city, `%${search}%`),
        )
      );
    }
    if (country) conditions.push(ilike(manufacturers.country, `%${country}%`));
    if (region) conditions.push(eq(manufacturers.region, region));
    if (industry) conditions.push(eq(manufacturers.industry, industry));
    if (certifications) conditions.push(ilike(manufacturers.certifications, `%${certifications}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(manufacturers)
      .where(where);

    const data = await db
      .select()
      .from(manufacturers)
      .where(where)
      .orderBy(manufacturers.verified, manufacturers.name)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { data, total: count };
  }

  async getManufacturerById(id: number) {
    const [m] = await db.select().from(manufacturers).where(eq(manufacturers.id, id));
    return m;
  }

  async getManufacturerStats() {
    const [{ totalCount }] = await db
      .select({ totalCount: sql<number>`count(*)::int` })
      .from(manufacturers);

    const byRegion = await db
      .select({ region: manufacturers.region, count: sql<number>`count(*)::int` })
      .from(manufacturers)
      .groupBy(manufacturers.region);

    const byIndustry = await db
      .select({ industry: manufacturers.industry, count: sql<number>`count(*)::int` })
      .from(manufacturers)
      .groupBy(manufacturers.industry);

    const [{ countryCount }] = await db
      .select({ countryCount: sql<number>`count(distinct country)::int` })
      .from(manufacturers);

    const countByRegion: Record<string, number> = {};
    byRegion.forEach(r => { countByRegion[r.region] = r.count; });

    const countByIndustry: Record<string, number> = {};
    byIndustry.forEach(r => { countByIndustry[r.industry] = r.count; });

    return { totalCount, countByRegion, countByIndustry, countryCount };
  }

  async searchManufacturersForJob(
    spec: string,
    certifications: string,
    preferredLocation: string,
    maxMoq?: number | null,
    limit = 60
  ): Promise<Manufacturer[]> {
    const specTerms = spec.trim().replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 12).join(" ");
    const tsQuery = specTerms || "manufacturing";

    // Build the WHERE conditions
    const baseCondition = sql`search_vector @@ plainto_tsquery('english', ${tsQuery})`;
    const moqCondition = maxMoq
      ? and(baseCondition, or(sql`moq_min IS NULL`, lte(manufacturers.moqMin, maxMoq)))
      : baseCondition;

    // Primary: Full-text search via GIN index (fast, <10ms for 5000 rows)
    const results: Manufacturer[] = await db
      .select()
      .from(manufacturers)
      .where(moqCondition)
      .orderBy(sql`verified DESC, ts_rank(search_vector, plainto_tsquery('english', ${tsQuery})) DESC`)
      .limit(limit) as Manufacturer[];

    // Fallback: if FTS finds fewer than 20, supplement with ilike on capabilities
    if (results.length < 20) {
      const specWords = spec.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      const fallbackConditions = specWords.map(w =>
        or(ilike(manufacturers.capabilities, `%${w}%`), ilike(manufacturers.name, `%${w}%`), ilike(manufacturers.industry, `%${w}%`))
      );
      const fallbackWhere = fallbackConditions.length > 0 ? or(...fallbackConditions) : undefined;

      if (fallbackWhere) {
        const fallback = await db.select().from(manufacturers).where(fallbackWhere).orderBy(sql`verified DESC`).limit(limit);
        const seen = new Set(results.map(r => r.id));
        for (const r of fallback) {
          if (!seen.has(r.id)) { results.push(r as Manufacturer); seen.add(r.id); }
          if (results.length >= limit) break;
        }
      }
    }

    // Boost location-matched results to the front
    if (preferredLocation && results.length > 0) {
      const loc = preferredLocation.toLowerCase();
      results.sort((a, b) => {
        const aM = (a.country?.toLowerCase().includes(loc) || a.city?.toLowerCase().includes(loc) || a.region?.toLowerCase().includes(loc)) ? 1 : 0;
        const bM = (b.country?.toLowerCase().includes(loc) || b.city?.toLowerCase().includes(loc) || b.region?.toLowerCase().includes(loc)) ? 1 : 0;
        return bM - aM;
      });
    }

    return results.slice(0, limit);
  }
}

export const storage = new DatabaseStorage();
