import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// DUAL BUILD: job tags (the Jobs explorer), kept in the job's config as aitk_tags (beside aitk_job_id;
// the trainer ignores it). POST { ids, set } replaces each job's tags; { ids, add, remove } edits
// them. A job's dates are its history, so tagging doesn't touch updated_at.
const clean = (v: any): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((t: any) => String(t).trim()).filter(Boolean))) : [];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  if (!ids.length) return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  const set = body?.set !== undefined ? clean(body.set) : null;
  const add = clean(body?.add);
  const remove = new Set(clean(body?.remove).map(t => t.toLowerCase()));

  const jobs = await prisma.job.findMany({ where: { id: { in: ids } } });
  for (const job of jobs) {
    const cfg = JSON.parse(job.job_config);
    const had = clean(cfg.aitk_tags);
    let tags = set ?? had;
    for (const t of add) if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags = [...tags, t];
    tags = tags.filter(t => !remove.has(t.toLowerCase()));
    if (tags.length) cfg.aitk_tags = tags;
    else delete cfg.aitk_tags;
    await prisma.job.update({ where: { id: job.id }, data: { job_config: JSON.stringify(cfg), updated_at: job.updated_at } });
  }
  return NextResponse.json({ ok: true, updated: jobs.length });
}
