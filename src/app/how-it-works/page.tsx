export default function HowItWorksPage() {
  return (
    <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 relative">
      <div className="absolute inset-0 bg-dot-grid opacity-50"></div>
      <div className="relative h-full flex flex-col p-6 2xl:p-8 max-w-7xl mx-auto gap-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">How It Works</h1>
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-8 shadow-sm space-y-4 text-slate-700 dark:text-slate-300">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">The Analysis Pipeline</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li><strong>Normalization:</strong> Medication names are mapped to their active generic ingredients using RxNorm.</li>
            <li><strong>Label Retrieval:</strong> Official SPL (Structured Product Labeling) data is retrieved from openFDA for each active ingredient.</li>
            <li><strong>AI Extraction:</strong> A Large Language Model processes relevant labeling sections (like warnings and drug interactions) to find safety signals between the provided medications.</li>
            <li><strong>Graph Visualization:</strong> The findings are mapped into an interactive graph showing signals, duplicate ingredients, and evidence quotes directly from the label.</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
