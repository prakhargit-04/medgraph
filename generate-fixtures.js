const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY || (() => {
  try {
    const content = fs.readFileSync('.env.local', 'utf-8');
    const match = content.match(/GEMINI_API_KEY=(.*)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    return null;
  }
})();

if (!apiKey) {
  console.error("No API key");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

function localValidateEdge(extraction, taggedSections, otherDrugGenericName) {
  const quote = extraction.evidence_quote;
  const targetDrug = extraction.target_drug || '';
  const otherDrug = extraction.other_drug || otherDrugGenericName;

  if (!quote || typeof quote !== 'string') {
    return { validated: null, rejection: { reason: "Missing quote", target_drug: targetDrug, other_drug: otherDrug } };
  }
  const normalize = (text) => (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let foundSection = null;
  for (const [sectionKey, sectionText] of Object.entries(taggedSections)) {
    if (sectionText && typeof sectionText === 'string' && normalize(sectionText).includes(normalize(quote))) {
      foundSection = sectionKey; break;
    }
  }
  if (!foundSection) return { validated: null, rejection: { reason: "Quote not found in label", target_drug: targetDrug, other_drug: otherDrug, quote } };
  if (!quote.toLowerCase().includes(otherDrug.toLowerCase())) return { validated: null, rejection: { reason: "Quote does not mention other drug", target_drug: targetDrug, other_drug: otherDrug, quote } };
  
  const sectionContext = extraction.section_context;
  if (sectionContext && sectionContext.trim() !== '' && sectionContext.toLowerCase() !== 'null') {
    const matchedSectionText = taggedSections[foundSection];
    if (!(matchedSectionText && normalize(matchedSectionText).includes(normalize(sectionContext)))) {
        return { validated: null, rejection: { reason: "section_context not found in correct section", target_drug: targetDrug, other_drug: otherDrug, quote, section_context: sectionContext } };
    }
  }

  return { validated: {
    source_drug: targetDrug,
    target_drug: targetDrug,
    other_drug: otherDrug,
    plain_language_summary: extraction.plain_language_summary || '',
    evidence_quote: quote,
    section_context: sectionContext && sectionContext.toLowerCase() !== 'null' ? sectionContext : null,
    label_section: foundSection
  }, rejection: null };
}

function cleanJsonString(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

async function fetchNormalize(drug) {
    const res = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drug)}`);
    const rxcuiData = await res.json();
    const rxnormId = rxcuiData.idGroup?.rxnormId;
    if (!rxnormId || rxnormId.length === 0) return { originalName: drug, genericName: null, error: 'Not found' };
    const rxcui = rxnormId[0];
    const relRes = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`);
    const relatedData = await relRes.json();
    const conceptGroup = relatedData.allRelatedGroup?.conceptGroup || [];
    const ingredientGroup = conceptGroup.find((group) => group.tty === 'IN' || group.tty === 'MIN');
    if (ingredientGroup && ingredientGroup.conceptProperties && ingredientGroup.conceptProperties.length > 0) {
      return { originalName: drug, genericName: ingredientGroup.conceptProperties[0].name.toLowerCase() };
    }
    return { originalName: drug, genericName: null, error: 'No generic ingredient' };
}

async function fetchLabel(genericName) {
    const query = `openfda.generic_name:"${encodeURIComponent(genericName)}"`;
    const openFdaUrl = `https://api.fda.gov/drug/label.json?search=${query}&limit=1`;
    const response = await fetch(openFdaUrl);
    if (!response.ok) return { genericName, found: false };
    const data = await response.json();
    if (!data.results || data.results.length === 0) return { genericName, found: false };
    const result = data.results[0];
    const sections = {
      boxed_warning: result.boxed_warning ? result.boxed_warning[0] : null,
      warnings: result.warnings ? result.warnings[0] : null,
      drug_interactions: result.drug_interactions ? result.drug_interactions[0] : null,
      precautions: result.precautions ? result.precautions[0] : null
    };
    return { genericName, found: true, sections };
}

async function extractGemini(drugName, otherDrugs, labelSections) {
    const sectionKeys = { boxed_warning: 'BOXED_WARNING', warnings: 'WARNINGS', drug_interactions: 'DRUG_INTERACTIONS', precautions: 'PRECAUTIONS' };
    const taggedBlocks = [];
    for (const [key, tag] of Object.entries(sectionKeys)) {
      const text = labelSections[key];
      if (text && typeof text === 'string' && text.trim().length > 0) taggedBlocks.push(`[${tag}]\n${text.trim()}`);
    }
    if (taggedBlocks.length === 0) return { rawOutput: '{}' };
    const taggedText = taggedBlocks.join('\n\n');

    const prompt = `You are analyzing an official FDA drug label to identify EXPLICIT mentions of a specific list of other medications. You are analyzing the label for: ${drugName}.
The list of other medications to look for: ${otherDrugs.join(', ')}.

Below is the text of the drug label, organized by section:
${taggedText}

Instructions:
1. Search the label text ONLY for explicit mentions of the drugs in the target list above.
2. For each drug in the target list that is EXPLICITLY mentioned in the label text:
   - Extract a verbatim quote from the label text that mentions the drug and describes the interaction or warning.
   - IMPORTANT: Your evidence_quote must be ONE truly continuous span exactly as it appears in the source, with nothing skipped or removed from the middle. If the relevant mention is inside a flattened table row, quote ONLY that row — the category label and the drug list containing the target drug — not the surrounding sentence or unrelated rows. A short, exact quote is strongly preferred over a longer one that risks combining separate parts of the text.
   - In addition to evidence_quote, also identify section_context: the nearest heading or introductory label in the source text that gives this row its meaning. This must ALSO be copied verbatim from the source text. If no clear heading exists nearby, return section_context as null — do not invent one.
   - Provide a concise, plain-language summary of what the label says about taking ${drugName} with that drug. Your plain_language_summary must be grounded in evidence_quote AND section_context TOGETHER.
3. If a drug from the target list is NOT explicitly mentioned in the label text, DO NOT include it in your output.
4. Do not infer, assume, or generalize.

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

    const response = await ai.models.generateContent({ model: 'gemini-3.6-flash', contents: prompt });
    return { rawOutput: response.text || '' };
}

async function run() {
    const drugs = ["warfarin", "aspirin", "ibuprofen"];
    const fixtures = { normalize: {}, label: {}, extract: {} };
    const normalized = {};

    for (const d of drugs) {
        console.log(`Normalizing ${d}...`);
        const res = await fetchNormalize(d);
        fixtures.normalize[d] = res;
        if (res.genericName) normalized[d] = res.genericName;
    }

    const labels = {};
    for (const [orig, gen] of Object.entries(normalized)) {
        console.log(`Fetching label for ${gen}...`);
        const res = await fetchLabel(gen);
        fixtures.label[gen] = res;
        if (res.found) labels[gen] = res.sections;
    }

    const combinedItems = [];
    const combinedRejections = [];

    for (const [orig, gen] of Object.entries(normalized)) {
        if (!labels[gen]) continue;
        const otherDrugs = Object.values(normalized).filter(g => g !== gen);
        console.log(`Extracting for ${gen} against ${otherDrugs.join(', ')}...`);
        const extractRes = await extractGemini(gen, otherDrugs, labels[gen]);
        fixtures.extract[gen] = extractRes;
        
        let parsed = { relationships: [] };
        try {
            parsed = JSON.parse(cleanJsonString(extractRes.rawOutput));
        } catch(e) {
            console.error(`Failed to parse extract for ${gen}`);
        }

        for (let item of (parsed.relationships || [])) {
            item.target_drug = gen;
            const validation = localValidateEdge(item, labels[gen], item.other_drug);
            if (validation.validated) {
                combinedItems.push(validation.validated);
            }
            if (validation.rejection) {
                combinedRejections.push(validation.rejection);
            }
        }
    }

    const finalOutput = {
        evidenceItems: combinedItems,
        rejections: combinedRejections
    };

    fs.mkdirSync('src/app/fixtures', { recursive: true });
    fs.writeFileSync('src/app/fixtures/demoData.json', JSON.stringify(fixtures, null, 2));
    console.log("Wrote src/app/fixtures/demoData.json");
    
    fs.writeFileSync('raw_combined.json', JSON.stringify(finalOutput, null, 2));
    console.log("Wrote raw_combined.json");
}

run();
