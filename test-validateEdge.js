// Unit test for validateEdge logic

/**
 * Validates an extracted interaction edge against source label sections.
 * 
 * @param {Object} extraction - { target_drug, other_drug, plain_language_summary, evidence_quote }
 * @param {Object} taggedSections - { boxed_warning?: string, warnings?: string, drug_interactions?: string, precautions?: string }
 * @param {string} otherDrugGenericName - Expected name of the other drug
 * @returns {Object|null} Validated edge object with label_section, or null if rejected.
 */
function validateEdge(extraction, taggedSections, otherDrugGenericName) {
  const quote = extraction.evidence_quote;
  if (!quote || typeof quote !== 'string') {
    console.log(`[REJECTED] Missing or invalid evidence_quote for ${otherDrugGenericName}`);
    return null;
  }

  const normalize = (text) => (text || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Check 1: Find which section contains evidence_quote as a verbatim substring
  let foundSection = null;
  for (const [sectionKey, sectionText] of Object.entries(taggedSections)) {
    if (sectionText && typeof sectionText === 'string' && normalize(sectionText).includes(normalize(quote))) {
      foundSection = sectionKey;
      break;
    }
  }

  if (!foundSection) {
    console.log(`[REJECTED] Quote not found in label for target '${extraction.target_drug || 'unknown'}' -> other '${otherDrugGenericName}': "${quote}"`);
    return null;
  }

  // Check 2: Confirm the quote mentions the other drug (case-insensitive match)
  const lowerQuote = quote.toLowerCase();
  const lowerOtherDrug = otherDrugGenericName.toLowerCase();

  if (!lowerQuote.includes(lowerOtherDrug)) {
    console.log(`[REJECTED] Quote exists in section '${foundSection}' but does NOT mention other drug '${otherDrugGenericName}': "${quote}"`);
    return null;
  }

  // Check 3: If section_context is provided, ensure it exists verbatim in the SAME label section
  const sectionContext = extraction.section_context;
  if (sectionContext && typeof sectionContext === 'string' && sectionContext.trim() !== '' && sectionContext.toLowerCase() !== 'null') {
    const matchedSectionText = taggedSections[foundSection];
    
    if (matchedSectionText && typeof matchedSectionText === 'string' && normalize(matchedSectionText).includes(normalize(sectionContext))) {
      // found in the correct section
    } else {
      // Check if it exists in a different section to log the right reason
      let foundAnywhere = false;
      for (const [sectionKey, sectionText] of Object.entries(taggedSections)) {
        if (sectionText && typeof sectionText === 'string' && normalize(sectionText).includes(normalize(sectionContext))) {
          foundAnywhere = true;
          break;
        }
      }
      
      const reason = foundAnywhere ? "section_context found in wrong section" : "section_context not found at all";
      console.log(`[REJECTED] ${reason} for target '${extraction.target_drug || 'unknown'}' -> other '${otherDrugGenericName}': "${sectionContext}"`);
      return null;
    }
  }

  // Validation passed
  return {
    target_drug: extraction.target_drug,
    other_drug: extraction.other_drug || otherDrugGenericName,
    plain_language_summary: extraction.plain_language_summary,
    evidence_quote: quote,
    section_context: sectionContext && sectionContext.toLowerCase() !== 'null' ? sectionContext : null,
    label_section: foundSection,
  };
}

// Sample tagged sections for unit testing
const taggedSections = {
  drug_interactions: "Concomitant use of WARFARIN SODIUM and ASPIRIN may increase the risk of bleeding. Close clinical monitoring is recommended when coadministered.",
  warnings: "Patients taking anticoagulant therapy should exercise caution when taking nonsteroidal anti-inflammatory agents."
};

console.log("--- STARTING validateEdge UNIT TESTS ---\n");

// Test A — fake quote that doesn't exist in the source
console.log("Running Test A (fake quote not in source)...");
const resultA = validateEdge(
  {
    target_drug: "warfarin",
    other_drug: "aspirin",
    plain_language_summary: "Bleeding risk increases when taken together.",
    evidence_quote: "this exact sentence does not appear in the label"
  },
  taggedSections,
  "aspirin"
);
console.log("Test A Output:", resultA);
console.log("Test A Passed:", resultA === null, "\n");

// Test B — real quote that exists but doesn't name the other drug
console.log("Running Test B (real quote, but missing target drug name)...");
const realSentenceWithoutIbuprofen = "Patients taking anticoagulant therapy should exercise caution when taking nonsteroidal anti-inflammatory agents.";
const resultB = validateEdge(
  {
    target_drug: "warfarin",
    other_drug: "ibuprofen",
    plain_language_summary: "Caution needed with anti-inflammatory agents.",
    evidence_quote: realSentenceWithoutIbuprofen
  },
  taggedSections,
  "ibuprofen"
);
console.log("Test B Output:", resultB);
console.log("Test B Passed:", resultB === null, "\n");

console.log("--- validateEdge UNIT TESTS COMPLETE ---");

module.exports = { validateEdge };
