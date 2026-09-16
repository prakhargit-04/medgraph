'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { AnalysisResult, ValidatedEdge, GraphEdgeData, GraphNodeData, GraphStats, DuplicateWarning, AnalysisStatus, LabelMeta, PatientProfile as PatientProfileType, PatientSpecificWarning } from '../types';
import Graph from '../components/Graph';
import EvidenceInspector from '../components/EvidenceInspector';
import ReportView from '../components/ReportView';
import { saveHistoryEntry, getHistoryEntry } from '../lib/history';
import PatientProfile from '../components/PatientProfile';
import MedicationSchedule from '../components/MedicationSchedule';
import InteractionMatrix from '../components/InteractionMatrix';

// MedGraph's MVP is scoped to 5 medications per analysis. This is the one
// place that constant is defined client-side; /api/analyze enforces the
// same limit server-side so a direct API call can't bypass it.
const MAX_MEDS = 5;

interface AnalyzeApiResponse {
  results: AnalysisResult[];
  evidenceItems: ValidatedEdge[];
  duplicates: DuplicateWarning[];
  graph: { nodes: GraphNodeData[]; edges: GraphEdgeData[] };
  stats: GraphStats;
  analysisStatus: AnalysisStatus;
  error?: string;
  patientWarnings?: PatientSpecificWarning[];
}

export default function Home() {
  const [medicines, setMedicines] = useState<{ id: string; name: string }[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // 'partial' = usable graph but one or more extraction calls failed.
  // 'unresolved' = the request succeeded but nothing could actually be
  // analyzed (e.g. no medication resolved to a usable label). Neither of
  // these may ever be presented to the user as "completed".
  const [extractionState, setExtractionState] = useState<'idle' | 'extracting' | AnalysisStatus | 'error'>('idle');
  const [extractionError, setExtractionError] = useState<string | null>(null);

  const [analyzeData, setAnalyzeData] = useState<AnalyzeApiResponse | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);

  const [isDemoMode, setIsDemoMode] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [patientProfile, setPatientProfile] = useState<PatientProfileType>({ pregnancyStatus: 'not_applicable' });
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem('medgraph_patient_profile_v1'); if (saved) setPatientProfile(JSON.parse(saved)); } catch { /* ignore malformed local data */ }
  }, []);
  useEffect(() => { localStorage.setItem('medgraph_patient_profile_v1', JSON.stringify(patientProfile)); }, [patientProfile]);

  // Race-condition guard: if the user changes medications and re-clicks
  // Analyze while a previous analysis is still in flight, the old run's
  // late-arriving results must not overwrite the new run's state. Every call
  // to handleAnalyze claims a fresh id; only the run holding the CURRENT id
  // is allowed to commit its results.
  const analysisIdRef = useRef(0);

  const isCapReached = medicines.length >= MAX_MEDS;

  // Restoring a past run from the History page: it links here with
  // ?history=<id>, we look the entry up client-side and replay it into
  // state exactly as if the API had just returned it — no network call,
  // and no re-analysis, since the whole point is reviewing what was
  // already found. Uses window.location directly (rather than
  // useSearchParams) so this page never needs a Suspense boundary just
  // for a one-time param read on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const historyId = params.get('history');
    if (!historyId) return;

    const entry = getHistoryEntry(historyId);
    if (!entry) return;

    analysisIdRef.current++;
    setMedicines(entry.medications.map((name) => ({ id: crypto.randomUUID(), name })));
    setIsDemoMode(entry.demo);
    setAnalyzeData(entry.data);
    setExtractionState(entry.data.analysisStatus);
    setExtractionError(null);
    setSelectedEdge(null);
    setPatientProfile(entry.patientProfile || { pregnancyStatus: 'not_applicable' });

    // Clean the URL so a page refresh doesn't keep re-restoring the same
    // entry, and so "New Analysis" from the nav genuinely starts fresh.
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAnalysisState = () => {
    setAnalyzeData(null);
    setExtractionState('idle');
    setExtractionError(null);
    setSelectedEdge(null);
  };

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inputValue.trim() && !isCapReached) {
      analysisIdRef.current++; // Invalidate any in-flight analysis — the list just changed.
      setMedicines([...medicines, { id: crypto.randomUUID(), name: inputValue.trim() }]);
      setInputValue('');
      resetAnalysisState();
    }
  };

  const handleRemove = (idToRemove: string) => {
    analysisIdRef.current++; // Invalidate any in-flight analysis — the list just changed.
    setMedicines(medicines.filter((med) => med.id !== idToRemove));
    resetAnalysisState();
  };

  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
      }
      throw err;
    }
  };

  // Live and demo mode both go through the exact same server-side pipeline
  // (normalize -> retrieve labels -> extract -> validate -> aggregate) via
  // POST /api/analyze. The frontend used to re-implement that whole pipeline
  // a second time by calling /api/normalize, /api/label and /api/extract
  // directly for live mode — meaning a fix to the pipeline logic could apply
  // to demo mode but not to what users actually see. There is now exactly
  // one pipeline, and the UI is a thin client over its result.
  const handleAnalyze = async () => {
    if (medicines.length < 2) return;
    const invalidAge = patientProfile.age !== undefined && (!Number.isFinite(patientProfile.age) || patientProfile.age < 1 || patientProfile.age > 130);
    const invalidWeight = patientProfile.weightKg !== undefined && (!Number.isFinite(patientProfile.weightKg) || patientProfile.weightKg < 1 || patientProfile.weightKg > 500);
    if (invalidAge || invalidWeight) { setProfileError('Age must be 1–130 and weight must be 1–500 kg.'); return; }
    setProfileError(null);

    const myAnalysisId = ++analysisIdRef.current;
    const isCurrent = () => analysisIdRef.current === myAnalysisId;

    setIsAnalyzing(true);
    setExtractionState('extracting');
    setExtractionError(null);
    setAnalyzeData(null);
    setSelectedEdge(null);

    try {
      const response = await fetchWithTimeout('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medications: medicines.map(m => m.name),
          demo: isDemoMode,
          patientProfile,
        }),
      }, 45000); // full server-side pipeline for up to 5 meds; generous budget for the Gemini cascade
      const data: AnalyzeApiResponse = await response.json();
      if (!isCurrent()) return; // A newer analysis superseded this one — discard.

      if (response.ok) {
        setAnalyzeData(data);
        setExtractionState(data.analysisStatus);
        // Every run that actually came back from the pipeline is worth
        // recording — including 'unresolved' ones, since knowing "I tried
        // this combination and nothing could be checked" is itself useful
        // history, not noise to discard.
        saveHistoryEntry({
          medications: medicines.map((m) => m.name),
          demo: isDemoMode,
          data,
          patientProfile,
        });
      } else {
        setExtractionError(data.error || 'Analysis failed');
        setExtractionState('error');
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      setExtractionError(err.message || 'Failed to connect to server');
      setExtractionState('error');
    }
    if (isCurrent()) setIsAnalyzing(false);
  };

  const graphData = useMemo(() => {
    // Render the graph for completed, partial, AND unresolved — even an
    // "unresolved" response has a (empty/mostly-unavailable) graph shape
    // worth showing, it just needs the right banner below. Only
    // 'idle' | 'extracting' | 'error' withhold it entirely.
    if (!analyzeData) return null;

    // Source metadata per drug (genericName -> LabelMeta), so the Evidence
    // Inspector and the exported report can say exactly which labeling
    // record a quote came from without threading extra props everywhere.
    const drugMeta: Record<string, LabelMeta | null | undefined> = {};
    analyzeData.results.forEach((r) => {
      if (r.genericName) drugMeta[r.genericName] = r.labelMeta;
    });

    return {
      nodes: analyzeData.graph.nodes,
      edges: analyzeData.graph.edges,
      duplicates: analyzeData.duplicates,
      drugMeta,
      stats: analyzeData.stats,
    };
  }, [analyzeData]);

  const results = analyzeData?.results || [];
  const patientWarnings = analyzeData?.patientWarnings || [];

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 relative">
      <div className="absolute inset-0 bg-dot-grid opacity-50"></div>
      
      <div className="relative h-full flex flex-col p-6 2xl:p-8 max-w-7xl mx-auto gap-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Medication Safety Analysis</h1>
          <p className="mt-1 text-sm text-slate-500">Visualize and explore evidence-based relationships between your medications.</p>
        </div>
        
        {/* Top Analysis Bar */}
        <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 md:p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm">
          
          {/* Search / Input Area */}
          <form onSubmit={handleAdd} className="flex-1 w-full relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-11 pr-32 py-3.5 transition-all shadow-inner-sm" 
              placeholder={isCapReached ? "Maximum 5 medications added" : "Enter medication name (e.g., Warfarin)..."}
              disabled={isCapReached || isAnalyzing}
            />
            <div className="absolute inset-y-0 right-2 flex items-center">
              <button type="submit" disabled={!inputValue.trim() || isCapReached || isAnalyzing} className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 px-4 py-1.5 rounded-lg text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50">
                Add Drug
              </button>
            </div>
          </form>

          <div className="hidden xl:block w-px h-10 bg-slate-200 dark:bg-slate-800 mx-2"></div>

          {/* Drug Chips Area */}
          <div className="flex flex-wrap items-center gap-2 xl:max-w-[45%]">
            {medicines.length > 0 && <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-2">Active:</span>}
            
            {medicines.map((med) => (
              <div key={med.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-800/50 text-sm font-semibold text-blue-700 dark:text-blue-400 shadow-2xs group cursor-default transition-all hover:bg-blue-100/50 dark:hover:bg-blue-900/40">
                {med.name}
                <button onClick={() => handleRemove(med.id)} disabled={isAnalyzing} className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 ml-0.5 focus:outline-none rounded-full hover:bg-blue-200/50 dark:hover:bg-blue-800/50 p-0.5 transition-colors disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            ))}

            <button onClick={handleAnalyze} disabled={medicines.length < 2 || isAnalyzing} className="inline-flex items-center gap-2 px-5 py-2.5 ml-auto text-sm font-bold rounded-xl text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              {isAnalyzing ? 'Analyzing...' : 'Analyze Interaction'}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
            </button>
          </div>
        </div>

        <PatientProfile value={patientProfile} onChange={setPatientProfile} />
        {profileError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{profileError}</p>}
        <MedicationSchedule medications={medicines.map(m => m.name)} />

        {extractionError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 text-rose-900 dark:text-rose-200 text-sm font-medium">API Error: {extractionError}</div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input 
            type="checkbox" 
            checked={isDemoMode}
            onChange={(e) => setIsDemoMode(e.target.checked)}
            disabled={isAnalyzing}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <span>Use Demo Data</span>
        </label>

        {extractionState === 'extracting' && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            Retrieving labeling and running AI extraction pipeline...
          </div>
        )}

        {extractionState === 'partial' && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-sm font-medium">
            ⚠️ Analysis partially completed — one or more relationships could not be analyzed by the AI extraction step.
            Pairs marked <strong>extraction unavailable</strong> in the graph have not been checked; this does not mean they are safe.
          </div>
        )}

        {extractionState === 'unresolved' && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-sm font-medium">
            ⚠️ Nothing could actually be checked for this combination — none of the entered medications resolved to a usable
            FDA label, so no evidence extraction ran. This is not the same as a confirmed &ldquo;no interaction&rdquo;.
          </div>
        )}

        {graphData && (
        <InteractionMatrix nodes={graphData.nodes} edges={graphData.edges} warnings={patientWarnings} onSelect={setSelectedEdge} />
        )}

        {graphData && (
        /* Main Graph & Sidebar Area */
        <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-[500px]">
          
          {/* Graph Canvas Panel */}
          <div className="flex-1 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 rounded-3xl shadow-sm overflow-hidden relative flex flex-col min-h-[500px]">
            <Graph
              nodes={graphData.nodes}
              edges={graphData.edges}
              onEdgeSelect={setSelectedEdge}
              selectedEdgeId={selectedEdge?.id ?? null}
              warningNodeIds={patientWarnings.map(w => w.medicationName.toLowerCase())}
            />
          </div>

          {/* Right Sidebar - Evidence / Summary */}
          <div className="w-full lg:w-[380px] xl:w-[420px] flex flex-col gap-4">

            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">Patient Safety Summary</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm"><span>Interaction signals: <b>{graphData.stats.signals}</b></span><span>Patient warnings: <b>{patientWarnings.length}</b></span><span>Duplicate ingredients: <b>{graphData.duplicates.length}</b></span><span>Unresolved: <b>{graphData.stats.unresolvedPairs}</b></span></div>
              {patientWarnings.length > 0 && <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">{patientWarnings.map(w => <div key={w.id} className="rounded-lg bg-white/70 p-2 text-xs dark:bg-slate-900/60"><b>{w.medicationName}</b> — {w.title}<p className="mt-1 text-slate-600 dark:text-slate-300">{w.summary}</p><button onClick={() => setSelectedEdge({ id: `patient-${w.id}`, from: w.medicationName, to: 'Patient profile', status: 'signal', evidenceItems: [{ source_drug: w.medicationName, target_drug: w.medicationName, other_drug: 'Patient profile', plain_language_summary: w.summary, evidence_quote: w.evidenceQuote, label_section: w.labelSection }] })} className="mt-1 font-bold text-blue-600">View Evidence</button></div>)}</div>}
            </div>

            <button
              onClick={() => setShowReport(true)}
              className="w-full flex items-center justify-center gap-2 text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-4 py-3 rounded-2xl font-bold text-sm hover:bg-slate-700 dark:hover:bg-slate-100 shadow-sm hover:shadow-md transition-all active:scale-[0.99]"
              title="Export a doctor/pharmacist-ready evidence report"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H8a2 2 0 01-2-2V5a2 2 0 012-2h6l6 6v11a2 2 0 01-2 2z"></path></svg>
              Export Report
            </button>

            {graphData.duplicates.length > 0 && (
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 p-4 rounded-xl border border-rose-200 dark:border-rose-800 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path></svg>
                  Duplicate Active Ingredient
                </div>
                {graphData.duplicates.map((dup, idx) => (
                  <div key={idx} className="text-sm">
                    <div className="font-semibold mb-1">
                      {dup.originalNames.length} entered medications → 1 shared active ingredient ({dup.genericName})
                    </div>
                    <div className="text-rose-600/90 dark:text-rose-300/90">{dup.message}</div>
                  </div>
                ))}
                <div className="text-xs font-bold uppercase tracking-wide text-rose-500 dark:text-rose-400 pt-1 border-t border-rose-200/70 dark:border-rose-800/70">
                  Review before continuing
                </div>
              </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-2xs">
                <div className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Meds</div>
                <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{graphData.stats.medicinesCount}</div>
              </div>
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-4 rounded-2xl border border-rose-200/60 dark:border-rose-900/40 shadow-2xs relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-20">
                  <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <div className="text-rose-600 dark:text-rose-400 text-xs font-bold uppercase tracking-wider mb-1 relative z-10">Signals Found</div>
                <div className="text-3xl font-extrabold text-rose-700 dark:text-rose-300 relative z-10">{graphData.stats.signals}</div>
              </div>
            </div>

            {/* Pair coverage summary — makes clear that "no evidence" is not
                the same thing as "confirmed safe": it states exactly how
                many of the possible pairs were actually checked. */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 py-3 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-2xs text-xs font-semibold text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold mr-1">Coverage</span>
              <span>{graphData.stats.possiblePairs} possible {graphData.stats.possiblePairs === 1 ? 'pair' : 'pairs'}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-emerald-600 dark:text-emerald-400">{graphData.stats.checkedPairs} checked</span>
              {graphData.stats.unresolvedPairs > 0 && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-amber-600 dark:text-amber-400">{graphData.stats.unresolvedPairs} unresolved</span>
                </>
              )}
            </div>

            {/* Evidence Inspector Panel */}
            <div className="flex-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  Evidence Inspector
                </h3>
              </div>
              
              <div className="p-0 overflow-hidden flex-1 relative">
                <div className="absolute inset-0 overflow-y-auto w-full h-full">
                  <EvidenceInspector edge={selectedEdge} onClose={() => setSelectedEdge(null)} drugMeta={graphData.drugMeta} />
                </div>
              </div>
            </div>

          </div>

        </div>
        )}
      </div>

      {showReport && graphData &&
        (extractionState === 'completed' || extractionState === 'partial' || extractionState === 'unresolved') && (
        <ReportView
          results={results}
          edges={graphData.edges}
          duplicates={graphData.duplicates}
          drugMeta={graphData.drugMeta}
          stats={graphData.stats}
          analysisStatus={extractionState}
          onClose={() => setShowReport(false)}
        />
      )}
    </main>
  );
}
