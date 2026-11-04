import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { checkSampleReady, jobComfyUrl, renderTrainingSamples, SampleError } from '@/server/comfySamples';
import { withComfyUrl } from '@/server/compare';

// DUAL BUILD — training samples via ComfyUI (see server/comfySamples.ts).
// GET: can this job sample on ComfyUI right now? The trainer asks before skipping its internal
// sampler. POST: render one sample batch into the job's samples/ folder; the trainer fires it
// non-blocking at sample points. Both run on the ComfyUI the job picked (Sample card → ComfyUI).

const fail = (e: any) =>
  NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: e instanceof SampleError ? e.status : 500 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 });
  try {
    const ready = await withComfyUrl(await jobComfyUrl(job), () => checkSampleReady());
    return NextResponse.json({ ok: true, ...ready });
  } catch (e: any) {
    return fail(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 });

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }

  try {
    // the job's ComfyUI and its tied workflow only (a workflow the trainer names is ignored)
    return NextResponse.json(
      await withComfyUrl(await jobComfyUrl(job), () => renderTrainingSamples(job, {
        checkpoint: typeof body.checkpoint === 'string' && body.checkpoint ? body.checkpoint : null,
        base: body.base === true,
        step: body.step,
        prompts: Array.isArray(body.prompts) ? body.prompts : undefined,
        strength: body.strength ?? undefined,
        seed: body.seed ?? undefined,
        timeoutMin: body.timeoutMin,
      })),
    );
  } catch (e: any) {
    return fail(e);
  }
}
