import { AnalysisResult, GraphEdgeData, LabelMeta, GraphStats, DuplicateWarning, AnalysisStatus } from '../types';

interface ReportViewProps {
  results: AnalysisResult[];
  edges: GraphEdgeData[];
  duplicates: DuplicateWarning[];
  drugMeta: Record<string, LabelMeta | null | undefined>;
  stats: GraphStats;
  analysisStatus: AnalysisStatus;
  onClose: () => void;
}

const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  completed: 'Completed',
  partial: 'Partially completed — see unresolved items',
  unresolved: 'Unresolved — nothing could be checked for this combination',
};

function formatEffectiveTime(raw?: string | null): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const year = raw.slice(0, 4);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = raw.slice(6, 8);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (month < 0 || month > 11) return null;
  return `${parseInt(day, 10)} ${months[month]} ${year}`;
}

export default function ReportView({ results, edges, duplicates, drugMeta, stats, analysisStatus, onClose }: ReportViewProps) {
  const analysisDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const signalEdges = edges.filter(e => e.status === 'signal');
  const unavailableEdges = edges.filter(e => e.status === 'unavailable');
  const extractionFailedEdges = edges.filter(e => e.status === 'extraction_failed');

  return (
    <div id="medgraph-report-overlay" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 px-4 print:p-0 print:bg-white print:block">
      {/* Screen-only toolbar */}
      <div className="fixed top-4 right-4 flex gap-2 print:hidden z-10">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a1 1 0 001-1v-5a1 1 0 00-1-1H9a1 1 0 00-1 1v5a1 1 0 001 1z"></path></svg>
          Print / Save as PDF
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-100 shadow-lg transition-colors border border-slate-200"
        >
          Close
        </button>
      </div>

      {/* The report itself */}
      <div id="medgraph-report" className="w-full max-w-[820px] bg-white text-slate-900 rounded-2xl shadow-2xl p-10 print:shadow-none print:rounded-none print:p-0 print:max-w-none my-4 print:my-0 font-serif">

        {/* Header */}
        <div className="border-b-2 border-slate-800 pb-4 mb-6">
          <div className="text-xs font-sans font-bold uppercase tracking-widest text-slate-500 mb-1">MedGraph</div>
          <h1 className="text-2xl font-bold font-sans">Medication Safety Analysis Report</h1>
          <div className="grid grid-cols-3 gap-4 mt-4 text-sm font-sans">
            <div>
              <div className="text-slate-400 text-xs uppercase font-bold tracking-wide">Analysis Date</div>
              <div className="font-semibold">{analysisDate}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs uppercase font-bold tracking-wide">Medications Analyzed</div>
              <div className="font-semibold">{stats.medicinesCount}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs uppercase font-bold tracking-wide">Analysis Status</div>
              <div className="font-semibold">
                {ANALYSIS_STATUS_LABEL[analysisStatus]}
              </div>
            </div>
          </div>
        </div>

        {/* Medication list */}
        <section className="mb-6">
          <h2 className="text-sm font-bold font-sans uppercase tracking-wide text-slate-500 mb-2">Medications Entered</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-300 font-sans text-xs uppercase text-slate-500">
                <th className="text-left py-1.5 font-bold">Entered As</th>
                <th className="text-left py-1.5 font-bold">Normalized Ingredient</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="py-1.5">{r.originalName}</td>
                  <td className="py-1.5 capitalize">{r.error ? '—' : (r.genericName || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Duplicate ingredient warnings */}
        {duplicates.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-bold font-sans uppercase tracking-wide text-rose-600 mb-2">Duplicate Active Ingredient Warning</h2>
            {duplicates.map((dup, idx) => (
              <div key={idx} className="text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 mb-2">
                {dup.message}
              </div>
            ))}
          </section>
        )}

        {/* Findings */}
        <section className="mb-6">
          <h2 className="text-sm font-bold font-sans uppercase tracking-wide text-slate-500 mb-2">Findings</h2>
          {signalEdges.length === 0 && (
            <div className="text-sm text-slate-500 italic">No potential safety signals were identified among the entered medications&apos; retrieved labeling.</div>
          )}
          {signalEdges.map((edge) => (
            <div key={edge.id} className="mb-5 break-inside-avoid">
              <div className="font-bold font-sans text-base mb-1 capitalize">{edge.from} ↔ {edge.to}</div>
              <div className="text-xs font-sans font-bold uppercase tracking-wide text-rose-600 mb-2">Potential safety signal</div>
              {edge.evidenceItems.map((item, idx) => {
                const meta = drugMeta[item.source_drug];
                const effectiveDate = formatEffectiveTime(meta?.effectiveTime);
                return (
                  <div key={idx} className="mb-3 pl-3 border-l-2 border-slate-200">
                    <div className="text-sm mb-1.5">{item.plain_language_summary}</div>
                    <div className="text-xs font-sans text-slate-500 mb-1">
                      <span className="font-bold">Source:</span> <span className="capitalize">{item.source_drug}</span> — FDA-submitted labeling retrieved through openFDA
                      {meta?.manufacturerName && <> · {meta.manufacturerName}</>}
                      {effectiveDate && <> · label effective {effectiveDate}</>}
                    </div>
                    <div className="text-xs font-sans text-slate-500 mb-1.5">
                      <span className="font-bold">Section:</span> {item.label_section ? item.label_section.replace(/_/g, ' ') : (item.section_context || '—')}
                    </div>
                    <div className="text-sm italic bg-slate-50 border border-slate-200 rounded p-2.5 mb-1.5">
                      &ldquo;{item.evidence_quote}&rdquo;
                    </div>
                    <div className="text-[11px] font-sans text-emerald-700 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>✓ Exact quote found in retrieved source</span>
                      <span>✓ Other medication explicitly named</span>
                      {item.section_context && <span>✓ Source section verified</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        {/* Unresolved items */}
        {(unavailableEdges.length > 0 || extractionFailedEdges.length > 0) && (
          <section className="mb-6">
            <h2 className="text-sm font-bold font-sans uppercase tracking-wide text-amber-600 mb-2">Unresolved Items</h2>
            <table className="w-full text-sm border-collapse font-sans">
              <tbody>
                {unavailableEdges.length > 0 && (
                  <tr className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-500">Source unavailable</td>
                    <td className="py-1.5 font-semibold">{unavailableEdges.length} pair(s): {unavailableEdges.map(e => `${e.from} ↔ ${e.to}`).join(', ')}</td>
                  </tr>
                )}
                {extractionFailedEdges.length > 0 && (
                  <tr>
                    <td className="py-1.5 text-slate-500">Extraction unavailable</td>
                    <td className="py-1.5 font-semibold">{extractionFailedEdges.length} pair(s): {extractionFailedEdges.map(e => `${e.from} ↔ ${e.to}`).join(', ')}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="text-xs text-slate-500 italic mt-2">
              Items above were not checked, or could not be checked. This does not mean these combinations are safe.
            </div>
          </section>
        )}

        {/* Disclaimer */}
        <div className="mt-8 pt-4 border-t border-slate-300 text-[11px] leading-relaxed text-slate-500 font-sans">
          This report summarizes evidence identified in FDA-submitted drug labeling retrieved through openFDA. It is not a diagnosis, prescription, or determination that a medication combination is safe or unsafe. MedGraph is not a diagnostic or prescribing tool and does not replace professional medical advice. &ldquo;No relevant evidence found&rdquo; does not mean a combination is safe. Discuss any findings in this report with a doctor or pharmacist before making changes to a medication regimen.
        </div>
      </div>
    </div>
  );
}