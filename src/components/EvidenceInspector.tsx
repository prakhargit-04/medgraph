import { GraphEdgeData, LabelMeta } from '../types';

interface EvidenceInspectorProps {
  edge: GraphEdgeData | null;
  onClose: () => void;
  drugMeta?: Record<string, LabelMeta | null | undefined>;
}

// "20240315" -> "15 Mar 2024". Returns null (never a raw string) on anything
// that doesn't look like an openFDA effective_time date, so the UI can
// simply omit the row rather than show a malformed date.
function formatEffectiveTime(raw?: string | null): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const year = raw.slice(0, 4);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = raw.slice(6, 8);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (month < 0 || month > 11) return null;
  return `${parseInt(day, 10)} ${months[month]} ${year}`;
}

export default function EvidenceInspector({ edge, onClose, drugMeta }: EvidenceInspectorProps) {
  if (!edge) return null;

  return (
    <div className="flex-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl shadow-sm flex flex-col h-full w-full">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center sticky top-0 z-10">
        <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Evidence Inspector
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      
      <div className="p-5 overflow-y-auto flex-1 pb-10 space-y-6">
        
        {/* Interaction Header */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm font-bold border border-slate-200 dark:border-slate-700 capitalize">{edge.from}</span>
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm font-bold border border-slate-200 dark:border-slate-700 capitalize">{edge.to}</span>
          </div>
          
          {edge.status === 'signal' && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 text-rose-900 dark:text-rose-200 text-sm leading-relaxed font-medium">
              <strong>Important:</strong> Discuss this combination with a doctor or pharmacist before changing anything.
            </div>
          )}

          {edge.status === 'extraction_failed' && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-sm leading-relaxed font-medium">
              <strong>Extraction unavailable:</strong> MedGraph retrieved the source labeling but could not complete AI evidence extraction for this pair.
              <br />This does not mean the combination is safe — it means it was not checked.
            </div>
          )}
          
          {edge.status === 'no_evidence' && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium">
              No explicit evidence found linking these two medications in their respective FDA-submitted labeling.
            </div>
          )}

          {edge.status === 'unavailable' && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium">
              <strong>Source unavailable:</strong> FDA-submitted labeling could not be retrieved for one or both medications.
              <br />This does not mean the combination is safe — it means it was not checked.
            </div>
          )}
        </div>

        {edge.evidenceItems.map((item, idx) => {
          const meta = drugMeta?.[item.source_drug];
          const effectiveDate = formatEffectiveTime(meta?.effectiveTime);
          return (
          <div key={idx} className="space-y-4">
            {/* Plain Summary */}
            <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {item.plain_language_summary}
            </div>

            {/* Evidence Quote */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Source Evidence ({item.source_drug})</h4>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                {item.section_context && (
                  <div className="text-[10px] font-mono text-slate-400 mb-2 uppercase font-semibold">Source: {item.section_context}</div>
                )}
                <p className="text-sm text-slate-600 dark:text-slate-300 italic font-serif leading-relaxed">
                  "{item.evidence_quote}"
                </p>
              </div>
            </div>

            {/* Source Metadata */}
            <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/40 text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px] mb-1.5">Source Record</div>
              <div><span className="text-slate-400 dark:text-slate-500">Labeling for:</span> <span className="font-medium capitalize">{item.source_drug}</span> — FDA-submitted labeling retrieved through openFDA</div>
              <div><span className="text-slate-400 dark:text-slate-500">Section:</span> {item.label_section ? item.label_section.replace(/_/g, ' ') : '—'}</div>
              {meta?.manufacturerName && (
                <div><span className="text-slate-400 dark:text-slate-500">Manufacturer:</span> {meta.manufacturerName}</div>
              )}
              {effectiveDate && (
                <div><span className="text-slate-400 dark:text-slate-500">Label effective date:</span> {effectiveDate}</div>
              )}
              {!meta?.manufacturerName && !effectiveDate && (
                <div className="text-slate-400 dark:text-slate-500 italic">Additional label metadata not available for this source.</div>
              )}
            </div>

            {/* Verifications */}
            <div className="pt-2">
              <div className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px] mb-1.5">Evidence Verification</div>
              <div className="flex flex-col gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  Source label retrieved from openFDA
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  Exact quote found verbatim in label text
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  Co-administered drug explicitly named in the quote
                </div>
                {item.section_context ? (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    Section heading confirmed in the same source section
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    No section heading was present near this quote
                  </div>
                )}
              </div>
            </div>
            
            {idx < edge.evidenceItems.length - 1 && <hr className="border-slate-200 dark:border-slate-700 my-4" />}
          </div>
          );
        })}
      </div>
    </div>
  );
}
