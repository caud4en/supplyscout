import { Link } from "wouter";
import { Compass, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col font-sans">
      <div className="fixed inset-0 pointer-events-none z-[-1] bg-[radial-gradient(hsl(var(--primary)/0.05)_1px,transparent_1px)] [background-size:24px_24px]" />
      
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-md shadow-sm shadow-slate-200/20">
        <div className="max-w-7xl mx-auto h-16 px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="bg-gradient-to-br from-primary to-blue-600 p-2 rounded-xl text-primary-foreground shadow-md shadow-primary/20">
              <Compass className="w-5 h-5" />
            </div>
            <span className="font-display font-bold text-2xl tracking-tight text-slate-900">
              Supply<span className="text-primary">Scout</span>
            </span>
          </Link>
          <nav>
            <Button asChild variant="ghost" className="text-slate-600 hover:text-primary hover:bg-primary/10 font-semibold hidden sm:flex">
              <Link href="/new"><Plus className="w-4 h-4 mr-2" /> New Job</Link>
            </Button>
          </nav>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col relative">
        {children}
      </main>
    </div>
  );
}
