import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { getTrainingFolder } from '@/server/settings';

// Only these light settings may be queued for a live apply. Heavy ones (rank,
// optimizer, model, batch, resolution) are intentionally not hot-swappable.
const ALLOWED = new Set([
  'sample_every',
  'sample_steps',
  'guidance_scale',
  'sample_schedule',
  'save_every',
  'save_start_step',
  'max_step_saves_to_keep',
  'save_schedule',
  'steps',
  'lr',
]);

const PENDING_FILE = '.pending_updates.json';

async function jobFolder(jobID: string): Promise<{ folder: string; name: string } | null> {
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return null;
  const trainingFolder = await getTrainingFolder();
  return { folder: path.join(trainingFolder, job.name), name: job.name };
}

// Queue a batch of whitelisted settings; the trainer applies them at the next save point.
export async function POST(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;
  const info = await jobFolder(jobID);
  if (!info) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (ALLOWED.has(k) && v !== undefined && v !== null && v !== '') updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid settings to queue' }, { status: 400 });
  }

  try {
    await fs.promises.access(info.folder);
  } catch {
    return NextResponse.json({ error: 'Job output folder not created yet' }, { status: 404 });
  }

  await fs.promises.writeFile(path.join(info.folder, PENDING_FILE), JSON.stringify(updates, null, 2), 'utf-8');
  return NextResponse.json({ ok: true, queued: Object.keys(updates) });
}

// Report whether changes are currently queued (for the pending badge).
export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;
  const info = await jobFolder(jobID);
  if (!info) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  try {
    const raw = await fs.promises.readFile(path.join(info.folder, PENDING_FILE), 'utf-8');
    return NextResponse.json({ pending: true, updates: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ pending: false, updates: {} });
  }
}

// Cancel queued changes before they apply.
export async function DELETE(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;
  const info = await jobFolder(jobID);
  if (!info) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  try {
    await fs.promises.unlink(path.join(info.folder, PENDING_FILE));
  } catch {
    /* nothing queued */
  }
  return NextResponse.json({ ok: true });
}
