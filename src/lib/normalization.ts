import { fetchExternal } from './fetchExternal';

export interface NormalizeResult {
  originalName: string;
  rxcui?: string;
  genericName?: string;
  error?: string;
  // Distinguishes WHY normalization failed, so callers (like the /api/normalize
  // route) can map it to the right HTTP status without re-deriving the reason
  // from the error string.
  notFoundReason?: 'rxnorm_not_found' | 'no_ingredient';
}

// Resolves an entered drug name to its RxNorm generic ingredient (IN/MIN).
// Shared by /api/normalize (HTTP entry point for direct callers) and
// /api/analyze (calls this in-process, no HTTP round-trip to itself).
export async function normalizeDrug(name: string): Promise<NormalizeResult> {
  try {
    const rxcuiResponse = await fetchExternal(
      `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(name)}`,
      { timeoutMs: 8000, retries: 1 }
    );
    if (!rxcuiResponse.ok) {
      throw new Error(`RxNorm API error: ${rxcuiResponse.status}`);
    }
    const rxcuiData = await rxcuiResponse.json();
    const rxnormId = rxcuiData.idGroup?.rxnormId;

    if (!rxnormId || rxnormId.length === 0) {
      return { originalName: name, error: 'Drug not found in RxNorm database', notFoundReason: 'rxnorm_not_found' };
    }
    const rxcui = rxnormId[0];

    const relatedResponse = await fetchExternal(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`,
      { timeoutMs: 8000, retries: 1 }
    );
    if (!relatedResponse.ok) {
      throw new Error(`RxNorm related API error: ${relatedResponse.status}`);
    }
    const relatedData = await relatedResponse.json();

    const conceptGroup = relatedData.allRelatedGroup?.conceptGroup || [];
    const ingredientGroup = conceptGroup.find((group: any) => group.tty === 'IN' || group.tty === 'MIN');

    if (!ingredientGroup || !ingredientGroup.conceptProperties || ingredientGroup.conceptProperties.length === 0) {
      return { originalName: name, rxcui, error: 'No generic ingredient (IN/MIN) found for this drug', notFoundReason: 'no_ingredient' };
    }

    const genericName = ingredientGroup.conceptProperties[0].name;
    return { originalName: name, rxcui, genericName };
  } catch (error: any) {
    const isTimeout = String(error?.message || '').includes('timed out');
    return {
      originalName: name,
      error: isTimeout ? error.message : 'Internal error while normalizing drug name',
    };
  }
}
