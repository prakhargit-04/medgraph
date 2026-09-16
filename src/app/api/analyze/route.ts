import { NextRequest, NextResponse } from 'next/server';
import { validateEdge, runExtraction, type RejectionLog } from '../../../lib/extraction';
import { normalizeDrug } from '../../../lib/normalization';
import { fetchLabelForGeneric } from '../../../lib/labeling';
import { getErrorMessage } from '../../../lib/errors';
import type { AnalysisResult, ValidatedEdge, GraphEdgeData, AnalysisStatus, GraphStats, DuplicateWarning, LabelSections, LabelMeta, PatientProfile, PatientSpecificWarning } from '../../../types';

// Shape of src/app/fixtures/demoData.json. Demo mode replays these
// pre-captured, pre-validated fixtures instead of calling any live API.
interface DemoData {
  normalize: Record<string, { originalName: string; genericName?: string }>;
  label: Record<string, { genericName: string; found: boolean; sections?: LabelSections; meta?: LabelMeta | null }>;
  extract: Record<string, { rawOutput?: string; simulateFailure?: boolean; failureReason?: string }>;
}

// Same cap the frontend enforces client-side (MAX_MEDS in page.tsx). Kept as
// a single shared constant concept — MedGraph's MVP is scoped to 5
// medications per analysis, both client- and server-side — and enforced
// again here so a direct API caller can't bypass it with an unbounded list.
const MAX_MEDICATIONS = 5;

// Patient warnings are deliberately generated only from retrieved label text.
// This is keyword routing, not medical inference: profile information merely
// surfaces an existing relevant passage and never declares a medicine unsafe.
function buildPatientWarnings(results: AnalysisResult[], profile?: PatientProfile): PatientSpecificWarning[] {
  if (!profile) return [];
  const rules: Array<{ key: keyof PatientProfile; category: PatientSpecificWarning['category']; title: string; pattern: RegExp }> = [
    { key: 'kidneyCondition', category: 'kidney', title: 'Kidney-related evidence', pattern: /\b(renal|kidney|creatinine|dialysis)\b/i },
    { key: 'liverCondition', category: 'liver', title: 'Liver-related evidence', pattern: /\b(hepatic|liver|transaminase)\b/i },
    { key: 'pregnancyStatus', category: 'pregnancy', title: 'Pregnancy-related evidence', pattern: /\b(pregnan|fetal|lactation)\b/i },
    { key: 'age', category: 'age', title: 'Age-related evidence', pattern: /\b(geriatric|elderly|older adults|pediatric|children)\b/i },
    { key: 'weightKg', category: 'weight', title: 'Weight-related information', pattern: /\b(mg\/kg|body weight|weight-based)\b/i },
  ];
  const active = rules.filter(r => r.key === 'pregnancyStatus' ? profile.pregnancyStatus === 'yes' : profile[r.key] !== undefined && profile[r.key] !== false);
  const warnings: PatientSpecificWarning[] = [];
  results.forEach(result => {
    if (!result.genericName || !result.labelSections) return;
    for (const rule of active) {
      for (const [section, content] of Object.entries(result.labelSections)) {
        if (!content || !rule.pattern.test(content)) continue;
        const sentences = content.match(/[^.!?]*[.!?]/g) || [content];
        const quote = sentences.find(s => rule.pattern.test(s))?.trim() || content.slice(0, 420).trim();
        warnings.push({ id: `${result.genericName}-${rule.category}`, medicationName: result.genericName, category: rule.category, title: rule.title, summary: `The medication labeling contains information relevant to this patient profile. This may warrant additional review with a healthcare professional.`, evidenceQuote: quote, labelSection: section, sourceMeta: result.labelMeta });
        break;
      }
    }
  });
  return warnings;
}

// Groups results by generic name using a case-insensitive key so that
// capitalization differences (e.g. "paracetamol" vs "Paracetamol") can never
// prevent duplicate-ingredient detection or graph node de-duplication. The
// first-seen original casing is kept as the display value.
function groupByGenericName(results: AnalysisResult[]) {
  const genericToOriginalsMap = new Map<string, string[]>(); // display genericName -> original entered names
  const genericToResultMap = new Map<string, AnalysisResult>(); // display genericName -> representative result
  const keyToDisplayName = new Map<string, string>(); // lowercased key -> display genericName

  results.forEach((r) => {
    if (r.error || !r.genericName) return;
    const key = r.genericName.trim().toLowerCase();
    let displayName = keyToDisplayName.get(key);
    if (!displayName) {
      displayName = r.genericName;
      keyToDisplayName.set(key, displayName);
    }
    const existing = genericToOriginalsMap.get(displayName) || [];
    genericToOriginalsMap.set(displayName, [...existing, r.originalName]);
    if (!genericToResultMap.has(displayName)) {
      genericToResultMap.set(displayName, r);
    }
  });

  return { genericToOriginalsMap, genericToResultMap };
}

function buildDuplicateWarnings(genericToOriginalsMap: Map<string, string[]>): DuplicateWarning[] {
  const duplicates: DuplicateWarning[] = [];
  genericToOriginalsMap.forEach((originals, genericName) => {
    if (originals.length > 1) {
      const msg =
        originals.length === 2
          ? `${originals[0]} and ${originals[1]} both contain ${genericName} — check you're not double-dosing the same ingredient.`
          : `${originals.slice(0, -1).join(', ')}, and ${originals[originals.length - 1]} all contain ${genericName} — check you're not double-dosing the same ingredient.`;
      duplicates.push({ genericName, originalNames: originals, message: msg });
    }
  });
  return duplicates;
}

// ---------------------------------------------------------------------------
// Thin adapters over the shared lib functions, translating their generic
// result shapes into the AnalysisResult partial shape this route builds up
// incrementally. The actual normalization/label-lookup logic lives in
// src/lib/normalization.ts and src/lib/labeling.ts, shared with the
// /api/normalize and /api/label HTTP routes — not duplicated here.
// ---------------------------------------------------------------------------
async function resolveNormalization(name: string): Promise<Partial<AnalysisResult>> {
  const result = await normalizeDrug(name);
  if (result.error) {
    return { originalName: name, error: result.error };
  }
  return { originalName: name, rxcui: result.rxcui, genericName: result.genericName, labelState: 'loading' };
}

async function resolveLabel(genericName: string): Promise<Partial<AnalysisResult>> {
  const result = await fetchLabelForGeneric(genericName);
  if (!result.found) {
    return {
      labelState: result.reason === 'api_error' || result.reason === 'timeout' ? 'error' : 'not_found',
      labelReason: result.reason,
    };
  }
  return { labelState: 'found', labelSections: result.sections, labelMeta: result.meta };
}

// Runs `worker` over `items` with at most `limit` in flight at once. Same
// bounded-concurrency approach the frontend uses for extraction calls, kept
// here so a live /api/analyze request can't fire an unbounded number of
// concurrent Gemini calls for a large medication list.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { medications, demo, patientProfile } = body;

    if (!medications || !Array.isArray(medications)) {
      return NextResponse.json({ error: 'medications array is required' }, { status: 400 });
    }

    // Input validation: reject the whole request if it contains anything
    // that isn't a non-empty string, rather than silently dropping the bad
    // entries. Silently discarding malformed values would let a caller
    // believe every submitted medication was analyzed when some were
    // actually never checked — for an API contract that's a correctness
    // issue, not just cosmetic. The UI itself already only ever sends clean
    // string values, so this only affects direct API callers.
    const invalidEntries = medications.filter(
      (m: unknown) => typeof m !== 'string' || m.trim().length === 0
    );
    if (invalidEntries.length > 0) {
      return NextResponse.json(
        { error: 'Invalid medication input: every entry in "medications" must be a non-empty string' },
        { status: 400 }
      );
    }

    const cleanedMedications: string[] = (medications as string[]).map((m) => m.trim());

    if (cleanedMedications.length === 0) {
      return NextResponse.json({ error: 'At least one non-empty medication name is required' }, { status: 400 });
    }
    if (cleanedMedications.length > MAX_MEDICATIONS) {
      return NextResponse.json(
        { error: `Too many medications (max ${MAX_MEDICATIONS} per analysis)` },
        { status: 400 }
      );
    }

    if (demo) {
      return runDemoAnalysis(cleanedMedications, patientProfile);
    }

    return runLiveAnalysis(cleanedMedications, patientProfile);
  } catch (error: unknown) {
    console.error('[Analyze API Error]', error);
    return NextResponse.json({ error: getErrorMessage(error) || 'Internal Server Error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Live analysis: the full pipeline, run server-side and end-to-end.
// validate -> normalize -> detect duplicates -> retrieve labels ->
// extract evidence -> validate evidence -> aggregate results.
// ---------------------------------------------------------------------------
async function runLiveAnalysis(medications: string[], patientProfile?: PatientProfile) {
  // Step 1: Normalize every entered name in parallel.
  const results: AnalysisResult[] = await Promise.all(
    medications.map(async (name) => {
      const normRes = await resolveNormalization(name);
      return { originalName: name, ...normRes } as AnalysisResult;
    })
  );

  // Step 2: Retrieve labels — deduplicated by generic name so two inputs
  // resolving to the same ingredient share a single openFDA call.
  const labelCache = new Map<string, Promise<Partial<AnalysisResult>>>();
  const getLabelForGeneric = (genericName: string) => {
    const key = genericName.toLowerCase();
    let cached = labelCache.get(key);
    if (!cached) {
      cached = resolveLabel(genericName);
      labelCache.set(key, cached);
    }
    return cached;
  };

  const updatedResults: AnalysisResult[] = await Promise.all(
    results.map(async (res) => {
      if (!res.error && res.genericName) {
        const labelData = await getLabelForGeneric(res.genericName);
        return { ...res, ...labelData };
      }
      return res;
    })
  );

  // Step 3: Duplicate active-ingredient detection (case-insensitive grouping).
  const { genericToOriginalsMap, genericToResultMap } = groupByGenericName(updatedResults);
  const duplicates = buildDuplicateWarnings(genericToOriginalsMap);

  // Step 4: Extract + validate evidence for every drug with a usable label,
  // checked against every OTHER resolved medication (both label directions
  // get checked across the whole run, giving cross-label aggregation for
  // free: A's label is checked for mentions of B, and B's label is
  // separately checked for mentions of A).
  const allGenericNames = Array.from(genericToResultMap.keys());
  const validLabelDrugs = allGenericNames
    .map((g) => genericToResultMap.get(g)!)
    .filter((r) => r.labelState === 'found' && r.labelSections);

  const evidenceItems: ValidatedEdge[] = [];
  const rejections: RejectionLog[] = [];
  let anyExtractionAttempted = false;
  let anyExtractionFailed = false;

  if (validLabelDrugs.length > 0 && allGenericNames.length >= 2) {
    const MAX_CONCURRENT_EXTRACTIONS = 2;

    await runWithConcurrency(validLabelDrugs, MAX_CONCURRENT_EXTRACTIONS, async (targetDrug) => {
      const otherDrugs = allGenericNames.filter(
        (g) => g.toLowerCase() !== targetDrug.genericName!.toLowerCase()
      );
      if (otherDrugs.length === 0) return;

      anyExtractionAttempted = true;
      const extractResult = await runExtraction(targetDrug.genericName!, targetDrug.labelSections!, otherDrugs);

      if (!extractResult.error) {
        const edgesWithSource = extractResult.edges.map((e) => ({ ...e, source_drug: targetDrug.genericName! }));
        evidenceItems.push(...edgesWithSource);
        rejections.push(...extractResult.rejections.map((r) => ({ ...r, source_drug: targetDrug.genericName })));
        targetDrug.extractionState = 'ok';
      } else {
        console.error(`[Analyze] Extract error for ${targetDrug.genericName}:`, extractResult.error);
        targetDrug.extractionState = 'failed';
        anyExtractionFailed = true;
      }
    });
  }

  // Step 5: Aggregate — build the pair graph, coverage stats, and a
  // top-level analysis summary from the actual results (never hardcoded).
  const { edges, stats } = buildGraph(allGenericNames, genericToResultMap, evidenceItems);

  // Never say "completed" unless something was actually checked. Three
  // distinct outcomes, not two:
  //   - no extraction was ever attempted (e.g. no medication resolved to a
  //     usable label, or fewer than 2 resolved medications) -> 'unresolved',
  //     since nothing about this analysis has actually been checked yet.
  //   - at least one extraction ran but one or more failed -> 'partial'.
  //   - everything that could be attempted succeeded -> 'completed'.
  let analysisStatus: AnalysisStatus;
  if (!anyExtractionAttempted) {
    analysisStatus = 'unresolved';
  } else if (anyExtractionFailed) {
    analysisStatus = 'partial';
  } else {
    analysisStatus = 'completed';
  }

  return NextResponse.json({
    results: updatedResults,
    evidenceItems,
    rejections,
    duplicates,
    graph: {
      nodes: allGenericNames.map((g) => ({ id: g, label: g, rxcui: genericToResultMap.get(g)?.rxcui || null })),
      edges,
    },
    stats,
    analysisStatus,
    patientWarnings: buildPatientWarnings(updatedResults, patientProfile),
  });
}

// ---------------------------------------------------------------------------
// Demo analysis: replays captured, pre-validated fixtures instead of calling
// any live API. Unchanged in behavior from before, but now also returns the
// same aggregated graph/stats/duplicates shape as live mode so both modes
// give callers a genuinely complete AnalysisResult.
// ---------------------------------------------------------------------------
async function runDemoAnalysis(medications: string[], patientProfile?: PatientProfile) {
  let demoData: DemoData;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const demoDataPath = path.join(process.cwd(), 'src/app/fixtures/demoData.json');
    const fileContent = fs.readFileSync(demoDataPath, 'utf8');
    demoData = JSON.parse(fileContent) as DemoData;
  } catch (err) {
    console.error('Failed to load demo data:', err);
    return NextResponse.json({ error: 'Demo mode enabled but fixtures not found' }, { status: 500 });
  }

  // Demo fixture names are looked up case-insensitively so "Warfarin",
  // "warfarin", and "WARFARIN" all resolve to the same bundled fixture,
  // matching how a real user is likely to type a demo medication name.
  const normalizeLookup = new Map<string, { originalName: string; genericName?: string }>();
  for (const [key, value] of Object.entries(demoData.normalize || {})) {
    normalizeLookup.set(key.toLowerCase(), value);
  }
  const lookupNormalize = (drug: string) => normalizeLookup.get(drug.trim().toLowerCase());

  const results: AnalysisResult[] = [];
  const combinedItems: ValidatedEdge[] = [];
  const combinedRejections: RejectionLog[] = [];

  // Pre-pass: resolve every entered medication to its generic name first, so
  // we know the FULL patient medication list before validating any
  // relationships.
  const allGenericNamesLower = new Set(
    medications
      .map((drug: string) => lookupNormalize(drug)?.genericName as string | undefined)
      .filter((g?: string): g is string => Boolean(g))
      .map((g: string) => g.toLowerCase())
  );

  for (const drug of medications) {
    const normRes = lookupNormalize(drug);

    if (!normRes) {
      results.push({ originalName: drug, error: 'Not found in demo data' });
      continue;
    }

    const genericName = normRes.genericName;
    if (!genericName) {
      results.push({ originalName: drug, error: 'No generic name' });
      continue;
    }

    const labelRes = demoData.label[genericName];
    if (!labelRes) {
      // Fixture resolves to a generic name, but no source labeling fixture
      // exists for it — this is the "Source unavailable" demo scenario.
      results.push({ originalName: drug, genericName, labelState: 'not_found' });
      continue;
    }

    results.push({
      originalName: drug,
      genericName,
      labelState: labelRes.found ? 'found' : 'not_found',
      labelSections: labelRes.sections,
      labelMeta: labelRes.meta || null,
    });

    if (!labelRes.found || !labelRes.sections) continue;

    const extractRes = demoData.extract[genericName];

    // Fixture explicitly simulates a failed AI extraction call (e.g. a
    // Gemini timeout/error) even though the source label was retrieved —
    // this is the "Extraction unavailable" demo scenario. Mark the result
    // extraction-failed in place so buildGraph() treats every pair
    // involving this drug the same way a real extraction failure would.
    if (extractRes && extractRes.simulateFailure) {
      results[results.length - 1] = { ...results[results.length - 1], extractionState: 'failed' };
      combinedRejections.push({
        reason: extractRes.failureReason || `Simulated extraction failure for ${genericName}`,
        target_drug: genericName,
        source_drug: genericName,
      });
      continue;
    }

    if (!extractRes || !extractRes.rawOutput) continue;

    let parsed: { relationships?: unknown[] } = { relationships: [] };
    try {
      const rawText = extractRes.rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(rawText);
    } catch {
      console.error(`Failed to parse extract for ${genericName} in demo mode`);
      continue;
    }

    for (const rawItem of parsed.relationships || []) {
      if (typeof rawItem !== 'object' || rawItem === null) continue;
      const item = rawItem as { target_drug?: string; other_drug?: string; evidence_quote?: string; plain_language_summary?: string; section_context?: string | null };
      item.target_drug = genericName;
      const otherDrug = (item.other_drug || '').trim();

      if (!otherDrug || !allGenericNamesLower.has(otherDrug.toLowerCase())) {
        combinedRejections.push({
          reason: `Fixture returned other_drug '${otherDrug || '(empty)'}' which is not in the patient's resolved medication list`,
          target_drug: genericName,
          other_drug: otherDrug,
          source_drug: genericName,
        });
        continue;
      }

      const { validated, rejection } = validateEdge(item, labelRes.sections!, otherDrug);

      if (validated) {
        combinedItems.push({ ...validated, source_drug: genericName });
      }
      if (rejection) {
        combinedRejections.push({ ...rejection, source_drug: genericName });
      }
    }
  }

  // Aggregate — same graph/stats/duplicates computation as live mode, so
  // demo mode exercises the exact same aggregation code path.
  const { genericToOriginalsMap, genericToResultMap } = groupByGenericName(results);
  const duplicates = buildDuplicateWarnings(genericToOriginalsMap);

  const allGenericNames = Array.from(genericToResultMap.keys());
  const { edges, stats } = buildGraph(allGenericNames, genericToResultMap, combinedItems);

  // Demo fixtures always resolve fully for the bundled sample medications,
  // but if the caller enters something outside the fixture set we still
  // shouldn't claim "completed" when nothing was actually resolved.
  const analysisStatus: AnalysisStatus = allGenericNames.length >= 2 ? 'completed' : 'unresolved';

  return NextResponse.json({
    results,
    evidenceItems: combinedItems,
    rejections: combinedRejections,
    duplicates,
    graph: {
      nodes: allGenericNames.map((g) => ({ id: g, label: g, rxcui: genericToResultMap.get(g)?.rxcui || null })),
      edges,
    },
    stats,
    analysisStatus,
    patientWarnings: buildPatientWarnings(results, patientProfile),
  });
}

// ---------------------------------------------------------------------------
// Shared aggregation (Phase 4 + Phase 6): builds the pair graph and derives
// coverage/summary numbers from the ACTUAL results, never hardcoded. Used by
// both live and demo analysis so the two modes can never drift apart.
// ---------------------------------------------------------------------------
function buildGraph(
  genericNames: string[],
  genericToResultMap: Map<string, AnalysisResult>,
  evidenceItems: ValidatedEdge[]
) {
  const edges: GraphEdgeData[] = [];
  let signals = 0;
  let noEvidence = 0;
  let unavailable = 0;
  let extractionFailed = 0;

  for (let i = 0; i < genericNames.length; i++) {
    for (let j = i + 1; j < genericNames.length; j++) {
      const nameA = genericNames[i];
      const nameB = genericNames[j];
      const drugA = genericToResultMap.get(nameA)!;
      const drugB = genericToResultMap.get(nameB)!;

      const edgeId = [nameA, nameB].sort().join('-');
      const matchingEdges = evidenceItems.filter(
        (e) =>
          (e.target_drug === nameA && e.other_drug === nameB) ||
          (e.target_drug === nameB && e.other_drug === nameA)
      );

      // Order matters here:
      //   1. A signal always wins — evidence was found.
      //   2. A failed extraction on either side means we tried to check but
      //      couldn't, regardless of what the other side's label state is.
      //   3. Only when BOTH labels were actually retrieved, and extraction
      //      didn't fail, can we call it "no evidence" — that is a
      //      determinate negative, not an unchecked pair.
      //   4. Anything else (one or both labels unavailable) is "unavailable".
      // Previously this branched on "drugA OR drugB has a found label" for
      // no_evidence, which could mark a pair "no evidence" even when the
      // OTHER drug's label was never actually checked. That's fixed here.
      let status: GraphEdgeData['status'];
      if (matchingEdges.length > 0) {
        status = 'signal';
        signals++;
      } else if (drugA.extractionState === 'failed' || drugB.extractionState === 'failed') {
        status = 'extraction_failed';
        extractionFailed++;
      } else if (drugA.labelState === 'found' && drugB.labelState === 'found') {
        status = 'no_evidence';
        noEvidence++;
      } else {
        status = 'unavailable';
        unavailable++;
      }

      edges.push({ id: edgeId, from: nameA, to: nameB, status, evidenceItems: matchingEdges });
    }
  }

  const possiblePairs = (genericNames.length * (genericNames.length - 1)) / 2;
  // "Checked" = pairs with a determinate answer (either a signal was found,
  // or both labels were available and explicitly found no evidence).
  // "Unresolved" = pairs we could not fully check, for either reason.
  const checkedPairs = signals + noEvidence;
  const unresolvedPairs = unavailable + extractionFailed;

  const stats: GraphStats = {
    medicinesCount: genericNames.length,
    possiblePairs,
    checkedPairs,
    unresolvedPairs,
    signals,
    noEvidence,
    unavailable,
    extractionFailed,
  };

  return { edges, stats };
}
