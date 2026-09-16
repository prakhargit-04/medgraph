import { NextRequest, NextResponse } from 'next/server';
import { runExtraction } from '../../../lib/extraction';

// Thin HTTP wrapper. All extraction/validation logic lives in
// src/lib/extraction.ts so it can be shared with /api/analyze without one
// API route importing another as if it were a library module.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { drugName, labelSections, otherDrugs } = body;

    const result = await runExtraction(drugName, labelSections, otherDrugs);
    const { httpStatus, ...payload } = result;
    return NextResponse.json(payload, { status: httpStatus });
  } catch (error: any) {
    console.error('[Extract API Fatal Error]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
