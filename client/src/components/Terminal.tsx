import { useEffect, useRef } from "react";
import type { LogResponse } from "@shared/routes";

export function Terminal({ logs, isProcessing }: { logs: LogResponse[], isProcessing: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="w-full bg-[#0D1117] rounded-xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col h-[500px]">
      <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center px-4 gap-2 shrink-0">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <span className="ml-4 text-xs text-slate-400 font-mono tracking-wider uppercase">Agent stdout</span>
        {isProcessing && (
          <div className="ml-auto flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="text-xs text-primary font-mono animate-pulse">Running</span>
          </div>
        )}
      </div>
      
      <div className="p-4 overflow-y-auto flex-1 font-mono text-sm space-y-3">
        {logs.length === 0 && isProcessing && (
          <div className="text-slate-500 flex items-center gap-2 animate-pulse">
            <span className="text-slate-700 shrink-0 select-none">--:--:--</span>
            Initializing secure agent environment...
          </div>
        )}
        
        {logs.map((log) => {
          const isError = log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("fail");
          const isSuccess = log.message.toLowerCase().includes("success") || log.message.toLowerCase().includes("found") || log.message.toLowerCase().includes("sent rfq");
          
          return (
            <div key={log.id} className="flex items-start gap-4 hover:bg-slate-800/30 px-2 py-1 -mx-2 rounded transition-colors">
              <span className="text-slate-600 shrink-0 select-none w-20">
                {new Date(log.timestamp!).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={`break-words ${
                isError ? "text-red-400" : isSuccess ? "text-green-400" : "text-slate-300"
              }`}>
                {log.message}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}
