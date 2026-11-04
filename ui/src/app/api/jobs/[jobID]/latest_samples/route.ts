import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import prisma from '@/server/prisma';
import { jobSamples } from '@/server/jobSamples';
import { jobSamplePrompts } from '@/server/comfySamples';
import { jobOutputFolder } from '@/server/jobFolders';

// DUAL BUILD: the job's latest sample set for the Jobs list preview: the newest sampled step
// (the step-0 baseline only when nothing else is sampled), the newest image of each prompt at it.
// newerUnsampled: a LoRA newer than that step has no samples yet.
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const all = await jobSamples(job);
  const steps = Array.from(new Set(all.map(s => s.step)));
  const trained = steps.filter(s => s > 0);
  const step = trained.length ? Math.max(...trained) : steps.length ? 0 : null;
  if (step === null) return NextResponse.json({ step: null, samples: [] });

  const newest = new Map<number, (typeof all)[number]>();
  for (const s of all) if (s.step === step && (!newest.has(s.idx) || s.ts > newest.get(s.idx)!.ts)) newest.set(s.idx, s);
  const prompts = jobSamplePrompts(job);

  // the newest LoRA's step: its _<step> in the name, the final save = the job's total steps
  let total = 0;
  try {
    total = Number(JSON.parse(job.job_config)?.config?.process?.[0]?.train?.steps) || 0;
  } catch {}
  const names = await fs.promises.readdir(await jobOutputFolder(job)).catch(() => [] as string[]);
  let lastLora = 0;
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.safetensors')) continue;
    const m = n.match(/_(\d+)\.safetensors$/i);
    lastLora = Math.max(lastLora, m ? parseInt(m[1], 10) : n === `${job.name}.safetensors` ? total : 0);
  }

  return NextResponse.json({
    step,
    final: job.status === 'completed' && total > 0 && step >= total,
    newerUnsampled: lastLora > step,
    samples: Array.from(newest.values())
      .sort((a, b) => a.idx - b.idx)
      .map(s => ({ idx: s.idx, path: s.path, prompt: prompts[s.idx] ?? '' })),
  });
}
