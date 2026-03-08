import { z } from 'zod';
import { insertJobSchema, jobs, logs, suppliers } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  jobs: {
    create: {
      method: 'POST' as const,
      path: '/api/jobs' as const,
      input: insertJobSchema,
      responses: {
        201: z.custom<typeof jobs.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/jobs/:id' as const,
      responses: {
        200: z.custom<typeof jobs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/jobs' as const,
      responses: {
        200: z.array(z.custom<typeof jobs.$inferSelect>()),
      },
    },
  },
  logs: {
    list: {
      method: 'GET' as const,
      path: '/api/jobs/:id/logs' as const,
      responses: {
        200: z.array(z.custom<typeof logs.$inferSelect>()),
      },
    },
  },
  suppliers: {
    list: {
      method: 'GET' as const,
      path: '/api/jobs/:id/suppliers' as const,
      responses: {
        200: z.array(z.custom<typeof suppliers.$inferSelect>()),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type JobInput = z.infer<typeof api.jobs.create.input>;
export type JobResponse = z.infer<typeof api.jobs.create.responses[201]>;
export type LogResponse = z.infer<typeof api.logs.list.responses[200]>[0];
export type SupplierResponse = z.infer<typeof api.suppliers.list.responses[200]>[0];
