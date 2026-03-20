import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  spec: text("spec").notNull(),
  certifications: text("certifications").notNull().default(""),
  maxMoq: integer("max_moq"),
  preferredLocation: text("preferred_location").notNull().default(""),
  quantity: integer("quantity"),
  status: text("status").notNull().default("pending"),
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

// Global Manufacturer Database — independent of sourcing jobs
export const manufacturers = pgTable("manufacturers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  city: text("city"),
  region: text("region"),           // geographic region: Asia-Pacific, Europe, North America, etc.
  industry: text("industry").notNull(),
  subIndustry: text("sub_industry"),
  certifications: text("certifications"),
  capabilities: text("capabilities"),
  employeeCount: text("employee_count"),
  annualRevenue: text("annual_revenue"),
  moqMin: integer("moq_min"),
  moqMax: integer("moq_max"),
  leadTimeDays: integer("lead_time_days"),
  url: text("url"),
  email: text("email"),
  phone: text("phone"),
  verified: boolean("verified").default(false),
  dataSource: text("data_source"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  countryIdx: index("manufacturers_country_idx").on(table.country),
  industryIdx: index("manufacturers_industry_idx").on(table.industry),
  regionIdx: index("manufacturers_region_idx").on(table.region),
}));

// Types
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

export type Log = typeof logs.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

export type Manufacturer = typeof manufacturers.$inferSelect;
export type InsertManufacturer = z.infer<typeof insertManufacturerSchema>;

// Schemas
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, status: true, createdAt: true });
export const insertLogSchema = createInsertSchema(logs).omit({ id: true, timestamp: true });
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export const insertManufacturerSchema = createInsertSchema(manufacturers).omit({ id: true, createdAt: true });

// Request/Response Types
export type CreateJobRequest = InsertJob;
export type JobResponse = Job;
export type LogResponse = Log;
export type SupplierResponse = Supplier;
export type ManufacturerResponse = Manufacturer;
