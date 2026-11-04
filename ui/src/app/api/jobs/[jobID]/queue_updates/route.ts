import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { jobMetaFolder } from '@/server/jobFolders';

// Only these light settings may be queued for a live apply. Heavy ones (rank,
// optimizer, model, batch, resolution) are intentionally not hot-swappable.
const ALLOWED = new Set([
  'sample_every',
  'sample_steps',
  'guidance_scale',
  'sample_width',
  'sample_height',
  'sample_seed',
  'sampler',
  'sample_prompts',
  'sample_schedule',
  'defer_samples',
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
  return { folder: await jobMetaFolder(job), name: job.name };
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

  // The UI renders samples itself (Samples tab regen, "Sample later", ComfyUI), from the saved
  // job: so the sample settings are saved to the job right away instead of waiting for the
  // trainer's next save, and the Samples tab's slots follow edited prompts at once.
  let applied: string[] = [];
  try {
    const job = await prisma.job.findUnique({ where: { id: jobID } });
    const cfg = JSON.parse(job?.job_config || '{}');
    const sample = cfg?.config?.process?.[0]?.sample;
    if (sample) {
      const set = (name: string, key: string, value: any) => {
        if (JSON.stringify(sample[key] ?? null) === JSON.stringify(value)) return;
        sample[key] = value;
        applied.push(name);
      };
      // '' = Default, else an address (or the older 'main' / 'later')
      const pick = body?.comfy_server;
      if (typeof pick === 'string' && (pick === '' || pick === 'main' || pick === 'later' || /^https?:\/\//.test(pick)))
        set('comfy_server', 'comfy_server', pick);
      if (Array.isArray(updates.sample_prompts)) {
        const prompts = updates.sample_prompts.map((x: any) => String(x).trim()).filter(Boolean);
        // a prompt keeps its own size / seed / control image while its slot's text is unchanged
        const old: any[] = sample.samples ?? [];
        if (prompts.length) set('sample_prompts', 'samples', prompts.map((p: string, i: number) => (old[i]?.prompt === p ? old[i] : { prompt: p })));
      }
      if ('defer_samples' in updates) set('defer_samples', 'defer_samples', !!updates.defer_samples);
      const num = (name: string, key: string) => {
        const v = Number(updates[name]);
        if (name in updates && isFinite(v)) set(name, key, v);
      };
      num('sample_width', 'width');
      num('sample_height', 'height');
      num('sample_seed', 'seed');
      num('sample_steps', 'sample_steps');
      num('guidance_scale', 'guidance_scale');
      if (applied.length) await prisma.job.update({ where: { id: jobID }, data: { job_config: JSON.stringify(cfg) } });
    }
  } catch {
    /* unreadable config: leave it */
    applied = [];
  }
  if (Object.keys(updates).length === 0) {
    if (applied.length) return NextResponse.json({ ok: true, queued: [], applied });
    return NextResponse.json({ error: 'No valid settings to queue' }, { status: 400 });
  }

  try {
    await fs.promises.access(info.folder);
  } catch {
    return NextResponse.json({ error: 'Job output folder not created yet' }, { status: 404 });
  }

  await fs.promises.writeFile(path.join(info.folder, PENDING_FILE), JSON.stringify(updates, null, 2), 'utf-8');
  return NextResponse.json({ ok: true, queued: Object.keys(updates), applied });
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
