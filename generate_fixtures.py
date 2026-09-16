import urllib.request
import urllib.parse
import json
import os
import re

def get_api_key():
    if 'GEMINI_API_KEY' in os.environ and os.environ['GEMINI_API_KEY'].strip():
        return os.environ['GEMINI_API_KEY']
    try:
        with open('.env.local', 'r') as f:
            content = f.read()
            match = re.search(r'GEMINI_API_KEY=(.*)', content)
            if match:
                return match.group(1).strip()
    except:
        pass
    return None

API_KEY = get_api_key()

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def fetch_post_json(url, data):
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"Error posting to {url}: {e.code} - {e.read().decode('utf-8')}")
        return None
    except Exception as e:
        print(f"Error posting to {url}: {e}")
        return None

def normalize(drug):
    url = f"https://rxnav.nlm.nih.gov/REST/rxcui.json?name={urllib.parse.quote(drug)}"
    data = fetch_json(url)
    if not data or not data.get('idGroup') or not data['idGroup'].get('rxnormId'):
        return {'originalName': drug, 'genericName': None}
    rxcui = data['idGroup']['rxnormId'][0]
    rel_url = f"https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/allrelated.json"
    rel_data = fetch_json(rel_url)
    if not rel_data:
        return {'originalName': drug, 'genericName': None}
    concept_group = rel_data.get('allRelatedGroup', {}).get('conceptGroup', [])
    for group in concept_group:
        if group.get('tty') in ['IN', 'MIN']:
            props = group.get('conceptProperties', [])
            if props:
                return {'originalName': drug, 'genericName': props[0]['name'].lower()}
    return {'originalName': drug, 'genericName': None}

def label(generic_name):
    query = f'openfda.generic_name:"{urllib.parse.quote(generic_name)}"'
    url = f"https://api.fda.gov/drug/label.json?search={query}&limit=1"
    data = fetch_json(url)
    if not data or not data.get('results'):
        return {'genericName': generic_name, 'found': False}
    result = data['results'][0]
    sections = {
        'boxed_warning': result.get('boxed_warning', [None])[0],
        'warnings': result.get('warnings', [None])[0],
        'drug_interactions': result.get('drug_interactions', [None])[0],
        'precautions': result.get('precautions', [None])[0]
    }
    return {'genericName': generic_name, 'found': True, 'sections': sections}

def extract_gemini(drug_name, other_drugs, label_sections):
    if not API_KEY:
        print("Cannot run extract_gemini without GEMINI_API_KEY")
        return {'rawOutput': '{}'}

    section_keys = {
        'boxed_warning': 'BOXED_WARNING',
        'warnings': 'WARNINGS',
        'drug_interactions': 'DRUG_INTERACTIONS',
        'precautions': 'PRECAUTIONS'
    }
    tagged_blocks = []
    for key, tag in section_keys.items():
        text = label_sections.get(key)
        if text and text.strip():
            tagged_blocks.append(f"[{tag}]\n{text.strip()}")
    
    if not tagged_blocks:
        return {'rawOutput': '{}'}
    
    tagged_text = "\n\n".join(tagged_blocks)
    prompt = f"""You are analyzing an official FDA drug label to identify EXPLICIT mentions of a specific list of other medications. You are analyzing the label for: {drug_name}.
The list of other medications to look for: {', '.join(other_drugs)}.

Below is the text of the drug label, organized by section:
{tagged_text}

Instructions:
1. Search the label text ONLY for explicit mentions of the drugs in the target list above.
2. For each drug in the target list that is EXPLICITLY mentioned in the label text:
   - Extract a verbatim quote from the label text that mentions the drug and describes the interaction or warning.
   - IMPORTANT: Your evidence_quote must be ONE truly continuous span exactly as it appears in the source, with nothing skipped or removed from the middle. If the relevant mention is inside a flattened table row, quote ONLY that row — the category label and the drug list containing the target drug — not the surrounding sentence or unrelated rows. A short, exact quote is strongly preferred over a longer one that risks combining separate parts of the text.
   - In addition to evidence_quote, also identify section_context: the nearest heading or introductory label in the source text that gives this row its meaning. This must ALSO be copied verbatim from the source text. If no clear heading exists nearby, return section_context as null — do not invent one.
   - Provide a concise, plain-language summary of what the label says about taking {drug_name} with that drug. Your plain_language_summary must be grounded in evidence_quote AND section_context TOGETHER.
3. If a drug from the target list is NOT explicitly mentioned in the label text, DO NOT include it in your output.
4. Do not infer, assume, or generalize.

Return your response strictly as a JSON object with this structure:
{{
  "drug_checked": "{drug_name}",
  "relationships": [
    {{
      "other_drug": "<name of drug from target list>",
      "evidence_quote": "<verbatim quote from label text>",
      "section_context": "<verbatim heading/intro or null>",
      "plain_language_summary": "<concise summary>"
    }}
  ]
}}

Do not include any explanation or markdown formatting outside the JSON object."""
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={API_KEY}"
    data = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    res = fetch_post_json(url, data)
    if not res:
        return {'rawOutput': '{}'}
    try:
        raw_output = res['candidates'][0]['content']['parts'][0]['text']
        return {'rawOutput': raw_output}
    except Exception as e:
        print(f"Failed to parse gemini response: {e}")
        return {'rawOutput': '{}'}

def clean_json_string(raw_text):
    cleaned = raw_text.strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s*```$', '', cleaned)
    return cleaned.strip()

def validate_edge(extraction, tagged_sections, other_drug_generic_name):
    quote = extraction.get('evidence_quote')
    target_drug = extraction.get('target_drug', '')
    other_drug = extraction.get('other_drug') or other_drug_generic_name
    
    if not quote or not isinstance(quote, str):
        return None, {"reason": "Missing quote", "target_drug": target_drug, "other_drug": other_drug}
    
    def normalize_text(text):
        if not text: return ""
        return re.sub(r'\s+', ' ', text.lower()).strip()
    
    found_section = None
    for k, v in tagged_sections.items():
        if v and isinstance(v, str) and normalize_text(quote) in normalize_text(v):
            found_section = k
            break
            
    if not found_section:
        return None, {"reason": "Quote not found in label", "target_drug": target_drug, "other_drug": other_drug, "quote": quote}
        
    if other_drug.lower() not in quote.lower():
        return None, {"reason": "Quote does not mention other drug", "target_drug": target_drug, "other_drug": other_drug, "quote": quote}
        
    section_context = extraction.get('section_context')
    if section_context and str(section_context).strip() and str(section_context).lower() != 'null':
        matched_section_text = tagged_sections[found_section]
        if not (matched_section_text and normalize_text(section_context) in normalize_text(matched_section_text)):
            return None, {"reason": "section_context not found in correct section", "target_drug": target_drug, "other_drug": other_drug, "quote": quote, "section_context": section_context}
            
    return {
        "source_drug": target_drug,
        "target_drug": target_drug,
        "other_drug": other_drug,
        "plain_language_summary": extraction.get('plain_language_summary', ''),
        "evidence_quote": quote,
        "section_context": section_context if section_context and str(section_context).lower() != 'null' else None,
        "label_section": found_section
    }, None

def main():
    if not API_KEY:
        print("Error: GEMINI_API_KEY is not set.")
        return

    drugs = ["warfarin", "aspirin", "ibuprofen"]
    fixtures = {"normalize": {}, "label": {}, "extract": {}}
    normalized = {}
    
    for d in drugs:
        print(f"Normalizing {d}...")
        res = normalize(d)
        fixtures["normalize"][d] = res
        if res.get('genericName'):
            normalized[d] = res['genericName']
            
    labels = {}
    for orig, gen in normalized.items():
        print(f"Fetching label for {gen}...")
        res = label(gen)
        fixtures["label"][gen] = res
        if res.get('found'):
            labels[gen] = res['sections']
            
    combined_items = []
    combined_rejections = []
    
    for orig, gen in normalized.items():
        if not labels.get(gen):
            continue
        other_drugs = [g for o, g in normalized.items() if g != gen]
        print(f"Extracting for {gen} against {other_drugs}...")
        res = extract_gemini(gen, other_drugs, labels[gen])
        fixtures["extract"][gen] = res
        
        parsed = {"relationships": []}
        try:
            parsed = json.loads(clean_json_string(res.get('rawOutput', '{}')))
        except Exception as e:
            print(f"Parse error for {gen}: {e}")
            
        for item in parsed.get('relationships', []):
            item['target_drug'] = gen
            validated, rejection = validate_edge(item, labels[gen], item.get('other_drug'))
            if validated:
                combined_items.append(validated)
            if rejection:
                combined_rejections.append(rejection)
                
    final_output = {
        "evidenceItems": combined_items,
        "rejections": combined_rejections
    }
    
    os.makedirs('src/app/fixtures', exist_ok=True)
    with open('src/app/fixtures/demoData.json', 'w') as f:
        json.dump(fixtures, f, indent=2)
    print("Wrote demoData.json")
    
    with open('raw_combined.json', 'w') as f:
        json.dump(final_output, f, indent=2)
    print("Wrote raw_combined.json")

if __name__ == "__main__":
    main()
