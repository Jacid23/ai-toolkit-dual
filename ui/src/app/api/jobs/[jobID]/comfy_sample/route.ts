import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { getTrainingFolder } from '@/server/settings';
import { analyzeWorkflow, buildPrompt, comfyFetch, comfyJson, loadWorkflow, workflowValues } from '@/server/compare';
import { DEFAULT_COMPARE_SETTINGS } from '@/utils/compare';

// DUAL BUILD — training samples via ComfyUI (stage 1).
// Drive the user's ComfyUI with their Compare workflow: swap in a checkpoint's LoRA and
// each prompt, keep the workflow's own tuned sampler/size (GPU pin lives in the workflow),
// then save the images into the job's samples/ folder with aitk's naming so the training
// UI shows them. Callable directly for testing; the trainer fires it non-blocking at save
// points (stage 2).

const stepFromCheckpoint = (file: string): number => {
  const m = path.basename(file).match(/_(\d{6,})\./);
  return m ? parseInt(m[1], 10) : 0;
};

async function latestCheckpoint(folder: string): Promise<string | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  const safes = entries.filter(e => e.isFile() && e.name.endsWith('.safetensors')).map(e => path.join(folder, e.name));
  if (!safes.length) return null;
  const stats = await Promise.all(safes.map(async f => ({ f, t: (await fs.promises.stat(f)).mtimeMs })));
  stats.sort((a, b) => b.t - a.t);
  return stats[0].f;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }

  const jobFolder = path.join(await getTrainingFolder(), job.name);
  const samplesFolder = path.join(jobFolder, 'samples');

  const checkpoint: string | null =
    typeof body.checkpoint === 'string' && body.checkpoint ? body.checkpoint : await latestCheckpoint(jobFolder);
  if (!checkpoint) return NextResponse.json({ error: 'No checkpoint found to sample' }, { status: 404 });

  let jobConfig: any = {};
  try {
    jobConfig = JSON.parse(job.job_config);
  } catch {
    /* ignore */
  }
  const proc = jobConfig?.config?.process?.[0] ?? {};

  const workflow: string = body.workflow || proc?.sample?.comfy_workflow || '';
  if (!workflow) return NextResponse.json({ error: 'No ComfyUI workflow specified' }, { status: 400 });

  const prompts: string[] =
    Array.isArray(body.prompts) && body.prompts.length
      ? body.prompts
      : (proc?.sample?.samples ?? []).map((x: any) => x?.prompt).filter((p: any) => typeof p === 'string' && p.trim());
  if (!prompts.length) return NextResponse.json({ error: 'No prompts to sample' }, { status: 400 });

  const step = Number(body.step) || stepFromCheckpoint(checkpoint);

  let api: any, map: any, s: any;
  try {
    api = await loadWorkflow(workflow);
    map = await analyzeWorkflow(api);
    const wv = await workflowValues(api, map); // keep the workflow's own tuned values
    s = { ...DEFAULT_COMPARE_SETTINGS, ...wv, workflow };
    if (body.strength != null) s.strength = Number(body.strength);
    if (body.seed != null) s.seed = Number(body.seed);
  } catch (e: any) {
    return NextResponse.json({ error: `Workflow error: ${e?.message ?? e}` }, { status: 400 });
  }

  // submit one job per prompt
  const submitted: { idx: number; comfyId: string }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < prompts.length; i++) {
    try {
      const prompt = await buildPrompt(api, map, { loraPath: checkpoint, prompt: prompts[i] }, s);
      const res = await comfyFetch('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: 'aitk-train-sample' }),
      });
      if (!res.ok) throw new Error(`/prompt HTTP ${res.status}`);
      const j = await res.json();
      if (j?.prompt_id) submitted.push({ idx: i, comfyId: j.prompt_id });
      else throw new Error('no prompt_id returned');
    } catch (e: any) {
      errors.push(`prompt ${i}: ${e?.message ?? e}`);
    }
  }
  if (!submitted.length) {
    return NextResponse.json({ error: `ComfyUI rejected all prompts: ${errors.join('; ')}` }, { status: 502 });
  }

  // poll for completion + pull the images into samples/ (bounded)
  await fs.promises.mkdir(samplesFolder, { recursive: true });
  const saved: string[] = [];
  const stepTag = String(step).padStart(9, '0');
  const deadlineMs = Date.now() + 1000 * 60 * Math.min(20, Number(body.timeoutMin) || 10);
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
        const file = path.join(samplesFolder, `${Date.now()}__${stepTag}_${idx}${ext}`);
        await fs.promises.writeFile(file, Buffer.from(await r.arrayBuffer()));
        saved.push(file);
        remaining.delete(comfyId);
      } catch (e: any) {
        errors.push(`job ${idx}: ${e?.message ?? e}`);
        remaining.delete(comfyId);
      }
    }
    if (remaining.size) await new Promise(res => setTimeout(res, 2000));
  }

  return NextResponse.json({
    ok: saved.length > 0,
    checkpoint,
    step,
    saved,
    pending: remaining.size,
    errors: errors.length ? errors : undefined,
  });
}
