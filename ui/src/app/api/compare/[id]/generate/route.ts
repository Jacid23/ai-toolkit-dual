import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { analyzeWorkflow, buildPrompt, comfyErrorText, comfyFetch, loadWorkflow, scanRun } from '@/server/compare';
import { cellKey, CompareData } from '@/utils/compare';

// Queue every image this comparison is missing (or all of them) in ComfyUI. Comfy runs them in
// order; /sync collects the finished images, so generation keeps going if the page is closed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { mode } = await request.json().catch(() => ({ mode: 'missing' }));
    const comparison = await prisma.comparison.findUnique({ where: { id } });
    if (!comparison) return NextResponse.json({ error: 'Comparison not found' }, { status: 404 });
    const data = JSON.parse(comparison.data) as CompareData;
    const s = data.settings;
    if (!s.workflow) return NextResponse.json({ error: 'Pick a ComfyUI workflow first.' }, { status: 400 });

    const prompts = Array.from(new Set(data.prompts.filter(p => p.trim() !== '')));
    if (!prompts.length) return NextResponse.json({ error: 'Add a prompt first.' }, { status: 400 });
    const excluded = new Set(data.excluded ?? []);
    const scanned = await Promise.all(data.runs.map(scanRun));
    const files = scanned.flatMap(r => r.files).filter(f => !excluded.has(f.path));
    if (!files.length) return NextResponse.json({ error: 'No LoRA files to sample.' }, { status: 400 });

    const existing = new Map(
      (await prisma.compareCell.findMany({ where: { comparison_id: id } })).map(c => [cellKey(c.lora_path, c.prompt), c]),
    );
    // grouped by prompt so Comfy can reuse the text encoding between consecutive jobs
    const todo = prompts.flatMap(prompt =>
      files
        .filter(f => {
          const c = existing.get(cellKey(f.path, prompt));
          if (c?.status === 'pending') return false;
          return mode === 'all' || c?.status !== 'done';
        })
        .map(f => ({ loraPath: f.path, prompt })),
    );
    if (!todo.length) return NextResponse.json({ queued: 0 });

    const api = await loadWorkflow(s.workflow);
    const map = await analyzeWorkflow(api);
    const snapshot = JSON.stringify({
      workflow: s.workflow,
      model: s.model,
      te: s.te,
      vae: s.vae,
      seed: s.seed,
      steps: s.steps,
      cfg: s.cfg,
      strength: s.strength,
      sampler: s.sampler,
      scheduler: s.scheduler,
      width: s.width,
      height: s.height,
      neg: s.neg,
    });

    let queued = 0;
    const failed: string[] = [];
    for (const cell of todo) {
      const where = { comparison_id_lora_path_prompt: { comparison_id: id, lora_path: cell.loraPath, prompt: cell.prompt } };
      let error: string | null = null;
      let promptId: string | null = null;
      try {
        const prompt = await buildPrompt(api, map, cell, s);
        const res = await comfyFetch('/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, client_id: 'aitk-compare' }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.prompt_id) promptId = body.prompt_id;
        else error = comfyErrorText(body);
      } catch (e: any) {
        error = e?.message ?? String(e);
      }
      // the first one failing means the workflow or settings are wrong: report it and stop
      if (error && queued === 0 && !failed.length) return NextResponse.json({ error }, { status: 400 });
      if (error) {
        failed.push(error);
        await prisma.compareCell.upsert({
          where,
          update: { status: 'error', error, comfy_id: null, settings: snapshot },
          create: { comparison_id: id, lora_path: cell.loraPath, prompt: cell.prompt, status: 'error', error, settings: snapshot },
        });
        continue;
      }
      await prisma.compareCell.upsert({
        where,
        update: { status: 'pending', comfy_id: promptId, error: null, settings: snapshot },
        create: { comparison_id: id, lora_path: cell.loraPath, prompt: cell.prompt, status: 'pending', comfy_id: promptId, settings: snapshot },
      });
      queued++;
    }
    return NextResponse.json({ queued, failed: failed.length, firstError: failed[0] ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to queue samples' }, { status: 500 });
  }
}
