import { NextResponse } from 'next/server';
import fs from 'fs';
import prisma from '@/server/prisma';
import { cfgFromJobConfig, jobFolder } from '@/server/compare';

// AITK trainings for the "Add training" picker, with how many LoRAs their folder holds
export async function GET() {
  try {
    const jobs = await prisma.job.findMany({
      where: { job_type: 'train' },
      select: { id: true, name: true, status: true, job_config: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
    });
    const out = await Promise.all(
      jobs.map(async job => {
        const folder = await jobFolder(job);
        const count = await fs.promises
          .readdir(folder)
          .then(f => f.filter(n => n.toLowerCase().endsWith('.safetensors')).length)
          .catch(() => 0);
        let cfg = null;
        try {
          cfg = cfgFromJobConfig(JSON.parse(job.job_config));
        } catch {}
        return { id: job.id, name: job.name, status: job.status, folder, count, cfg };
      }),
    );
    return NextResponse.json({ jobs: out });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to list trainings' }, { status: 500 });
  }
}
