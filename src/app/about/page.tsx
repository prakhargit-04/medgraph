export default function AboutPage() {
  return (
    <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 relative">
      <div className="absolute inset-0 bg-dot-grid opacity-50"></div>
      <div className="relative h-full flex flex-col p-6 2xl:p-8 max-w-7xl mx-auto gap-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">About MedGraph</h1>
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-8 shadow-sm">
          <p className="text-slate-700 dark:text-slate-300 mb-4">
            MedGraph is a clinical medication safety intelligence tool designed to surface potential drug interactions based on FDA-submitted drug labeling.
          </p>
          <p className="text-slate-700 dark:text-slate-300">
            By analyzing multiple medications concurrently, MedGraph turns fragmented lists into an evidence-grounded safety graph, helping users identify overlapping active ingredients and potential adverse signals.
          </p>
        </div>
      </div>
    </main>
  );
}
