import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { jobRootOf } from '@/server/jobFolders';
import { folderMapper, remapComparePaths } from '@/server/relocateJobs';

// DUAL BUILD: POST { name } → rename a training that isn't running: its folder, every
// <name>[_<step>].<ext> in it (LoRAs, thumbnails), the job, and the paths Compare keeps of its LoRAs.
// The folder goes first, so a file another program holds open stops it before anything changed.
const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/;

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || BAD_NAME.test(name) || /[. ]$/.test(name) || name === 'config')
    return NextResponse.json({ error: 'Not a usable folder name' }, { status: 400 });

  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (['running', 'queued', 'stopping'].includes(job.status))
    return NextResponse.json({ error: 'Stop the job before renaming it' }, { status: 409 });
  const old = job.name;
  if (name === old) return NextResponse.json({ ok: true, name });
  if (await prisma.job.findUnique({ where: { name } }))
    return NextResponse.json({ error: `A job named "${name}" already exists` }, { status: 409 });

  const root = await jobRootOf(job);
  const oldFolder = path.join(root, old);
  const newFolder = path.join(root, name);
  const hasFolder = await fs.promises
    .stat(oldFolder)
    .then(s => s.isDirectory())
    .catch(() => false);
  if (hasFolder) {
    if (await fs.promises.access(newFolder).then(() => true, () => false))
      return NextResponse.json({ error: `${newFolder} already exists` }, { status: 409 });
    try {
      await fs.promises.rename(oldFolder, newFolder);
    } catch (e: any) {
      return NextResponse.json(
        { error: `Couldn't rename the folder (is a file in it open in another program?): ${e?.message ?? e}` },
        { status: 500 },
      );
    }
  }

  // <old>.safetensors, <old>_<step>.safetensors, their .webp thumbnails, any other <old>_* / <old>.* file
  const failed: string[] = [];
  if (hasFolder) {
    for (const f of await fs.promises.readdir(newFolder)) {
      if (!(f.startsWith(old + '_') || f.startsWith(old + '.'))) continue;
      const to = name + f.slice(old.length);
      await fs.promises.rename(path.join(newFolder, f), path.join(newFolder, to)).catch(() => failed.push(f));
    }
  }

  // a path under the old folder, with the file's own <old> prefix renamed too
  const { mapPath, mapDeep } = folderMapper(oldFolder, newFolder, old, name);

  const cfg = JSON.parse(job.job_config);
  if (cfg?.config) cfg.config.name = name;
  await prisma.$transaction(async tx => {
    await tx.job.update({ where: { id: jobID }, data: { name, job_config: JSON.stringify(cfg), updated_at: job.updated_at } });
    await remapComparePaths(tx, oldFolder, mapPath, mapDeep);
  });

  return NextResponse.json({
    ok: true,
    name,
    folder: hasFolder ? newFolder : null,
    ...(failed.length ? { error: `Renamed, but these files kept the old name: ${failed.join(', ')}` } : {}),
  });
}
