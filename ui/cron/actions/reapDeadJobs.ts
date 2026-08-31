import prisma from '../prisma';
import { Job } from '@prisma/client';

// dual-GPU build: crash recovery.
// Jobs are spawned detached and unwatched; if the python process dies hard
// (OOM, killed, segfault) nothing marks the job terminal, so it stays
// 'running' with a dead PID and the queue refuses to start anything else
// forever (the "force-quit to recover" bug). This reaper runs every cron tick,
// finds jobs whose PID is no longer alive, and reconciles their status so the
// queue frees up on its own.

const isPidAlive = (pid: number): boolean => {
  try {
    // signal 0 doesn't kill — it just probes existence.
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // ESRCH = no such process (dead). EPERM = exists but not ours (alive).
    return e && e.code === 'EPERM';
  }
};

const totalStepsOf = (job: Job): number => {
  if (job.total_steps != null) return job.total_steps;
  try {
    return JSON.parse(job.job_config)?.config?.process?.[0]?.train?.steps ?? 0;
  } catch {
    return 0;
  }
};

export default async function reapDeadJobs(): Promise<void> {
  const active: Job[] = await prisma.job.findMany({
    where: { status: { in: ['running', 'stopping'] } },
  });

  for (const job of active) {
    // no PID yet = just launched, spawn hasn't written it. Leave it alone.
    if (job.pid == null) continue;
    if (isPidAlive(job.pid)) continue;

    // process is gone but the DB still thinks it's live — reconcile.
    const total = totalStepsOf(job);
    const reachedEnd = total > 0 && job.step >= total;

    let status: string;
    let info: string;
    if (job.return_to_queue) {
      status = 'queued';
      info = 'Requeued after process ended.';
    } else if (reachedEnd) {
      status = 'completed';
      info = 'Completed.';
    } else {
      status = 'error';
      info = `Process ended unexpectedly at step ${job.step}/${total} (crash, OOM, or killed).`;
    }

    console.log(`reapDeadJobs: job ${job.id} pid ${job.pid} is dead -> ${status}`);
    await prisma.job.update({
      where: { id: job.id },
      data: { status, info, stop: false, return_to_queue: false, pid: null },
    });
  }
}
