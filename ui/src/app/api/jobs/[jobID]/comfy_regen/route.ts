import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { clearRegenQueue, enqueueRegen, missingSamples, RegenItem, regenStatus } from '@/server/comfySamples';

// DUAL BUILD: the job's sample regen queue (server/comfySamples.ts), worked in the background.
// GET: queue state + the sample slots that have no image. POST { items: [{ step, idx }] }
// (or { step } for every prompt of a step): queue them; slots already queued are skipped.
// DELETE: drop everything still waiting (the step rendering now finishes).
const loadJob = async (params: Promise<{ jobID: string }>) => {
  const { jobID } = await params;
  return prisma.job.findUnique({ where: { id: jobID } });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const job = await loadJob(params);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ ...regenStatus(job.id), ...(await missingSamples(job)) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const job = await loadJob(params);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  let items: RegenItem[] = Array.isArray(body?.items)
    ? body.items.map((i: any) => ({ step: Number(i?.step), idx: Number(i?.idx) }))
    : [];
  if (!items.length && body?.step !== undefined) {
    const step = Number(body.step);
    const { promptCount } = await missingSamples(job);
    items = Array.from({ length: promptCount }, (_, idx) => ({ step, idx }));
  }
  if (!items.length) return NextResponse.json({ error: 'Nothing to regenerate' }, { status: 400 });
  const queued = enqueueRegen(job, items);
  return NextResponse.json({ queued, ...regenStatus(job.id) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const job = await loadJob(params);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ cleared: clearRegenQueue(job.id), ...regenStatus(job.id) });
}
