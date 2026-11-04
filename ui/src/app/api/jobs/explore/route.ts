import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import prisma from '@/server/prisma';
import { getTrainingFolder } from '@/server/settings';
import { jobOutputFolder, jobRootOf } from '@/server/jobFolders';

// DUAL BUILD: what the Jobs explorer shows beside each training that only its folder knows:
// its group (the folder it saves in, relative to the Training Folder), its LoRAs (count, size,
// first and newest file time, the final save's time) and whether it has samples.
export type JobFileInfo = {
  group: string; // 'Krea2/Lexi'; '' = straight in the Training Folder; an outside folder = its full path
  folderExists: boolean;
  loras: number;
  size: number;
  firstLora: number | null;
  lastLora: number | null;
  finalAt: number | null; // <name>.safetensors, written when the job finished
  ckptSize: number | null; // one LoRA's size (the newest checkpoint)
  hasSamples: boolean;
};

const SAMPLE = /^\d+__\d+_\d+\.(png|jpe?g|webp)$/i;
let cache: { at: number; data: Record<string, JobFileInfo> } | null = null;

async function infoOf(job: { name: string; job_config: string }, trainingFolder: string): Promise<JobFileInfo> {
  const root = await jobRootOf(job);
  const rel = path.relative(trainingFolder, root);
  const group = !rel ? '' : rel.startsWith('..') || path.isAbsolute(rel) ? root : rel.split(path.sep).join('/');
  const folder = await jobOutputFolder(job);
  const out: JobFileInfo = {
    group,
    folderExists: false,
    loras: 0,
    size: 0,
    firstLora: null,
    lastLora: null,
    finalAt: null,
    ckptSize: null,
    hasSamples: false,
  };
  let newest = -1;
  const names = await fs.promises.readdir(folder).catch(() => null);
  if (!names) return out;
  out.folderExists = true;
  await Promise.all(
    names
      .filter(n => n.toLowerCase().endsWith('.safetensors'))
      .map(async n => {
        const st = await fs.promises.stat(path.join(folder, n)).catch(() => null);
        if (!st) return;
        out.loras += 1;
        out.size += st.size;
        out.firstLora = out.firstLora === null ? st.mtimeMs : Math.min(out.firstLora, st.mtimeMs);
        out.lastLora = out.lastLora === null ? st.mtimeMs : Math.max(out.lastLora, st.mtimeMs);
        if (n === `${job.name}.safetensors`) out.finalAt = st.mtimeMs;
        if (st.mtimeMs > newest) {
          newest = st.mtimeMs;
          out.ckptSize = st.size;
        }
      }),
  );
  const samples = await fs.promises.readdir(path.join(folder, 'config', 'samples')).catch(() => [] as string[]);
  out.hasSamples = samples.some(n => SAMPLE.test(n));
  return out;
}

export async function GET() {
  if (cache && Date.now() - cache.at < 15000) return NextResponse.json({ jobs: cache.data });
  const trainingFolder = await getTrainingFolder();
  const jobs = await prisma.job.findMany({
    where: { job_type: 'train' },
    select: { id: true, name: true, job_config: true },
  });
  const data: Record<string, JobFileInfo> = {};
  await Promise.all(jobs.map(async j => (data[j.id] = await infoOf(j, trainingFolder))));
  cache = { at: Date.now(), data };
  return NextResponse.json({ jobs: data });
}
