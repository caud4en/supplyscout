import { useRoute } from "wouter";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Download, AlertCircle, Loader2, ArrowLeft, Building2 } from "lucide-react";

import { useJob, useJobLogs, useJobSuppliers } from "@/hooks/use-jobs";
import { Terminal } from "@/components/Terminal";
import { SuppliersTable } from "@/components/SuppliersTable";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function JobDashboard() {
  const [match, params] = useRoute("/jobs/:id");
  const id = match && params?.id ? parseInt(params.id, 10) : 0;
  
  const { data: job, isLoading: jobLoading, error: jobError } = useJob(id);
  
  const isProcessing = job?.status === "processing" || job?.status === "pending";
  const isCompleted = job?.status === "completed";
  
  const { data: logs = [] } = useJobLogs(id, isProcessing);
  const { data: suppliers = [] } = useJobSuppliers(id, isCompleted);

  const downloadCsv = () => {
    const headers = ["Name", "Location", "Certifications", "Capabilities", "MOQ", "Score", "RFQ Sent", "URL"];
    const rows = suppliers.map(s => [
      `"${s.name.replace(/"/g, '""')}"`,
      `"${(s.location || "").replace(/"/g, '""')}"`,
      `"${(s.certifications || "").replace(/"/g, '""')}"`,
      `"${(s.capabilities || "").replace(/"/g, '""')}"`,
      s.moq || "",
      s.score || "",
      s.rfqSent ? "Yes" : "No",
      `"${(s.url || "").replace(/"/g, '""')}"`
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `supplyscout-job-${id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (jobLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="w-10 h-10 animate-spin text-primary mb-6" />
        <h2 className="text-xl font-display font-semibold text-slate-700 animate-pulse">Loading Job Details...</h2>
      </div>
    );
  }

  if (jobError || !job) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="bg-red-100 p-4 rounded-full mb-6">
          <AlertCircle className="w-12 h-12 text-destructive" />
        </div>
        <h2 className="text-2xl font-display font-bold text-slate-900 mb-3">Job Not Found</h2>
        <p className="text-slate-500 mb-8 text-lg">The sourcing job you're looking for doesn't exist or has been removed.</p>
        <Button asChild size="lg">
          <Link href="/new">Create New Job</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 w-full flex flex-col gap-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-medium text-slate-500 hover:text-primary mb-2 flex items-center transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Home
          </Link>
          <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
            Sourcing Job <span className="text-slate-400 font-mono text-2xl font-normal">#{job.id}</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 font-medium">
            Initiated on {new Date(job.createdAt!).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {isCompleted && (
             <Button onClick={downloadCsv} variant="outline" className="shadow-sm bg-white hover:bg-slate-50 border-slate-200">
               <Download className="w-4 h-4 mr-2"/> Export CSV
             </Button>
          )}
          <Badge 
            className={`px-3 py-1.5 text-sm uppercase tracking-wider font-bold ${
              isCompleted ? "bg-green-500 hover:bg-green-600 text-white" : 
              "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
            }`}
          >
            {job.status}
          </Badge>
        </div>
      </motion.div>
      
      <AnimatePresence mode="wait">
        {isProcessing && (
          <motion.div 
            key="processing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-2 flex flex-col shadow-xl shadow-slate-200/50 rounded-xl">
              <Terminal logs={logs} isProcessing={isProcessing} />
            </div>
            <div className="lg:col-span-1">
              <JobDetailsCard job={job} />
            </div>
          </motion.div>
        )}

        {isCompleted && (
          <motion.div 
            key="completed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg text-primary">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-display font-bold text-slate-900">Recommended Suppliers</h2>
                  <p className="text-slate-500 text-sm">Our agent identified and vetted {suppliers.length} suitable partners.</p>
                </div>
              </div>
            </div>
            
            <SuppliersTable suppliers={suppliers} />
            
            <div className="mt-8 pt-8 border-t border-slate-200">
              <h3 className="text-lg font-display font-bold text-slate-900 mb-4">Original Request Configuration</h3>
              <JobDetailsCard job={job} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function JobDetailsCard({ job, compact = false }: { job: any, compact?: boolean }) {
  return (
    <Card className="border-slate-200/80 shadow-sm bg-white/50 backdrop-blur-sm h-full">
      {!compact && (
        <CardHeader className="pb-4 border-b border-slate-100/80">
          <CardTitle className="text-lg font-display text-slate-800">Job Configuration</CardTitle>
        </CardHeader>
      )}
      <CardContent className={`space-y-5 ${compact ? 'pt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 space-y-0' : 'pt-5'}`}>
        <div className={compact ? 'md:col-span-2 lg:col-span-4' : ''}>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Specification</h4>
          <div className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-slate-200/60 whitespace-pre-wrap leading-relaxed shadow-sm">
            {job.spec}
          </div>
        </div>
        
        <div className={compact ? 'contents' : 'grid grid-cols-2 gap-5'}>
          <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Target Quantity</h4>
            <p className="text-base font-semibold text-slate-900">{job.quantity ? job.quantity.toLocaleString() : "Not specified"}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Max MOQ</h4>
            <p className="text-base font-semibold text-slate-900">{job.maxMoq ? job.maxMoq.toLocaleString() : "No limit"}</p>
          </div>
          <div className={compact ? "bg-white p-3 rounded-lg border border-slate-100 shadow-sm" : "col-span-2 bg-white p-3 rounded-lg border border-slate-100 shadow-sm"}>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Certifications</h4>
            <p className="text-base font-semibold text-slate-900">{job.certifications || "None required"}</p>
          </div>
          <div className={compact ? "bg-white p-3 rounded-lg border border-slate-100 shadow-sm" : "col-span-2 bg-white p-3 rounded-lg border border-slate-100 shadow-sm"}>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Preferred Location</h4>
            <p className="text-base font-semibold text-slate-900">{job.preferredLocation || "Global"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
