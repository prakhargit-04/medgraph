const fs = require('fs');

async function testPair(nameA, nameB) {
  console.log(`\n--- Testing Pair: ${nameA} + ${nameB} ---`);
  
  // 1. Normalize
  const normA = await (await fetch(`http://localhost:3000/api/normalize?name=${encodeURIComponent(nameA)}`)).json();
  const normB = await (await fetch(`http://localhost:3000/api/normalize?name=${encodeURIComponent(nameB)}`)).json();
  console.log(`Normalize ${nameA}:`, normA);
  console.log(`Normalize ${nameB}:`, normB);
  
  if (normA.error || normB.error) {
    console.log(`One or both drugs failed normalization. Edge status would be: unavailable`);
    return;
  }
  
  // 2. Label
  const labelA = await (await fetch(`http://localhost:3000/api/label?genericName=${encodeURIComponent(normA.genericName)}`)).json();
  const labelB = await (await fetch(`http://localhost:3000/api/label?genericName=${encodeURIComponent(normB.genericName)}`)).json();
  
  const stateA = labelA.found ? 'found' : (labelA.reason === 'api_error' ? 'error' : 'not_found');
  const stateB = labelB.found ? 'found' : (labelB.reason === 'api_error' ? 'error' : 'not_found');
  
  console.log(`Label ${normA.genericName}: state=${stateA}`);
  console.log(`Label ${normB.genericName}: state=${stateB}`);
  
  // 3. Extract (only for found labels)
  let matchingEdges = [];
  let extractionStateA = 'idle';
  let extractionStateB = 'idle';
  
  if (stateA === 'found') {
    const extractReq = await fetch('http://localhost:3000/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drugName: normA.genericName,
        labelSections: labelA.sections,
        otherDrugs: [normB.genericName]
      })
    });
    const extractData = await extractReq.json();
    if (extractReq.ok && Array.isArray(extractData.edges)) {
      extractionStateA = 'ok';
      matchingEdges.push(...extractData.edges);
    } else {
      extractionStateA = 'failed';
    }
  }
  
  if (stateB === 'found') {
    const extractReq = await fetch('http://localhost:3000/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drugName: normB.genericName,
        labelSections: labelB.sections,
        otherDrugs: [normA.genericName]
      })
    });
    const extractData = await extractReq.json();
    if (extractReq.ok && Array.isArray(extractData.edges)) {
      extractionStateB = 'ok';
      matchingEdges.push(...extractData.edges);
    } else {
      extractionStateB = 'failed';
    }
  }
  
  // Determine Edge Status
  let status = 'no_evidence';
  if (matchingEdges.length > 0) {
    status = 'signal';
  } else if (extractionStateA === 'failed' || extractionStateB === 'failed') {
    status = 'unavailable';
  } else if (stateA === 'found' || stateB === 'found') {
    status = 'no_evidence';
  } else {
    status = 'unavailable';
  }
  
  console.log(`\nFINAL EDGE STATUS for ${nameA}-${nameB}: ${status}`);
  if (status === 'signal') {
    console.log('Evidence items:', JSON.stringify(matchingEdges, null, 2));
  }
}

async function runAll() {
  await testPair('aspirin', 'ibuprofen'); // Signal
  await testPair('tylenol', 'vitamin c'); // No Evidence (hopefully)
  await testPair('dolo 650', 'crocin'); // Source Unavailable (India only)
}

runAll();
