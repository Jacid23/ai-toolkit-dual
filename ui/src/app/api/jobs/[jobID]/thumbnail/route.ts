import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { thumbnailPromptOf, writeThumbnails } from '@/server/thumbnails';

// DUAL BUILD: GET → the job's thumbnail prompt. POST { prompt } → make that prompt the job's
// thumbnails: saved on the job (sample.thumbnail_prompt) and every LoRA's <name>[_<step>].webp
// beside it rewritten from that prompt's samples.
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ prompt: thumbnailPromptOf(job) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const body = await request.json().catch(() => ({}));
  const prompt = Number(body?.prompt);
  if (!Number.isInteger(prompt) || prompt < 0) return NextResponse.json({ error: 'prompt must be a prompt #' }, { status: 400 });
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const cfg = JSON.parse(job.job_config);
  const sample = cfg?.config?.process?.[0]?.sample;
  if (!sample) return NextResponse.json({ error: 'Job has no sample settings' }, { status: 400 });
  sample.thumbnail_prompt = prompt;
  const saved = await prisma.job.update({ where: { id: jobID }, data: { job_config: JSON.stringify(cfg), updated_at: job.updated_at } });
  try {
    const written = await writeThumbnails(saved);
    return NextResponse.json({ ok: true, prompt, written });
  } catch (e: any) {
    return NextResponse.json({ error: `Thumbnails failed: ${e?.message ?? e}` }, { status: 500 });
  }
}
