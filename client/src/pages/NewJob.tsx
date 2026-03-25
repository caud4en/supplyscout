import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Loader2, Rocket } from "lucide-react";

import { useCreateJob } from "@/hooks/use-jobs";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const formSchema = z.object({
  spec: z.string().min(10, "Please provide a detailed specification (min 10 chars)"),
  certifications: z.string().optional().default(""),
  maxMoq: z.coerce.number().min(1, "Must be positive").optional().or(z.literal("").transform(() => undefined)),
  preferredLocation: z.string().optional().default(""),
  quantity: z.coerce.number().min(1, "Must be positive").optional().or(z.literal("").transform(() => undefined)),
});

export default function NewJob() {
  const [, setLocation] = useLocation();
  const createJob = useCreateJob();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      spec: "",
      certifications: "",
      maxMoq: "" as any,
      preferredLocation: "",
      quantity: "" as any,
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    createJob.mutate(data, {
      onSuccess: (job) => {
        setLocation(`/jobs/${job.id}`);
      }
    });
  }

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 w-full">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mb-8 text-center sm:text-left">
          <h1 className="text-3xl font-display font-extrabold text-slate-900 tracking-tight">Configure Sourcing Agent</h1>
          <p className="text-slate-500 mt-2 text-lg">Define your requirements and let the AI find the best suppliers.</p>
        </div>

        <Card className="shadow-xl shadow-slate-200/40 border-slate-200 overflow-hidden">
          <CardContent className="p-6 sm:p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FormField
                  control={form.control}
                  name="spec"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-semibold text-slate-800">Product Specification <span className="text-red-500">*</span></FormLabel>
                      <FormDescription className="text-slate-500 mb-3">
                        Describe the product, materials, dimensions, and use case in detail. The more context the AI has, the better the matches.
                      </FormDescription>
                      <FormControl>
                        <Textarea 
                          placeholder="e.g., I need a custom injection-molded ABS plastic enclosure for a smart home device. Dimensions are roughly 150mm x 100mm x 40mm. Surface finish should be matte black..." 
                          className="min-h-[140px] text-base resize-y bg-slate-50/50 focus-visible:bg-white transition-colors" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4 border-t border-slate-100">
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-slate-800">Target Order Quantity</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="e.g. 5000" 
                            className="bg-slate-50/50 focus-visible:bg-white"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxMoq"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-slate-800">Maximum MOQ Limit</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="e.g. 1000" 
                            className="bg-slate-50/50 focus-visible:bg-white"
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription className="text-xs">Filter out suppliers wanting larger commitments.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="certifications"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-slate-800">Required Certifications</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g. ISO 9001, CE, FDA, RoHS" 
                            className="bg-slate-50/50 focus-visible:bg-white"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="preferredLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-slate-800">Preferred Location</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g. North America, Vietnam, EU" 
                            className="bg-slate-50/50 focus-visible:bg-white"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-6 border-t border-slate-100 flex justify-end">
                  <Button 
                    type="submit" 
                    size="lg" 
                    className="w-full sm:w-auto h-12 px-8 text-base shadow-md hover:shadow-lg transition-all" 
                    disabled={createJob.isPending}
                  >
                    {createJob.isPending ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Initializing Agent...
                      </>
                    ) : (
                      <>
                        <Rocket className="w-5 h-5 mr-2" />
                        Deploy Sourcing Agent
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
