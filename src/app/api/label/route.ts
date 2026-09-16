import { NextResponse } from 'next/server';
import { fetchLabelForGeneric } from '../../../lib/labeling';

// Thin HTTP wrapper. All openFDA label-retrieval logic lives in
// src/lib/labeling.ts so it can be shared with /api/analyze.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genericName = searchParams.get('genericName');

  if (!genericName) {
    return NextResponse.json(
      { error: 'Missing genericName parameter' },
      { status: 400 }
    );
  }

  const result = await fetchLabelForGeneric(genericName);

  if (!result.found) {
    return NextResponse.json({ genericName, found: false, reason: result.reason });
  }

  return NextResponse.json({
    genericName,
    found: true,
    sections: result.sections,
    meta: result.meta,
  });
}
