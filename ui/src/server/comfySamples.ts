// DUAL BUILD — training samples via ComfyUI.
// Drive the user's ComfyUI with an API-format workflow: swap in a checkpoint's LoRA (or none,
// for the baseline), each sample prompt and the job's Sample card settings, then
// save the images into the job's samples/ folder with aitk's naming so the training UI shows
// them. Used by the trainer at sample points and by Compare to fill in missing steps.
import fs from 'fs';
import path from 'path';
import type { Job } from '@prisma/client';
import prisma from '@/server/prisma';
import { getTrainingFolder } from '@/server/settings';
import {
  analyzeWorkflow,
  buildPrompt,
  comfyErrorText,
  comfyFetch,
  comfyJson,
  getComfyUrl,
  jobFolder,
  loadWorkflow,
  scanFolder,
  workflowValues,
} from '@/server/compare';
import { DEFAULT_COMPARE_SETTINGS } from '@/utils/compare';

export class SampleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const procOf = (job: Job): any => {
  try {
    return JSON.parse(job.job_config)?.config?.process?.[0] ?? {};
  } catch {
    return {};
  }
};

// the training UI reads samples from <training folder>/<job>/samples
export const samplesFolderOf = async (job: Job) => path.join(await getTrainingFolder(), job.name, 'samples');

// explicit > the job's own (legacy per-job pick) > Settings default
export async function resolveSampleWorkflow(job: Job, explicit?: string | null): Promise<string> {
  if (explicit) return explicit;
  const own = procOf(job)?.sample?.comfy_workflow;
  if (own) return own;
  const row = await prisma.settings.findFirst({ where: { key: 'COMFY_SAMPLE_WORKFLOW' } });
  return row?.value?.trim() || '';
}

// [trigger]/[name] become the trigger word, as the internal sampler does
export function jobSamplePrompts(job: Job): string[] {
  const proc = procOf(job);
  const trigger: string = proc?.trigger_word ?? '';
  return (proc?.sample?.samples ?? [])
    .map((x: any) => x?.prompt)
    .filter((p: any) => typeof p === 'string' && p.trim())
    .map((p: string) => p.replace(/\[(trigger|name)\]/g, trigger));
}

// The job's Sample card drives ComfyUI: size/steps/guidance/seed/neg from the card itself,
// model/TE/VAE/sampler/scheduler/strength from its ComfyUI section. Blank = workflow's own.
function jobComfySettings(job: Job): Record<string, any> {
  const sample = procOf(job)?.sample ?? {};
  const c = sample.comfy ?? {};
  const out: Record<string, any> = {};
  const num = (v: any) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? undefined : Number(v));
  const set = (k: string, v: any) => {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  };
  set('width', num(sample.width) || undefined);
  set('height', num(sample.height) || undefined);
  set('steps', num(sample.sample_steps) || undefined);
  set('cfg', num(sample.guidance_scale));
  set('seed', num(sample.seed));
  set('neg', typeof sample.neg === 'string' && sample.neg.trim() ? sample.neg : undefined);
  for (const k of ['model', 'te', 'vae', 'sampler', 'scheduler']) set(k, typeof c[k] === 'string' ? c[k] : undefined);
  set('strength', num(c.strength));
  return out;
}

const stepFromCheckpoint = (file: string): number => {
  const m = path.basename(file).match(/_(\d{6,})\./);
  return m ? parseInt(m[1], 10) : 0;
};

async function latestCheckpoint(folder: string): Promise<string | null> {
  const entries = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  const safes = entries.filter(e => e.isFile() && e.name.endsWith('.safetensors')).map(e => path.join(folder, e.name));
  if (!safes.length) return null;
  const stats = await Promise.all(safes.map(async f => ({ f, t: (await fs.promises.stat(f)).mtimeMs })));
  stats.sort((a, b) => b.t - a.t);
  return stats[0].f;
}

// Can a sample run right now? Comfy reachable + the workflow loads and analyzes.
export async function checkSampleReady(job: Job, explicitWorkflow?: string | null) {
  const workflow = await resolveSampleWorkflow(job, explicitWorkflow);
  if (!workflow) throw new SampleError('No ComfyUI sample workflow set (Settings → ComfyUI Sample Workflow).');
  try {
    await comfyJson('/system_stats', { timeoutMs: 4000 });
  } catch {
    throw new SampleError(`ComfyUI not reachable at ${await getComfyUrl()}`, 503);
  }
  try {
    await analyzeWorkflow(await loadWorkflow(workflow));
  } catch (e: any) {
    throw new SampleError(`Workflow "${workflow}": ${e?.message ?? e}`);
  }
  return { workflow };
}

export interface RenderOpts {
  checkpoint?: string | null; // a LoRA file; omitted = newest checkpoint, else base model
  base?: boolean; // force the base model (no LoRA)
  step?: number;
  workflow?: string | null;
  prompts?: string[];
  strength?: number;
  seed?: number;
  timeoutMin?: number;
  indices?: number[]; // render only these prompt slots (default: all)
  onSaved?: (idx: number, file: string) => void | Promise<void>; // each image as it lands
}

export async function renderTrainingSamples(job: Job, opts: RenderOpts) {
  const samplesFolder = await samplesFolderOf(job);

  // The trainer sends the checkpoint it just saved at this step. Without one, use the newest
  // checkpoint labeled with that checkpoint's own step; with none at all (baseline before the
  // first save) render the base model with no LoRA.
  let checkpoint: string | null = null;
  let step = Number(opts.step) || 0;
  if (opts.checkpoint) {
    checkpoint = opts.checkpoint;
    step = step || stepFromCheckpoint(opts.checkpoint);
  } else if (!opts.base) {
    checkpoint = await latestCheckpoint(await jobFolder(job));
    if (checkpoint) step = stepFromCheckpoint(checkpoint) || step;
  }

  const workflow = await resolveSampleWorkflow(job, opts.workflow);
  if (!workflow) throw new SampleError('No ComfyUI sample workflow set (Settings → ComfyUI Sample Workflow).');

  const trigger: string = procOf(job)?.trigger_word ?? '';
  const prompts = (opts.prompts?.length ? opts.prompts : jobSamplePrompts(job)).map(p =>
    p.replace(/\[(trigger|name)\]/g, trigger),
  );
  if (!prompts.length) throw new SampleError('No prompts to sample');

  let api: any, map: any, s: any;
  try {
    api = await loadWorkflow(workflow);
    map = await analyzeWorkflow(api);
    const wv = await workflowValues(api, map); // the workflow's own values fill anything the job leaves blank
    s = { ...DEFAULT_COMPARE_SETTINGS, ...wv, ...jobComfySettings(job), workflow };
    if (opts.strength != null) s.strength = Number(opts.strength);
    if (opts.seed != null) s.seed = Number(opts.seed);
  } catch (e: any) {
    throw new SampleError(`Workflow error: ${e?.message ?? e}`);
  }

  // per-prompt overrides from the job's sample list, and walk seed, as the internal sampler does
  const sample = procOf(job)?.sample ?? {};
  const items: any[] = sample.samples ?? [];
  const cellSettings = (i: number) => {
    const it = items[i] ?? {};
    const seed = it.seed ?? s.seed;
    return {
      ...s,
      seed: opts.seed == null && sample.walk_seed ? Number(seed) + i : Number(seed),
      width: it.width || s.width,
      height: it.height || s.height,
      steps: it.sample_steps || s.steps,
      cfg: it.guidance_scale ?? s.cfg,
      neg: it.neg || s.neg,
    };
  };

  // submit one job per prompt (slot numbers stay the prompt's own, so seed/size/name match a full batch)
  const order = opts.indices?.length
    ? Array.from(new Set(opts.indices)).filter(i => Number.isInteger(i) && i >= 0 && i < prompts.length)
    : prompts.map((_, i) => i);
  if (!order.length) throw new SampleError('No prompt for that sample slot (were prompts removed?)');
  const submitted: { idx: number; comfyId: string }[] = [];
  const errors: string[] = [];
  for (const i of order) {
    try {
      const prompt = await buildPrompt(api, map, { loraPath: checkpoint, prompt: prompts[i] }, cellSettings(i));
      const res = await comfyFetch('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: 'aitk-train-sample' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.prompt_id) throw new Error(comfyErrorText(j) || `/prompt HTTP ${res.status}`);
      submitted.push({ idx: i, comfyId: j.prompt_id });
    } catch (e: any) {
      errors.push(`prompt ${i}: ${e?.message ?? e}`);
    }
  }
  if (!submitted.length) throw new SampleError(`ComfyUI rejected all prompts: ${errors.join('; ')}`, 502);

  // poll for completion + pull the images into samples/ (bounded)
  await fs.promises.mkdir(samplesFolder, { recursive: true });
  const saved: string[] = [];
  const stepTag = String(step).padStart(9, '0');
  // name by submission time + prompt index (not download time) to keep prompt order in the batch
  const batchTs = Date.now();
  const deadlineMs = Date.now() + 1000 * 60 * Math.min(20, Number(opts.timeoutMin) || 10);
  const remaining = new Map(submitted.map(x => [x.comfyId, x.idx]));
  while (remaining.size && Date.now() < deadlineMs) {
    for (const [comfyId, idx] of Array.from(remaining)) {
      try {
        const h = (await comfyJson(`/history/${comfyId}`))?.[comfyId];
        if (!h) continue; // still queued or running
        if (h.status?.status_str === 'error') {
          errors.push(`job ${idx}: ComfyUI reported an error`);
          remaining.delete(comfyId);
          continue;
        }
        const images = Object.values<any>(h.outputs ?? {}).flatMap(o => o?.images ?? []);
        const pick = images.find(im => im.type === 'output') ?? images[0];
        if (!pick) {
          if (h.status?.completed) remaining.delete(comfyId);
          continue;
        }
        const qs = new URLSearchParams({
          filename: pick.filename,
          subfolder: pick.subfolder ?? '',
          type: pick.type ?? 'output',
        });
        const r = await comfyFetch(`/view?${qs}`, { timeoutMs: 60000 });
        if (!r.ok) throw new Error(`/view HTTP ${r.status}`);
        const ext = path.extname(pick.filename) || '.png';
        const file = path.join(samplesFolder, `${batchTs + idx}__${stepTag}_${idx}${ext}`);
        await fs.promises.writeFile(file, Buffer.from(await r.arrayBuffer()));
        saved.push(file);
        remaining.delete(comfyId);
        await opts.onSaved?.(idx, file);
      } catch (e: any) {
        errors.push(`job ${idx}: ${e?.message ?? e}`);
        remaining.delete(comfyId);
      }
    }
    if (remaining.size) await new Promise(res => setTimeout(res, 2000));
  }

  return {
    ok: saved.length > 0,
    checkpoint,
    step,
    saved,
    pending: remaining.size,
    errors: errors.length ? errors : undefined,
  };
}

// ---------- regen queue (sample grid / viewer → Regenerate, Compare → Fill) ----------
//
// One queue per job, worked in the background (it keeps going when the page closes). Items are
// single sample slots { step, idx }; a slot already queued or rendering is not added twice, and
// the slots of one step render together against the checkpoint saved at that step, with the
// job's current prompts and Sample card settings. Each new image replaces the old image(s) of
// its own slot as soon as it is saved, so nothing else for that step is touched.

export type RegenItem = { step: number; idx: number };
type RegenState = {
  pending: (RegenItem & { workflow?: string | null })[];
  current: { step: number; indices: number[]; done: number[] } | null;
  errors: string[];
  version: number; // bumps on every saved image, so pages know to reload the grid
  running: boolean;
};

// on globalThis so every route bundle sees the same queues
const g = globalThis as any;
const regenQueues: Map<string, RegenState> = (g.__aitkRegenQueues ??= new Map());
const regenState = (jobId: string): RegenState => {
  let q = regenQueues.get(jobId);
  if (!q) regenQueues.set(jobId, (q = { pending: [], current: null, errors: [], version: 0, running: false }));
  return q;
};

const SAMPLE_FILE_RE = /__(\d+)_(\d+)\.[a-z0-9]+$/i;
const slotKey = (step: number, idx: number) => `${step}:${idx}`;

export function regenStatus(jobId: string) {
  const q = regenState(jobId);
  return {
    running: q.running,
    current: q.current,
    pending: q.pending.map(({ step, idx }) => ({ step, idx })),
    errors: q.errors,
    version: q.version,
  };
}

export const isBackfilling = (jobId: string) => {
  const q = regenQueues.get(jobId);
  return !!q && (q.running || q.pending.length > 0);
};

export function enqueueRegen(job: Job, items: RegenItem[], workflow?: string | null) {
  const q = regenState(job.id);
  const busy = new Set(q.pending.map(p => slotKey(p.step, p.idx)));
  for (const i of q.current?.indices ?? []) if (!q.current!.done.includes(i)) busy.add(slotKey(q.current!.step, i));
  let added = 0;
  for (const it of items) {
    if (!Number.isInteger(it.step) || it.step < 0 || !Number.isInteger(it.idx) || it.idx < 0) continue;
    const k = slotKey(it.step, it.idx);
    if (busy.has(k)) continue;
    busy.add(k);
    q.pending.push({ step: it.step, idx: it.idx, workflow: workflow ?? null });
    added++;
  }
  if (added) void runRegenQueue(job.id);
  return added;
}

export function clearRegenQueue(jobId: string) {
  const q = regenState(jobId);
  const n = q.pending.length;
  q.pending = [];
  q.errors = [];
  return n;
}

async function runRegenQueue(jobId: string) {
  const q = regenState(jobId);
  if (q.running) return;
  q.running = true;
  try {
    while (q.pending.length) {
      const { step, workflow } = q.pending[0];
      const batch = q.pending.filter(p => p.step === step && (p.workflow ?? null) === (workflow ?? null));
      q.pending = q.pending.filter(p => !batch.includes(p));
      const indices = Array.from(new Set(batch.map(p => p.idx))).sort((a, b) => a - b);
      q.current = { step, indices, done: [] };
      try {
        // re-read the job so prompt / setting edits made since queueing are used
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job) throw new Error('job was deleted');
        const result = await renderSlots(job, step, indices, workflow, idx => {
          q.current?.done.push(idx);
          q.version++;
        });
        for (const e of result.errors ?? []) q.errors.push(`step ${step.toLocaleString()}: ${e}`);
      } catch (e: any) {
        q.errors.push(`step ${step.toLocaleString()}: ${e?.message ?? e}`);
      }
      q.errors = q.errors.slice(-10);
      q.current = null;
    }
  } finally {
    q.running = false;
    q.current = null;
  }
}

// render the given slots of one step; each saved image replaces its slot's older file(s)
async function renderSlots(
  job: Job,
  step: number,
  indices: number[],
  workflow: string | null | undefined,
  onSlotDone: (idx: number) => void,
) {
  const { files } = await scanFolder(await jobFolder(job)).catch(() => ({ files: [] as any[] }));
  const hit = files.find(f => f.step === step);
  if (!hit && step !== 0) throw new SampleError(`No checkpoint for step ${step.toLocaleString()} (was it deleted?)`, 404);
  const samplesFolder = await samplesFolderOf(job);
  return renderTrainingSamples(job, {
    checkpoint: hit?.path ?? null,
    base: !hit,
    step,
    workflow: workflow || null,
    indices,
    onSaved: async (idx, file) => {
      const names = await fs.promises.readdir(samplesFolder).catch(() => [] as string[]);
      const old = names.filter(n => {
        const m = n.match(SAMPLE_FILE_RE);
        return m && parseInt(m[1], 10) === step && parseInt(m[2], 10) === idx && path.join(samplesFolder, n) !== file;
      });
      await Promise.all(old.map(n => fs.promises.rm(path.join(samplesFolder, n), { force: true })));
      onSlotDone(idx);
    },
  });
}

// Every sample slot that should have an image but doesn't: each prompt at each checkpoint still
// on disk, plus the step-0 baseline when the job samples before training. While the job is
// running, its newest checkpoint is left out (the trainer's own sample for it is on the way).
export async function missingSamples(job: Job) {
  const count = jobSamplePrompts(job).length;
  const { files } = await scanFolder(await jobFolder(job)).catch(() => ({ files: [] as any[] }));
  const train = procOf(job)?.train ?? {};
  const steps: number[] = files.filter(f => f.step !== null).map(f => f.step as number);
  if (job.status === 'running' && steps.length) steps.splice(steps.indexOf(Math.max(...steps)), 1);
  if (!train.skip_first_sample && !train.disable_sampling && !steps.includes(0)) steps.unshift(0);

  const have = new Set<string>();
  for (const n of await fs.promises.readdir(await samplesFolderOf(job)).catch(() => [] as string[])) {
    const m = n.match(SAMPLE_FILE_RE);
    if (m) have.add(slotKey(parseInt(m[1], 10), parseInt(m[2], 10)));
  }
  const missing: RegenItem[] = [];
  for (const step of steps) for (let idx = 0; idx < count; idx++) if (!have.has(slotKey(step, idx))) missing.push({ step, idx });
  return {
    missing,
    checkpointSteps: files.filter(f => f.step !== null).map(f => f.step as number),
    promptCount: count,
  };
}
