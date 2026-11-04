// DUAL BUILD: a job's save location (New Job → Job → Save Location) is the folder its <job name>
// output folder is made in, so trainings can be organized into groups before they run. Blank
// = Settings → Training Folder. The cron worker reads it the same way (cron/paths.ts).
import path from 'path';
import prisma from '@/server/prisma';
import { getTrainingFolder } from '@/server/settings';

type JobLike = { name: string; job_config?: string | null };

// the job's own save location, '' when it uses the Training Folder (or isn't an absolute path)
export const saveLocationOf = (job: { job_config?: string | null }): string => {
  try {
    const v = JSON.parse(job.job_config || '{}')?.config?.process?.[0]?.save_location;
    return typeof v === 'string' && path.isAbsolute(v.trim()) ? path.resolve(v.trim()) : '';
  } catch {
    return '';
  }
};

// the folder the job's output folder goes in
export const jobRootOf = async (job: JobLike) => saveLocationOf(job) || (await getTrainingFolder());

// the job's output folder: <save location or Training Folder>\<job name>. It holds only the LoRAs,
// their .webp thumbnails (<name>[_<step>].webp) and LoRA Manager's <lora>.metadata.json
export const jobOutputFolder = async (job: JobLike) => path.join(await jobRootOf(job), job.name);

// everything else the job keeps (config, log.txt, logs\, loss_log.db, optimizer.pt, samples\,
// live-edit and pid files, notes) goes in <job folder>\config; the trainer uses the same folder
export const META_DIR = 'config';
export const jobMetaFolder = async (job: JobLike) => path.join(await jobOutputFolder(job), META_DIR);

// every save location a job uses, for the file routes' allowed roots
let rootsCache: { at: number; roots: string[] } | null = null;
export async function saveLocationRoots(): Promise<string[]> {
  if (rootsCache && Date.now() - rootsCache.at < 10000) return rootsCache.roots;
  const jobs = await prisma.job.findMany({ select: { job_config: true } });
  const roots = Array.from(new Set(jobs.map(saveLocationOf).filter(Boolean)));
  rootsCache = { at: Date.now(), roots };
  return roots;
}

// the Training Folder plus every job's save location
export const outputRoots = async () => Array.from(new Set([await getTrainingFolder(), ...(await saveLocationRoots())]));
