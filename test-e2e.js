const http = require('http');

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:3000/');
      if (res.ok) {
        console.log("Server is up!");
        return true;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function runTest() {
  const up = await waitForServer();
  if (!up) {
    console.error("Server did not start in time.");
    return;
  }

  console.log("Fetching label for Warfarin...");
  const labelRes = await fetch('http://localhost:3000/api/label?genericName=warfarin');
  const labelData = await labelRes.json();
  
  if (!labelData.found) {
    console.error("Label not found!", labelData);
    return;
  }
  console.log("Label sections fetched:", Object.keys(labelData.sections).filter(k => labelData.sections[k] !== null));

  const payload = {
    drugName: "warfarin",
    otherDrugs: ["aspirin", "ibuprofen"],
    labelSections: labelData.sections
  };

  console.log("\nSending POST to /api/extract with payload...");
  const extRes = await fetch('http://localhost:3000/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const extData = await extRes.json();
  
  console.log("\n[TEST SCRIPT OUTPUT] API Response from /api/extract:");
  console.log(JSON.stringify(extData, null, 2));
}

runTest();
