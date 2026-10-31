import { NextResponse } from 'next/server';
import { latestSamplesByPrompt, readDatasetLinks } from '@/server/promptLinks';

// DUAL BUILD: Prompt Library extras: dataset -> group links, and the newest training sample per
// prompt (keyed by normalizePrompt(text)).
export async function GET() {
  const [links, samples] = await Promise.all([readDatasetLinks(), latestSamplesByPrompt().catch(() => ({}))]);
  return NextResponse.json({ links, samples });
}
