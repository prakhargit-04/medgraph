import { fetchExternal } from './fetchExternal';
import type { LabelSections, LabelMeta } from '../types';

export interface LabelLookupResult {
  found: boolean;
  sections?: LabelSections;
  meta?: LabelMeta;
  reason?: 'no_label_found' | 'timeout' | 'api_error';
}

// Retrieves the openFDA labeling record for a generic ingredient. Shared by
// /api/label (HTTP entry point for direct callers) and /api/analyze (calls
// this in-process, no HTTP round-trip to itself).
export async function fetchLabelForGeneric(genericName: string): Promise<LabelLookupResult> {
  try {
    const query = `openfda.generic_name:"${encodeURIComponent(genericName)}"`;
    const openFdaUrl = `https://api.fda.gov/drug/label.json?search=${query}&limit=1`;
    const response = await fetchExternal(openFdaUrl, { timeoutMs: 8000, retries: 1 });

    if (!response.ok) {
      if (response.status === 404) {
        return { found: false, reason: 'no_label_found' };
      }
      throw new Error(`openFDA API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      return { found: false, reason: 'no_label_found' };
    }

    const result = data.results[0];
    const sections: LabelSections = {
      boxed_warning: result.boxed_warning ? result.boxed_warning[0] : null,
      warnings: result.warnings ? result.warnings[0] : null,
      drug_interactions: result.drug_interactions ? result.drug_interactions[0] : null,
      precautions: result.precautions ? result.precautions[0] : null,
    };

    // Source metadata: lets the UI and the exported report say exactly which
    // labeling record evidence came from, not just "openFDA said so".
    // openfda.* fields are arrays when present and simply absent otherwise —
    // never assume any of them exist.
    const openfda = result.openfda || {};
    const meta: LabelMeta = {
      manufacturerName: Array.isArray(openfda.manufacturer_name) ? openfda.manufacturer_name[0] : null,
      applicationNumber: Array.isArray(openfda.application_number) ? openfda.application_number[0] : null,
      effectiveTime: typeof result.effective_time === 'string' ? result.effective_time : null,
      setId: typeof result.id === 'string' ? result.id : null,
      brandName: Array.isArray(openfda.brand_name) ? openfda.brand_name[0] : null,
    };

    return { found: true, sections, meta };
  } catch (error: any) {
    const isTimeout = String(error?.message || '').includes('timed out');
    return { found: false, reason: isTimeout ? 'timeout' : 'api_error' };
  }
}
