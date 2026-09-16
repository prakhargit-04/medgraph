// Shared extraction + validation logic (Phase 5 cleanup): this used to live
// directly in the /api/extract route file, with /api/analyze importing it
// from there — treating an API route as a reusable library. It now lives
// here as an ordinary module, imported by both /api/extract's route handler
// and /api/analyze, so there is exactly one implementation either way.
import { GoogleGenAI } from '@google/genai';
import { getErrorMessage } from './errors';

export interface ExtractedEdge {
  target_drug: string;
  other_drug: string;
  plain_language_summary: string;
  evidence_quote: string;
  section_context?: string | null;
  label_section?: string;
}

export interface RejectionLog {
  reason: string;
  target_drug?: string;
  other_drug?: string;
  source_drug?: string;
  quote?: string;
  section_context?: string | null;
  section?: string;
}

export interface ExtractResponse {
  targetDrug: string;
  edges: ExtractedEdge[];
  rejections: RejectionLog[];
  error?: string;
}

function cleanJsonString(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

// Minimal runtime schema check for one relationship object returned by
// Gemini. Returns a short human-readable reason if the shape is invalid, or
// null if it's OK to proceed to quote validation. Deliberately not a full
// schema library — just the field presence/type checks that matter for
// safely using the value downstream (string interpolation, .trim(), etc.).
function getRelationshipShapeError(item: unknown): string | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return 'relationship item is not an object';
  }
  const obj = item as Record<string, unknown>;

  if (typeof obj.other_drug !== 'string' || obj.other_drug.trim() === '') {
    return 'other_drug must be a non-empty string';
  }
  if (typeof obj.evidence_quote !== 'string' || obj.evidence_quote.trim() === '') {
    return 'evidence_quote must be a non-empty string';
  }
  if (obj.plain_language_summary !== undefined && typeof obj.plain_language_summary !== 'string') {
    return 'plain_language_summary must be a string when present';
  }
  if (
    obj.section_context !== undefined &&
    obj.section_context !== null &&
    typeof obj.section_context !== 'string'
  ) {
    return 'section_context must be a string or null when present';
  }
  return null;
}

// Best-effort local salvage of a JSON object embedded in extra text/prose,
// without spending another Gemini call. Used before we give up on parsing.
// Returns `unknown` — the caller performs its own top-level shape check
// before trusting the result as an extraction response.
function salvageJson(rawText: string): unknown | null {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = rawText.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

// Classifies whether an error is worth retrying with another model.
// Non-retryable errors (bad request, missing/invalid key, invalid argument)
// will fail again on every model, so we don't waste time cycling through them.
function isRetryableError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')) return true;
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('unavailable')) return true;
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return true;
  if (msg.includes('econnreset') || msg.includes('network') || msg.includes('fetch failed')) return true;
  // 400 invalid_argument / permission_denied / unauthenticated => not retryable
  if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('invalid_argument') || msg.includes('permission_denied') || msg.includes('unauthenticated') || msg.includes('api key')) return false;
  // Unknown errors: allow one retry on the fallback model, better safe than stuck.
  return true;
}

// Races a promise against a hard timeout so one slow Gemini call can't consume
// the entire request budget. Doesn't cancel the underlying request, just stops waiting on it.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export function validateEdge(
  extraction: { target_drug?: string; other_drug?: string; plain_language_summary?: string; evidence_quote?: string; section_context?: string | null },
  taggedSections: Record<string, string | null | undefined>,
  otherDrugGenericName: string
): { validated: ExtractedEdge | null; rejection: RejectionLog | null } {
  const quote = extraction.evidence_quote;
  const targetDrug = extraction.target_drug || '';
  const otherDrug = extraction.other_drug || otherDrugGenericName;

  if (!quote || typeof quote !== 'string') {
    const rejection: RejectionLog = {
      reason: `Missing or invalid evidence_quote for other drug '${otherDrugGenericName}'`,
      target_drug: targetDrug,
      other_drug: otherDrugGenericName,
    };
    console.log(`[validateEdge REJECTED] ${rejection.reason}`);
    return { validated: null, rejection };
  }

  const normalize = (text: string) => (text || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Check 1: Ensure evidence_quote exists verbatim in one of the label sections
  let foundSection: string | null = null;
  for (const [sectionKey, sectionText] of Object.entries(taggedSections)) {
    if (sectionText && typeof sectionText === 'string' && normalize(sectionText).includes(normalize(quote))) {
      foundSection = sectionKey;
      break;
    }
  }

  if (!foundSection) {
    const rejection: RejectionLog = {
      reason: `Quote not found in label for target '${targetDrug}' -> other '${otherDrugGenericName}'`,
      target_drug: targetDrug,
      other_drug: otherDrugGenericName,
      quote,
    };
    console.log(`[validateEdge REJECTED] ${rejection.reason}: "${quote}"`);
    return { validated: null, rejection };
  }

  // Check 2: Ensure the quote itself names the other drug (case-insensitive)
  const lowerQuote = quote.toLowerCase();
  const lowerOtherDrug = otherDrugGenericName.toLowerCase();

  if (!lowerQuote.includes(lowerOtherDrug)) {
    const rejection: RejectionLog = {
      reason: `Quote exists in section '${foundSection}' but does NOT mention other drug '${otherDrugGenericName}'`,
      target_drug: targetDrug,
      other_drug: otherDrugGenericName,
      quote,
      section: foundSection,
    };
    console.log(`[validateEdge REJECTED] ${rejection.reason}: "${quote}"`);
    return { validated: null, rejection };
  }

  // Check 3: If section_context is provided, ensure it exists verbatim in the SAME label section
  const sectionContext = extraction.section_context;
  if (sectionContext && typeof sectionContext === 'string' && sectionContext.trim() !== '' && sectionContext.toLowerCase() !== 'null') {
    const matchedSectionText = taggedSections[foundSection];

    if (matchedSectionText && typeof matchedSectionText === 'string' && normalize(matchedSectionText).includes(normalize(sectionContext))) {
      // found in the correct section
    } else {
      let foundAnywhere = false;
      for (const sectionText of Object.values(taggedSections)) {
        if (sectionText && typeof sectionText === 'string' && normalize(sectionText).includes(normalize(sectionContext))) {
          foundAnywhere = true;
          break;
        }
      }

      const reasonStr = foundAnywhere ? "section_context found in wrong section" : "section_context not found at all";
      const rejection: RejectionLog = {
        reason: `${reasonStr} for target '${targetDrug}' -> other '${otherDrugGenericName}'`,
        target_drug: targetDrug,
        other_drug: otherDrugGenericName,
        quote,
        section_context: sectionContext,
      };
      console.log(`[validateEdge REJECTED] ${rejection.reason}: "${sectionContext}"`);
      return { validated: null, rejection };
    }
  }

  // Passed all checks
  const validatedEdge: ExtractedEdge = {
    target_drug: targetDrug,
    other_drug: otherDrug,
    plain_language_summary: extraction.plain_language_summary || '',
    evidence_quote: quote,
    section_context: sectionContext && sectionContext.toLowerCase() !== 'null' ? sectionContext : null,
    label_section: foundSection,
  };

  console.log(`[validateEdge ACCEPTED] target '${targetDrug}' -> other '${otherDrug}' in section '${foundSection}'`);
  return { validated: validatedEdge, rejection: null };
}

// Core extraction logic, factored out of the POST handler so it can be
// called in-process by other server-side code (e.g. /api/analyze) without
// making an HTTP round-trip to itself. Returns a plain result object with an
// httpStatus for the route handler to use; callers that just want the data
// (like /api/analyze) can ignore httpStatus and inspect `error` instead.
export async function runExtraction(
  drugName: string,
  labelSections: Record<string, string | null | undefined>,
  otherDrugs: string[]
): Promise<ExtractResponse & { httpStatus: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      targetDrug: drugName,
      edges: [],
      rejections: [],
      error: 'GEMINI_API_KEY is not configured in server environment (.env.local)',
      httpStatus: 500,
    };
  }

  if (!drugName || typeof drugName !== 'string') {
    return { targetDrug: drugName, edges: [], rejections: [], error: 'drugName is required', httpStatus: 400 };
  }

  if (!otherDrugs || !Array.isArray(otherDrugs) || otherDrugs.length === 0) {
    return { targetDrug: drugName, edges: [], rejections: [], httpStatus: 200 };
  }

  if (!labelSections || typeof labelSections !== 'object') {
    return { targetDrug: drugName, edges: [], rejections: [], httpStatus: 200 };
  }

  // Tagged sections mapping
  const sectionKeys: Record<string, string> = {
    boxed_warning: 'BOXED_WARNING',
    warnings: 'WARNINGS',
    drug_interactions: 'DRUG_INTERACTIONS',
    precautions: 'PRECAUTIONS',
  };

  const taggedBlocks: string[] = [];
  for (const [key, tag] of Object.entries(sectionKeys)) {
    const text = labelSections[key];
    if (text && typeof text === 'string' && text.trim().length > 0) {
      taggedBlocks.push(`[${tag}]\n${text.trim()}`);
    }
  }

  if (taggedBlocks.length === 0) {
    return { targetDrug: drugName, edges: [], rejections: [], httpStatus: 200 };
  }

  const taggedText = taggedBlocks.join('\n\n');

  const prompt = `You are analyzing FDA-submitted drug labeling retrieved through openFDA to identify EXPLICIT mentions of a specific list of other medications. You are analyzing the label for: ${drugName}.
The list of other medications to look for: ${otherDrugs.join(', ')}.

Below is the text of the drug label, organized by section:
${taggedText}

Instructions:
1. Search the label text ONLY for explicit mentions of the drugs in the target list above.
2. For each drug in the target list that is EXPLICITLY mentioned in the label text:
   - Extract a verbatim quote from the label text that mentions the drug and describes the interaction or warning.
   - IMPORTANT: Some label sections contain table data that has been flattened into continuous text, with table headers and rows running together with no line breaks. When this happens, do NOT stitch together separate, non-adjacent parts of the text into one quote — for example, do not combine an introductory sentence with a table row found elsewhere in the text while skipping the rows in between. Your evidence_quote must be ONE truly continuous span exactly as it appears in the source, with nothing skipped or removed from the middle. If the relevant mention is inside a flattened table row, quote ONLY that row — the category label and the drug list containing the target drug — not the surrounding sentence or unrelated rows. A short, exact quote is strongly preferred over a longer one that risks combining separate parts of the text.
   - In addition to evidence_quote, also identify section_context: the nearest heading or introductory label in the source text that gives this row its meaning (e.g., a table title like 'Table 3: Drugs that Can Increase the Risk of Bleeding', or a numbered subsection heading like '7.3 Drugs that Increase Bleeding Risk'). This must ALSO be copied verbatim from the source text — same rule as evidence_quote, just a different, shorter span. If no clear heading exists nearby, return section_context as null — do not invent one.
   - Provide a concise, plain-language summary of what the label says about taking ${drugName} with that drug. Your plain_language_summary must be grounded in evidence_quote AND section_context TOGETHER, and must not state anything beyond what those two pieces combined actually support. If section_context is null, the summary must be grounded in evidence_quote ALONE — in that case, do not add claims like 'increases bleeding risk' unless that specific claim is literally present in evidence_quote itself.
3. If a drug from the target list is NOT explicitly mentioned in the label text, DO NOT include it in your output.
4. Do not infer, assume, or generalize (e.g. if the label mentions 'NSAIDs', do not claim it explicitly mentions 'ibuprofen' unless the word 'ibuprofen' actually appears in the text).

Return your response strictly as a JSON object with this structure:
{
  "drug_checked": "${drugName}",
  "relationships": [
    {
      "other_drug": "<name of drug from target list>",
      "evidence_quote": "<verbatim quote from label text>",
      "section_context": "<verbatim heading/intro or null>",
      "plain_language_summary": "<concise summary>"
    }
  ]
}

Do not include any explanation or markdown formatting outside the JSON object.`;

  // Controlled cascade: one primary model, one fallback. A 4-model cascade
  // gives four sequential chances for a single extraction call to run long,
  // which is what was blowing through the frontend timeout. Two is enough
  // for hackathon-grade reliability without that risk.
  const candidateModels = ['gemini-3.5-flash', 'gemini-flash-latest'];
  const PER_MODEL_TIMEOUT_MS = 10000; // budget: 2 models * 10s = 20s worst case, under the 25s frontend timeout

  try {
    const ai = new GoogleGenAI({ apiKey });

    let rawOutput = '';
    let lastError: unknown = null;

    for (const model of candidateModels) {
      try {
        console.log(`[Extract Attempt] Generating content with model: ${model}`);
        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          PER_MODEL_TIMEOUT_MS,
          `Gemini model ${model}`
        );
        rawOutput = response.text || '';
        // Deliberately not logging the raw model output here — it can
        // contain the full label text plus the model's response, which is
        // too large/verbose for production logs. Log shape, not content.
        console.log(`[Extract] ${model} responded (${rawOutput.length} chars)`);
        break; // Successfully generated content!
      } catch (err: unknown) {
        lastError = err;
        const retryable = isRetryableError(err);
        console.warn(`[Model ${model} failed - retryable: ${retryable}]`, getErrorMessage(err));
        if (!retryable) break; // No point cycling through models for a non-retryable error (bad request, bad key, etc.)
        // Otherwise continue to next candidate model
      }
    }

    if (!rawOutput) {
      console.error('[All Gemini Models Exhausted/Failed]', lastError);
      const isRateLimit = getErrorMessage(lastError).toLowerCase().includes('429');
      const userFriendlyMsg = isRateLimit
        ? 'Gemini AI service is temporarily rate-limited across free-tier quotas. Please wait a moment and try again.'
        : 'Failed to analyze interactions with Gemini AI.';
      return { targetDrug: drugName, edges: [], rejections: [], error: userFriendlyMsg, httpStatus: isRateLimit ? 429 : 500 };
    }

    // Top-level shape validation: `{ relationships: [...] }` is the only
    // structure we trust. A response that parses as JSON but isn't shaped
    // like that (not an object, or `relationships` missing/not an array) is
    // extraction-unavailable, NOT "zero relationships found" — those are
    // different claims, and treating malformed output as a clean empty
    // result would silently manufacture a "no evidence" answer from data
    // that was never actually validated.
    const cleanedText = cleanJsonString(rawOutput);
    let parsedObj: unknown = null;

    try {
      parsedObj = JSON.parse(cleanedText);
    } catch (parseError) {
      // Don't spend another full Gemini round-trip just to repair malformed JSON —
      // try a local salvage (strip stray prose around the {...} block) first.
      console.warn('[Gemini Response JSON parse failed, attempting local salvage]', parseError);
      parsedObj = salvageJson(rawOutput);
    }

    const relationships =
      typeof parsedObj === 'object' && parsedObj !== null && !Array.isArray(parsedObj)
        ? (parsedObj as Record<string, unknown>).relationships
        : undefined;

    if (!Array.isArray(relationships)) {
      console.error('[Gemini top-level shape invalid — treating as extraction unavailable]', {
        hadParsedObject: parsedObj !== null,
      });
      return {
        targetDrug: drugName,
        edges: [],
        rejections: [],
        error: 'Gemini extraction response was not a valid { relationships: [...] } object',
        httpStatus: 500,
      };
    }

    const parsedExtractions: unknown[] = relationships;

    const otherDrugsLower = new Set(otherDrugs.map((d: string) => d.toLowerCase().trim()));
    const validatedEdges: ExtractedEdge[] = [];
    const rejections: RejectionLog[] = [];

    for (const item of parsedExtractions) {
      // Runtime schema check: Gemini's output is untrusted JSON, not a typed
      // object. Reject anything that isn't a plain object with the expected
      // string-typed fields before it reaches quote validation, rather than
      // letting a malformed shape (e.g. other_drug: 123, evidence_quote: true)
      // silently coerce into a string via template interpolation downstream.
      const shapeError = getRelationshipShapeError(item);
      if (shapeError) {
        const rawOtherDrug =
          typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).other_drug === 'string'
            ? ((item as Record<string, unknown>).other_drug as string)
            : undefined;
        rejections.push({
          reason: `Gemini relationship item failed schema validation: ${shapeError}`,
          target_drug: drugName,
          other_drug: rawOtherDrug,
        });
        continue;
      }

      // Past this point, getRelationshipShapeError has already confirmed
      // `item` is a plain object with string-typed other_drug/evidence_quote
      // (and, when present, string plain_language_summary / section_context).
      const relationshipItem = item as {
        target_drug?: string;
        other_drug: string;
        evidence_quote: string;
        plain_language_summary?: string;
        section_context?: string | null;
      };
      relationshipItem.target_drug = drugName;
      const otherDrug = (relationshipItem.other_drug || '').trim();

      // Membership check: Gemini was given a closed list of other medications to
      // check against. If it returns a relationship for a drug NOT in that list
      // (e.g. a hallucinated name, or one that happens to appear in the label
      // text for an unrelated reason), reject it before it ever reaches quote
      // validation — otherwise a drug not even in the patient's list could show
      // up as a graph edge.
      if (!otherDrug || !otherDrugsLower.has(otherDrug.toLowerCase())) {
        const rejection: RejectionLog = {
          reason: `Gemini returned other_drug '${otherDrug || '(empty)'}' which is not in the requested medication list [${otherDrugs.join(', ')}]`,
          target_drug: drugName,
          other_drug: otherDrug,
        };
        console.log(`[validateEdge REJECTED] ${rejection.reason}`);
        rejections.push(rejection);
        continue;
      }

      const { validated, rejection } = validateEdge(relationshipItem, labelSections, otherDrug);
      if (validated) {
        validatedEdges.push(validated);
      }
      if (rejection) {
        rejections.push(rejection);
      }
    }

    return {
      targetDrug: drugName,
      edges: validatedEdges,
      rejections,
      httpStatus: 200,
    };
  } catch (error: unknown) {
    console.error('[Extract API Fatal Error]', error);
    return { targetDrug: drugName, edges: [], rejections: [], error: getErrorMessage(error) || 'Internal Server Error', httpStatus: 500 };
  }
}