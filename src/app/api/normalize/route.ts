import { NextResponse } from 'next/server';
import { normalizeDrug } from '../../../lib/normalization';

// Thin HTTP wrapper. All normalization logic lives in
// src/lib/normalization.ts so it can be shared with /api/analyze.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');

  if (!name) {
    return NextResponse.json(
      { error: 'Missing drug name parameter' },
      { status: 400 }
    );
  }

  const result = await normalizeDrug(name);

  if (result.error) {
    if (result.notFoundReason === 'rxnorm_not_found' || result.notFoundReason === 'no_ingredient') {
      return NextResponse.json(
        { error: result.error, originalName: result.originalName },
        { status: 404 }
      );
    }
    const isTimeout = result.error.toLowerCase().includes('timed out');
    return NextResponse.json(
      { error: result.error },
      { status: isTimeout ? 504 : 500 }
    );
  }

  return NextResponse.json({
    originalName: result.originalName,
    rxcui: result.rxcui,
    genericName: result.genericName,
  });
}
