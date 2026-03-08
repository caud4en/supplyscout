import { db } from "./db";
import { jobs, logs, suppliers, type InsertJob, type InsertLog, type InsertSupplier } from "@shared/schema";
import { eq } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
