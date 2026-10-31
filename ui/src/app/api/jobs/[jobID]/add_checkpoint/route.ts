import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { getTrainingFolder } from '@/server/settings';

// DUAL BUILD: POST — extend a job by one checkpoint. Raises train.steps by one save interval
// (or adds the next step to a custom save_schedule at its last spacing). A stopped/finished
// job's saved config is edited (so it shows as resumable); a running job gets a Live Edit.
const PENDING_FILE = '.pending_updates.json';

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  let config: any;
  try {
    config = JSON.parse(job.job_config);
  } catch {
    return NextResponse.json({ error: 'Job config is not valid JSON' }, { status: 500 });
  }
  const proc = config?.config?.process?.[0];
  if (!proc?.train) return NextResponse.json({ error: 'Not a training job' }, { status: 400 });

  const save = (proc.save ??= {});
  const running = job.status === 'running';

  // A running job is treated as a Live Edit: the change is queued for the trainer (stacking on
  // anything already queued), applies at the next save, and the trainer then writes it back
  // to the saved job. Otherwise the saved config is edited directly.
  const folder = path.join(await getTrainingFolder(), job.name);
  const file = path.join(folder, PENDING_FILE);
  let pending: Record<string, any> = {};
  if (running) {
    try {
      await fs.promises.access(folder);
    } catch {
      return NextResponse.json({ error: 'Job output folder not created yet' }, { status: 404 });
    }
    pending = JSON.parse(await fs.promises.readFile(file, 'utf-8').catch(() => '{}')) || {};
  }

  const steps = Number(pending.steps ?? proc.train.steps) || 0;
  const every = Number(pending.save_every ?? save.save_every) || 0;
  const rawSchedule = pending.save_schedule ?? save.save_schedule;
  const schedule: number[] = Array.isArray(rawSchedule)
    ? Array.from(new Set<number>(rawSchedule.map(Number).filter((n: number) => Number.isFinite(n) && n > 0))).sort(
        (a, b) => a - b,
      )
    : [];

  let newSteps: number;
  let newSchedule: number[] | null = null;
  if (schedule.length) {
    const last = schedule[schedule.length - 1];
    const gap = schedule.length >= 2 ? last - schedule[schedule.length - 2] : every || last;
    const next = Math.max(last, steps) + gap;
    newSchedule = [...schedule, next];
    newSteps = next;
  } else {
    if (every <= 0) return NextResponse.json({ error: 'Job has no save interval' }, { status: 400 });
    newSteps = steps + every;
  }

  if (running) {
    pending.steps = newSteps;
    if (newSchedule) pending.save_schedule = newSchedule;
    await fs.promises.writeFile(file, JSON.stringify(pending, null, 2), 'utf-8');
    return NextResponse.json({ ok: true, steps: newSteps, save_schedule: newSchedule, queued: true });
  }

  proc.train.steps = newSteps;
  if (newSchedule) save.save_schedule = newSchedule;
  await prisma.job.update({
    where: { id: jobID },
    data: { job_config: JSON.stringify(config), total_steps: newSteps },
  });
  return NextResponse.json({ ok: true, steps: newSteps, save_schedule: newSchedule, queued: false });
}
