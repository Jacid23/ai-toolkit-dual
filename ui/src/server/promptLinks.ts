import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { getDataRoot, getDatasetsRoot, getTrainingFolder } from '@/server/settings';
import { jobSamplePrompts } from '@/server/comfySamples';
import { jobSamples } from '@/server/jobSamples';

// DUAL BUILD: what the Prompt Library shows around its prompts: which datasets link to each
// group (the .aitk_prompts.json written by api/datasets/prompt_link) and the latest training
// sample rendered from each prompt.
export const PROMPT_LINK_FILE = '.aitk_prompts.json';

export const promptOrderBy = [{ sort_order: 'asc' }, { created_at: 'asc' }] as any;

export async function readDatasetLinks(): Promise<{ dataset: string; group: string }[]> {
  const root = await getDatasetsRoot();
  let dirs: fs.Dirent[] = [];
  try {
    dirs = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const links = await Promise.all(
    dirs
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(async d => {
        try {
          const raw = await fs.promises.readFile(path.join(root, d.name, PROMPT_LINK_FILE), 'utf-8');
          const group = String(JSON.parse(raw)?.group || '').trim();
          return group ? { dataset: d.name, group } : null;
        } catch {
          return null;
        }
      }),
  );
  return links.filter(Boolean) as { dataset: string; group: string }[];
}

// a renamed group keeps its datasets; a deleted one (to = '') unlinks them
export async function relinkDatasets(from: string, to: string) {
  const root = await getDatasetsRoot();
  for (const { dataset, group } of await readDatasetLinks()) {
    if (group !== from) continue;
    const file = path.join(root, dataset, PROMPT_LINK_FILE);
    if (to) await fs.promises.writeFile(file, JSON.stringify({ group: to }, null, 2), 'utf-8').catch(() => {});
    else await fs.promises.unlink(file).catch(() => {});
  }
}

export const normalizePrompt = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

// an image the user uploaded for a prompt, shown instead of its latest training sample:
// <data root>/prompt_images/<prompt id>__<upload time>.<ext> (the time keeps a replaced image
// from being served from the browser cache)
export async function promptImagesDir() {
  return path.join(await getDataRoot(), 'prompt_images');
}

export async function promptImages(): Promise<Record<string, string>> {
  const dir = await promptImagesDir();
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return out;
  }
  for (const n of names.sort()) {
    const id = n.split('__')[0];
    if (id && n.includes('__')) out[id] = path.join(dir, n); // sorted, so the newest wins
  }
  return out;
}

export async function removePromptImage(id: string) {
  const dir = await promptImagesDir();
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter(n => n.startsWith(`${id}__`)).map(n => fs.promises.unlink(path.join(dir, n)).catch(() => {})));
}

export type PromptSample = { path: string; jobId: string; jobName: string; step: number; jobs: number };

// newest sample image per prompt text, across every job's samples folder; a job's slot idx maps
// to its current sample prompts, so files from prompts that were since edited can be mislabeled
export async function latestSamplesByPrompt(): Promise<Record<string, PromptSample>> {
  const jobs = await prisma.job.findMany();
  const best: Record<string, PromptSample & { ts: number }> = {};
  const jobSets: Record<string, Set<string>> = {};
  await Promise.all(
    jobs.map(async job => {
      const prompts = jobSamplePrompts(job).map(normalizePrompt);
      if (!prompts.length) return;
      // its samples\ folder, plus a moved training's samples (Settings → Moved Outputs Folder)
      for (const s of await jobSamples(job)) {
        const key = prompts[s.idx];
        if (!key) continue;
        (jobSets[key] ??= new Set()).add(job.id);
        if (best[key] && best[key].ts >= s.ts) continue;
        best[key] = { ts: s.ts, path: s.path, jobId: job.id, jobName: job.name, step: s.step, jobs: 0 };
      }
    }),
  );
  const out: Record<string, PromptSample> = {};
  for (const [key, { ts, ...s }] of Object.entries(best)) out[key] = { ...s, jobs: jobSets[key]?.size ?? 1 };
  return out;
}
