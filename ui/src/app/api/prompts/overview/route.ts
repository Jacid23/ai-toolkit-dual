import { NextResponse } from 'next/server';
import { latestSamplesByPrompt, promptImages, readDatasetLinks } from '@/server/promptLinks';

// DUAL BUILD: Prompt Library extras: dataset -> group links, the newest training sample per
// prompt (keyed by normalizePrompt(text)), and the images uploaded for prompts (keyed by id).
export async function GET() {
  const [links, samples, images] = await Promise.all([
    readDatasetLinks(),
    latestSamplesByPrompt().catch(() => ({})),
    promptImages().catch(() => ({})),
  ]);
  return NextResponse.json({ links, samples, images });
}
