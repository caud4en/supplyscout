import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, ExternalLink, MapPin } from "lucide-react";
import type { SupplierResponse } from "@shared/routes";

export function SuppliersTable({ suppliers }: { suppliers: SupplierResponse[] }) {
  if (suppliers.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200 shadow-sm">
        No suppliers found for this job.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow>
            <TableHead className="font-semibold">Supplier Name</TableHead>
            <TableHead className="font-semibold">Location</TableHead>
            <TableHead className="font-semibold">Certifications</TableHead>
            <TableHead className="font-semibold text-right">MOQ</TableHead>
            <TableHead className="font-semibold">Match Score</TableHead>
            <TableHead className="font-semibold text-center">RFQ Sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.map((s) => (
            <TableRow key={s.id} className="hover:bg-slate-50/50 transition-colors">
              <TableCell className="font-medium text-slate-900">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:text-blue-700 hover:underline transition-colors">
                    {s.name} <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  s.name
                )}
              </TableCell>
              <TableCell>
                {s.location ? (
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {s.location}
                  </div>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {s.certifications ? s.certifications.split(',').map((c, i) => (
                    c.trim() && <Badge variant="secondary" key={i} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border-slate-200/60">{c.trim()}</Badge>
                  )) : <span className="text-slate-400 text-sm">None</span>}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-slate-700">
                {s.moq ? s.moq.toLocaleString() : <span className="text-slate-400">-</span>}
              </TableCell>
              <TableCell>
                {s.score ? (
                  <div className="flex items-center gap-3">
                    <Progress value={s.score} className="w-20 h-2 bg-slate-100" />
                    <span className="text-xs font-bold text-slate-700">{s.score}%</span>
                  </div>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                {s.rfqSent ? (
                  <div className="flex justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500 drop-shadow-sm" />
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <XCircle className="w-5 h-5 text-slate-300" />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
