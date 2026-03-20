import { db } from "./db";
import { jobs, logs, suppliers, manufacturers, type InsertJob, type InsertLog, type InsertSupplier, type Manufacturer } from "@shared/schema";
import { eq, ilike, and, or, sql } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
