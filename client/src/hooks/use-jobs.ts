import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type JobInput, type JobResponse, type LogResponse, type SupplierResponse } from "@shared/routes";
import { z } from "zod";

function parseWithLogging<T>(schema: z.ZodSchema<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

export function useJob(id: number) {
  return useQuery({
    queryKey: [api.jobs.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.jobs.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch job");
      const data = await res.json();
      return parseWithLogging(api.jobs.get.responses[200], data, "jobs.get");
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 2 seconds if job is not yet completed
      return (status === "pending" || status === "processing") ? 2000 : false;
    }
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: JobInput) => {
      const validated = api.jobs.create.input.parse(data);
      const res = await fetch(api.jobs.create.path, {
        method: api.jobs.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = await res.json();
          throw new Error(error.message || "Validation failed");
        }
        throw new Error("Failed to create job");
      }
      const json = await res.json();
      return parseWithLogging(api.jobs.create.responses[201], json, "jobs.create");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.jobs.list.path] }),
  });
}

export function useJobLogs(id: number, shouldPoll: boolean) {
  return useQuery({
    queryKey: [api.logs.list.path, id],
    queryFn: async () => {
      const url = buildUrl(api.logs.list.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      return parseWithLogging(api.logs.list.responses[200], data, "logs.list");
    },
    refetchInterval: shouldPoll ? 2000 : false,
  });
}

export function useJobSuppliers(id: number, isCompleted: boolean) {
  return useQuery({
    queryKey: [api.suppliers.list.path, id],
    queryFn: async () => {
      const url = buildUrl(api.suppliers.list.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      const data = await res.json();
      return parseWithLogging(api.suppliers.list.responses[200], data, "suppliers.list");
    },
    enabled: isCompleted,
  });
}
