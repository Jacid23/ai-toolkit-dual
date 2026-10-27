import { NextRequest, NextResponse } from 'next/server';
import { scanRun } from '@/server/compare';
import type { CompareRun } from '@/utils/compare';

// every LoRA in each training's folder, with its step and the training's settings
export async function POST(request: NextRequest) {
  try {
    const { runs } = (await request.json()) as { runs: CompareRun[] };
    return NextResponse.json({ runs: await Promise.all((runs ?? []).map(scanRun)) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to scan trainings' }, { status: 500 });
  }
}
