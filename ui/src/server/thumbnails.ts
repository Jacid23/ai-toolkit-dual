// DUAL BUILD: each LoRA in a job folder gets the sample of the job's thumbnail prompt
// (sample.thumbnail_prompt, default the first) at its step beside it as <name>[_<step>].webp.
// The writing is toolkit/job_thumbnails.py (PIL has webp; the UI has no image library), the
// same code the trainer runs when a job ends.
import { spawn } from 'child_process';
import path from 'path';
import { TOOLKIT_ROOT } from '@/paths';
import { resolvePythonPath } from '../../cron/pythonPath';
import { jobOutputFolder } from '@/server/jobFolders';
import prisma from '@/server/prisma';

type JobLike = { id: string; name: string; job_config: string };

export const thumbnailPromptOf = (job: { job_config: string }): number => {
  try {
    const v = Number(JSON.parse(job.job_config)?.config?.process?.[0]?.sample?.thumbnail_prompt);
    return Number.isInteger(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
};

const finalStepOf = (job: { job_config: string }): number | null => {
  try {
    const v = Number(JSON.parse(job.job_config)?.config?.process?.[0]?.train?.steps);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

// rewrite the job's thumbnails from its thumbnail prompt; resolves with how many were written
export async function writeThumbnails(job: JobLike): Promise<number> {
  const folder = await jobOutputFolder(job);
  const args = ['-I', path.join(TOOLKIT_ROOT, 'toolkit', 'job_thumbnails.py'), folder, String(thumbnailPromptOf(job))];
  const final = finalStepOf(job);
  if (final) args.push(String(final));
  return await new Promise((resolve, reject) => {
    const child = spawn(resolvePythonPath(), args, { cwd: TOOLKIT_ROOT, windowsHide: true });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('error', reject);
    child.on('close', code => {
      const m = out.match(/(\d+) thumbnail\(s\) written/);
      if (code === 0 && m) resolve(parseInt(m[1], 10));
      else reject(new Error(out.trim().split('\n').pop() || `thumbnails exited with ${code}`));
    });
  });
}

// a late sample of the thumbnail prompt landed (ComfyUI): refresh the job's thumbnails once its
// batch settles, one run per job at a time
const pending = new Map<string, ReturnType<typeof setTimeout>>();
export function refreshThumbnailsSoon(job: JobLike, idx: number) {
  if (idx !== thumbnailPromptOf(job)) return;
  clearTimeout(pending.get(job.id));
  pending.set(
    job.id,
    setTimeout(async () => {
      pending.delete(job.id);
      const fresh = await prisma.job.findUnique({ where: { id: job.id } }).catch(() => null);
      if (!fresh) return;
      writeThumbnails(fresh).catch(e => console.warn(`thumbnails for ${fresh.name}: ${e?.message ?? e}`));
    }, 3000),
  );
}
