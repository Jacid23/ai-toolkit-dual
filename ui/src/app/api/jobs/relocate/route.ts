import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import prisma from '@/server/prisma';
import { jobOutputFolder, outputRoots } from '@/server/jobFolders';
import { BUSY, findJobFolders, folderExists, relocateJob, Relocated } from '@/server/relocateJobs';

// DUAL BUILD: fix trainings whose folder was moved.
//   POST {}                    rescan: search the Training Folder and every save location for the
//                              folders of jobs that lost theirs, and point each job at its folder
//   POST { jobId, folder }     locate: search that folder (it can be the job folder itself or any
//                              folder above it) for this job's folder
// Folders are matched to jobs by the id in config\.job_config.json. A job found in two places is
// left alone and reported, so a copy is never picked by guess.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  const folder = typeof body?.folder === 'string' ? body.folder.trim().replace(/^"|"$/g, '') : '';

  if (jobId) {
    if (!folder || !path.isAbsolute(folder))
      return NextResponse.json({ error: 'Use a full folder path' }, { status: 400 });
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (BUSY.includes(job.status)) return NextResponse.json({ error: 'Stop the job first' }, { status: 409 });
    if (!(await folderExists(folder))) return NextResponse.json({ error: `${folder} doesn't exist` }, { status: 404 });
    const hits = (await findJobFolders([folder])).get(job.id) ?? [];
    if (hits.length === 0)
      return NextResponse.json({ error: `No folder of ${job.name} in ${folder}` }, { status: 404 });
    if (hits.length > 1)
      return NextResponse.json(
        { error: `${job.name} is in more than one folder:\n${hits.join('\n')}` },
        { status: 409 },
      );
    const r = await relocateJob(job, hits[0]);
    return NextResponse.json({ fixed: r.error && !r.renamedTo ? [] : [r], failed: r.error ? [r] : [] });
  }

  // rescan: every training whose folder is gone
  const jobs = await prisma.job.findMany({ where: { job_type: 'train' } });
  const lost: typeof jobs = [];
  for (const j of jobs) if (!BUSY.includes(j.status) && !(await folderExists(await jobOutputFolder(j)))) lost.push(j);
  if (!lost.length) return NextResponse.json({ fixed: [], failed: [], notFound: [], ambiguous: [] });

  const found = await findJobFolders(await outputRoots());
  const fixed: Relocated[] = [];
  const failed: Relocated[] = [];
  const notFound: string[] = [];
  const ambiguous: { name: string; folders: string[] }[] = [];
  for (const j of lost) {
    const hits = found.get(j.id) ?? [];
    if (hits.length === 0) notFound.push(j.name);
    else if (hits.length > 1) ambiguous.push({ name: j.name, folders: hits });
    else {
      const r = await relocateJob(j, hits[0]);
      if (r.error) failed.push(r);
      if (!r.error || r.renamedTo) fixed.push(r);
    }
  }
  return NextResponse.json({ fixed, failed, notFound, ambiguous });
}
