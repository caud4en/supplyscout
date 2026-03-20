import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Search, Globe, Factory, Award, Building2, ChevronLeft, ChevronRight, ExternalLink, ArrowLeft, BarChart3, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Manufacturer } from "@shared/schema";

const REGIONS = ["Asia-Pacific", "Europe", "North America", "Latin America", "Middle East & Africa", "Oceania"];
const INDUSTRIES = [
  "Electronics Manufacturing", "Plastics & Rubber", "Automotive Parts",
  "Textiles & Apparel", "Metal Fabrication", "Industrial Machinery",
  "Chemical Manufacturing", "Medical Devices", "Food & Beverage Processing",
  "Packaging", "Aerospace & Defense", "Furniture & Woodworking",
];
const PAGE_SIZE = 50;

interface Stats {
  totalCount: number;
  countByRegion: Record<string, number>;
  countByIndustry: Record<string, number>;
  countryCount: number;
}

interface ManufacturersResult {
  data: Manufacturer[];
  total: number;
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") q.set(k, String(v));
  });
  return q.toString();
}

const REGION_COLORS: Record<string, string> = {
  "Asia-Pacific": "bg-blue-100 text-blue-800",
  "Europe": "bg-purple-100 text-purple-800",
  "North America": "bg-green-100 text-green-800",
  "Latin America": "bg-yellow-100 text-yellow-800",
  "Middle East & Africa": "bg-orange-100 text-orange-800",
  "Oceania": "bg-teal-100 text-teal-800",
};

export default function ManufacturerDatabase() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [region, setRegion] = useState("");
  const [industry, setIndustry] = useState("");
  const [certFilter, setCertFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showStats, setShowStats] = useState(false);

  const debounce = useCallback((value: string) => {
    setDebouncedSearch(value);
    setPage(1);
  }, []);

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((window as any).__searchTimer);
    (window as any).__searchTimer = setTimeout(() => debounce(v), 400);
  };

  const queryString = buildQueryString({
    search: debouncedSearch || undefined,
    region: region || undefined,
    industry: industry || undefined,
    certifications: certFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const { data, isLoading } = useQuery<ManufacturersResult>({
    queryKey: ["/api/manufacturers", queryString],
    queryFn: () => fetch(`/api/manufacturers?${queryString}`).then(r => r.json()),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/manufacturers/stats"],
    queryFn: () => fetch("/api/manufacturers/stats").then(r => r.json()),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const clearFilters = () => {
    setSearch(""); setDebouncedSearch(""); setRegion(""); setIndustry(""); setCertFilter(""); setPage(1);
  };
  const hasFilters = debouncedSearch || region || industry || certFilter;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm" className="text-slate-500 hover:text-slate-700">
                <Link href="/"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link>
              </Button>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-slate-800">Global Manufacturer Database</span>
              </div>
              {stats && (
                <Badge variant="secondary" className="text-xs" data-testid="total-count-badge">
                  {stats.totalCount.toLocaleString()} manufacturers
                </Badge>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowStats(!showStats)}
              data-testid="toggle-stats-button"
              className="gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              {showStats ? "Hide" : "Show"} Stats
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Stats Panel */}
        {showStats && stats && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center" data-testid="stat-total">
              <div className="text-3xl font-bold text-blue-600">{stats.totalCount.toLocaleString()}</div>
              <div className="text-sm text-slate-500 mt-1">Total Manufacturers</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center" data-testid="stat-countries">
              <div className="text-3xl font-bold text-purple-600">{stats.countryCount}</div>
              <div className="text-sm text-slate-500 mt-1">Countries</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center" data-testid="stat-industries">
              <div className="text-3xl font-bold text-green-600">{Object.keys(stats.countByIndustry).length}</div>
              <div className="text-sm text-slate-500 mt-1">Industries</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center" data-testid="stat-regions">
              <div className="text-3xl font-bold text-orange-600">{Object.keys(stats.countByRegion).length}</div>
              <div className="text-sm text-slate-500 mt-1">Global Regions</div>
            </div>

            {/* Region breakdown */}
            <div className="col-span-2 md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">By Region</div>
              <div className="space-y-2">
                {Object.entries(stats.countByRegion).sort((a, b) => b[1] - a[1]).map(([r, c]) => (
                  <div key={r} className="flex items-center gap-2">
                    <div className="text-xs text-slate-600 w-44 truncate">{r}</div>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-blue-500 transition-all"
                        style={{ width: `${(c / stats.totalCount) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 w-10 text-right">{c.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-2 md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">By Industry</div>
              <div className="space-y-2">
                {Object.entries(stats.countByIndustry).sort((a, b) => b[1] - a[1]).map(([ind, c]) => (
                  <div key={ind} className="flex items-center gap-2">
                    <div className="text-xs text-slate-600 w-44 truncate">{ind}</div>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-purple-500 transition-all"
                        style={{ width: `${(c / stats.totalCount) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 w-10 text-right">{c.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Search & Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                data-testid="input-search"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search name, capability, city..."
                className="pl-9"
              />
            </div>
            <Select value={region || "_all"} onValueChange={v => { setRegion(v === "_all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-48" data-testid="select-region">
                <SelectValue placeholder="All Regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Regions</SelectItem>
                {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={industry || "_all"} onValueChange={v => { setIndustry(v === "_all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-56" data-testid="select-industry">
                <SelectValue placeholder="All Industries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Industries</SelectItem>
                {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative w-44">
              <Award className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                data-testid="input-cert-filter"
                value={certFilter}
                onChange={e => { setCertFilter(e.target.value); setPage(1); }}
                placeholder="Certification..."
                className="pl-9"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-500 gap-1" data-testid="button-clear-filters">
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
          {data && (
            <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              {data.total.toLocaleString()} results
              {hasFilters && " matching your filters"}
            </div>
          )}
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
              Loading manufacturers...
            </div>
          ) : data && data.data.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
              No manufacturers match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Industry</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Certifications</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Size</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">MOQ</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((m, idx) => (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.01 }}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                      data-testid={`row-manufacturer-${m.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium text-slate-800">{m.name}</div>
                            {m.verified && (
                              <Badge className="text-xs bg-green-100 text-green-700 border-0 px-1 py-0 mt-0.5">
                                ✓ Verified
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{m.city ? `${m.city}, ` : ""}{m.country}</div>
                        {m.region && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${REGION_COLORS[m.region] || "bg-slate-100 text-slate-600"}`}>
                            {m.region}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700 max-w-36 truncate">{m.industry}</div>
                        {m.subIndustry && <div className="text-xs text-slate-400 truncate">{m.subIndustry}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-48">
                          {(m.certifications || "").split(",").slice(0, 3).map(c => (
                            <Badge key={c} variant="outline" className="text-xs px-1 py-0 border-slate-200 text-slate-600">
                              {c.trim()}
                            </Badge>
                          ))}
                          {(m.certifications || "").split(",").length > 3 && (
                            <Badge variant="outline" className="text-xs px-1 py-0 text-slate-400">
                              +{(m.certifications || "").split(",").length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                        {m.employeeCount && <div className="flex items-center gap-1"><Building2 className="w-3 h-3" />{m.employeeCount}</div>}
                        {m.annualRevenue && <div className="text-slate-400">{m.annualRevenue}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                        {m.moqMin ? `${m.moqMin.toLocaleString()}${m.moqMax ? `–${m.moqMax.toLocaleString()}` : "+"}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.url ? (
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`link-manufacturer-${m.id}`}
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : "—"}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages} · {data.total.toLocaleString()} total
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  return (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(p)}
                      className="w-8"
                      data-testid={`button-page-${p}`}
                    >
                      {p}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Source note */}
        <div className="text-xs text-slate-400 text-center pb-4">
          Database sourced from public company records, trade directories, and industry pattern templates ·
          {stats && ` ${stats.totalCount.toLocaleString()} manufacturers · `}
          {stats && ` ${stats.countryCount} countries · `}
          Last updated March 2026
        </div>
      </div>
    </div>
  );
}
