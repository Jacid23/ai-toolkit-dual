import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { checkSampleReady, enqueueRegen, isBackfilling, missingSamples } from '@/server/comfySamples';
import { comfyServerUrl, withComfyUrl } from '@/server/compare';

// DUAL BUILD: render this job's missing training samples on ComfyUI (every prompt at every
// checkpoint that has no image for it, plus the step-0 baseline) into its samples/ folder, through
// the job's regen queue. GET: what is missing / whether the queue is busy. POST { workflow? }:
// queue them, rendered on the picked ComfyUI ({ server }) with the workflow tied to it.
const stepsOf = (items: { step: number }[]) => Array.from(new Set(items.map(i => i.step)));

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const { missing } = await missingSamples(job);
  return NextResponse.json({ running: isBackfilling(job.id), missing: stepsOf(missing) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const { missing } = await missingSamples(job);
  if (!missing.length) return NextResponse.json({ running: isBackfilling(job.id), queued: 0 });

  let workflow: string;
  let server: string;
  try {
    // body.server: 'later' renders on the Later Samples ComfyUI (Compare's server switch)
    server = await comfyServerUrl(body?.server);
    ({ workflow } = await withComfyUrl(server, () => checkSampleReady()));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
  const added = enqueueRegen(job, missing, server);
  if (!added) return NextResponse.json({ running: true, queued: 0 });
  const steps = stepsOf(missing);
  return NextResponse.json({ running: true, queued: steps.length, steps, workflow });
}
