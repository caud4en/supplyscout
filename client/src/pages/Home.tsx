import { Link } from "wouter";
import { ArrowRight, Bot, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

export default function Home() {
  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center py-20 px-4">
      <motion.div 
        variants={containerVariants} 
        initial="hidden" 
        animate="show"
        className="max-w-4xl mx-auto text-center"
      >
        <motion.div variants={itemVariants}>
          <Badge variant="secondary" className="mb-8 py-2 px-5 text-sm rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 shadow-sm">
            <Bot className="w-4 h-4 mr-2" />
            Introducing the world's first AI Sourcing Agent
          </Badge>
        </motion.div>

        <motion.h1 variants={itemVariants} className="text-5xl sm:text-7xl font-display font-extrabold text-slate-900 tracking-tight leading-[1.1] mb-8">
          Find perfect manufacturing partners <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-500 to-indigo-500">autonomously.</span>
        </motion.h1>

        <motion.p variants={itemVariants} className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto mb-12 leading-relaxed">
          SupplyScout uses advanced LLMs to analyze your product specifications, search global databases, evaluate suppliers, and autonomously send RFQs—saving you weeks of manual work.
        </motion.p>

        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild size="lg" className="h-14 px-8 text-lg rounded-full font-semibold shadow-xl shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-1">
            <Link href="/new">
              Deploy Your Agent <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="h-14 px-8 text-lg rounded-full font-medium bg-white/50 backdrop-blur-sm border-slate-200 hover:bg-white transition-all">
            View Example Output
          </Button>
        </motion.div>

        <motion.div variants={itemVariants} className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <div className="bg-white/60 backdrop-blur-sm p-6 rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="bg-blue-100 w-12 h-12 rounded-xl flex items-center justify-center text-blue-600 mb-4">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-900 mb-2">Instant Discovery</h3>
            <p className="text-slate-600">Give our AI a spec, and it immediately begins crawling thousands of databases to find capable facilities.</p>
          </div>
          <div className="bg-white/60 backdrop-blur-sm p-6 rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="bg-emerald-100 w-12 h-12 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-900 mb-2">Automated Vetting</h3>
            <p className="text-slate-600">Suppliers are scored based on capabilities, MOQs, and verifiable ISO/FDA certifications matching your needs.</p>
          </div>
          <div className="bg-white/60 backdrop-blur-sm p-6 rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="bg-purple-100 w-12 h-12 rounded-xl flex items-center justify-center text-purple-600 mb-4">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-900 mb-2">RFQ Outreach</h3>
            <p className="text-slate-600">The agent drafts professional, tailored RFQ emails and initiates contact with the top-scoring vendors automatically.</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
