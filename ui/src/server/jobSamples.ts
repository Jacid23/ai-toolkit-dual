// DUAL BUILD: a job's training samples, read from <job folder>\config\samples. File names are
// AITK's own <time>__<step>_<prompt #>.<ext>; regenerated samples go in the same folder.
import fs from 'fs';
import path from 'path';
import { jobMetaFolder } from '@/server/jobFolders';

export type FoundSample = { path: string; step: number; idx: number; ts: number };

export async function jobSamples(job: { name: string; job_config?: string | null }): Promise<FoundSample[]> {
  const folder = path.join(await jobMetaFolder(job), 'samples');
  const out: FoundSample[] = [];
  for (const f of await fs.promises.readdir(folder).catch(() => [] as string[])) {
    const m = f.match(/^(\d+)__(\d+)_(\d+)\.(png|jpe?g|webp)$/i);
    if (m) out.push({ path: path.join(folder, f), ts: parseInt(m[1], 10), step: parseInt(m[2], 10), idx: parseInt(m[3], 10) });
  }
  return out;
}
