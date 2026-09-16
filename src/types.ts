import type { RejectionLog } from './lib/extraction';

export interface LabelSections {
  [key: string]: string | null | undefined;
  boxed_warning?: string | null;
  warnings?: string | null;
  drug_interactions?: string | null;
  precautions?: string | null;
}

// Source metadata for a retrieved FDA label, used to make the Evidence
// Inspector and the exported report show WHERE evidence came from, not just
// the quote itself. Every field is optional because openFDA doesn't
// guarantee any of them are populated for a given label.
export interface LabelMeta {
  manufacturerName?: string | null;
  applicationNumber?: string | null;
  effectiveTime?: string | null; // raw YYYYMMDD from openFDA, formatted at render time
  setId?: string | null;
  brandName?: string | null;
}

export interface ValidatedEdge {
  source_drug: string;
  target_drug: string;
  other_drug: string;
  plain_language_summary: string;
  evidence_quote: string;
  section_context?: string | null;
  label_section?: string;
}

export interface AnalysisResult {
  originalName: string;
  rxcui?: string;
  genericName?: string;
  error?: string;
  labelState?: 'loading' | 'found' | 'not_found' | 'error';
  labelReason?: string;
  labelSections?: LabelSections;
  labelMeta?: LabelMeta | null;
  extractionState?: 'ok' | 'failed';
}

// A node in the interaction graph. `rxcui` is populated whenever the
// underlying AnalysisResult resolved one (live mode only — demo fixtures
// don't carry RxCUI data), so the UI can show it but must always tolerate
// it being absent.
export interface GraphNodeData {
  id: string;
  label: string;
  rxcui?: string | null;
}

export interface GraphEdgeData {
  id: string; // sorted pair id "drugA-drugB"
  from: string;
  to: string;
  status: 'signal' | 'no_evidence' | 'unavailable' | 'extraction_failed';
  evidenceItems: ValidatedEdge[];
}

export interface GraphStats {
  medicinesCount: number;
  possiblePairs: number;
  checkedPairs: number;
  unresolvedPairs: number;
  signals: number;
  noEvidence: number;
  unavailable: number;
  extractionFailed: number;
}

export interface DuplicateWarning {
  genericName: string;
  originalNames: string[];
  message: string;
}

export interface PatientProfile {
  age?: number;
  weightKg?: number;
  pregnancyStatus?: 'not_applicable' | 'no' | 'yes';
  kidneyCondition?: boolean;
  liverCondition?: boolean;
  allergies?: string;
  additionalConditions?: string;
}

export interface MedicationSchedule {
  id: string;
  medicationName: string;
  dose?: string;
  frequency: 'once_daily' | 'twice_daily' | 'three_times_daily' | 'four_times_daily' | 'custom';
  times: string[];
  startDate?: string;
  endDate?: string;
  enabled: boolean;
}

export interface PatientSpecificWarning {
  id: string;
  medicationName: string;
  category: 'kidney' | 'liver' | 'pregnancy' | 'age' | 'weight';
  title: string;
  summary: string;
  evidenceQuote: string;
  labelSection?: string;
  sourceMeta?: LabelMeta | null;
}

// 'completed' = every possible pair was either a confirmed signal or
// explicitly checked with no evidence found.
// 'partial'   = at least one pair was analyzed, but one or more AI
// extraction calls failed — the graph is usable but incomplete.
// 'unresolved' = nothing could actually be analyzed (e.g. no medication
// resolved to a usable label), so there is no meaningful graph yet even
// though the request itself succeeded. Must never be presented as "completed".
export type AnalysisStatus = 'completed' | 'partial' | 'unresolved';


export interface AnalyzeResponse {
  results: AnalysisResult[];
  evidenceItems: ValidatedEdge[];
  rejections?: RejectionLog[];
  duplicates: DuplicateWarning[];
  graph: {
    nodes: GraphNodeData[];
    edges: GraphEdgeData[];
  };
  stats: GraphStats;
  analysisStatus: AnalysisStatus;
  patientWarnings?: PatientSpecificWarning[];
  error?: string;
}

// A single saved run, persisted client-side (localStorage) so the History
// page can show and reload past comparisons. `data` holds the exact
// AnalyzeResponse shape returned by /api/analyze so a saved run can be
// restored into the main view pixel-for-pixel, without re-calling the API.
export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO 8601, Date.toISOString()
  medications: string[]; // names exactly as entered by the user, in order
  demo: boolean;
  analysisStatus: AnalysisStatus;
  stats: GraphStats;
  data: AnalyzeResponse;
  patientProfile?: PatientProfile;
}
