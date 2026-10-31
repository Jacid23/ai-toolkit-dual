import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { getDatasetsRoot, getTrainingFolder } from '@/server/settings';
import { jobSamplePrompts } from '@/server/comfySamples';

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

export type PromptSample = { path: string; jobId: string; jobName: string; step: number; jobs: number };

// newest sample image per prompt text, across every job's samples folder; a job's slot idx maps
// to its current sample prompts, so files from prompts that were since edited can be mislabeled
export async function latestSamplesByPrompt(): Promise<Record<string, PromptSample>> {
  const training = await getTrainingFolder();
  const jobs = await prisma.job.findMany();
  const best: Record<string, PromptSample & { ts: number }> = {};
  const jobSets: Record<string, Set<string>> = {};
  await Promise.all(
    jobs.map(async job => {
      const prompts = jobSamplePrompts(job).map(normalizePrompt);
      if (!prompts.length) return;
      let files: string[] = [];
      try {
        files = await fs.promises.readdir(path.join(training, job.name, 'samples'));
      } catch {
        return;
      }
      for (const file of files) {
        const m = file.match(/^(\d+)__(\d+)_(\d+)\.(png|jpe?g|webp)$/i);
        if (!m) continue;
        const key = prompts[parseInt(m[3], 10)];
        if (!key) continue;
        (jobSets[key] ??= new Set()).add(job.id);
        const ts = parseInt(m[1], 10);
        if (best[key] && best[key].ts >= ts) continue;
        best[key] = {
          ts,
          path: path.join(training, job.name, 'samples', file),
          jobId: job.id,
          jobName: job.name,
          step: parseInt(m[2], 10),
          jobs: 0,
        };
      }
    }),
  );
  const out: Record<string, PromptSample> = {};
  for (const [key, { ts, ...s }] of Object.entries(best)) out[key] = { ...s, jobs: jobSets[key]?.size ?? 1 };
  return out;
}
