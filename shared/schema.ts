import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  spec: text("spec").notNull(),
  certifications: text("certifications").notNull().default(""),
  maxMoq: integer("max_moq"),
  preferredLocation: text("preferred_location").notNull().default(""),
  quantity: integer("quantity"),
  status: text("status").notNull().default("pending"), // pending, processing, completed
  createdAt: timestamp("created_at").defaultNow(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id).notNull(),
  message: text("message").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id).notNull(),
  name: text("name").notNull(),
  location: text("location"),
  certifications: text("certifications"),
  capabilities: text("capabilities"),
  moq: integer("moq"),
  score: integer("score"),
  rfqSent: boolean("rfq_sent").default(false),
  url: text("url"),
  confidenceScore: integer("confidence_score"),
});

// Base Types
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

export type Log = typeof logs.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

// Schemas
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, status: true, createdAt: true });
export const insertLogSchema = createInsertSchema(logs).omit({ id: true, timestamp: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });

// Request/Response Types
export type CreateJobRequest = InsertJob;
export type JobResponse = Job;
export type LogResponse = Log;
export type SupplierResponse = Supplier;
