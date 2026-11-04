import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { jobRootOf } from '@/server/jobFolders';

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
  const mapPath = (p: string) => {
    if (p === oldFolder) return newFolder;
    if (!p.startsWith(oldFolder + path.sep)) return p;
    const rest = p.slice(oldFolder.length + 1);
    const renamed = !rest.includes(path.sep) && (rest.startsWith(old + '_') || rest.startsWith(old + '.')) ? name + rest.slice(old.length) : rest;
    return path.join(newFolder, renamed);
  };
  const mapDeep = (v: any): any =>
    typeof v === 'string' ? mapPath(v) : Array.isArray(v) ? v.map(mapDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapDeep(x)])) : v;

  const cfg = JSON.parse(job.job_config);
  if (cfg?.config) cfg.config.name = name;
  await prisma.$transaction(async tx => {
    await tx.job.update({ where: { id: jobID }, data: { name, job_config: JSON.stringify(cfg), updated_at: job.updated_at } });
    for (const c of await tx.compareCell.findMany({ where: { lora_path: { startsWith: oldFolder + path.sep } } })) {
      await tx.compareCell.update({
        where: { id: c.id },
        data: { lora_path: mapPath(c.lora_path), image_path: c.image_path ? mapPath(c.image_path) : c.image_path },
      });
    }
    for (const cmp of await tx.comparison.findMany()) {
      if (!cmp.data.includes(JSON.stringify(oldFolder).slice(1, -1))) continue;
      await tx.comparison.update({ where: { id: cmp.id }, data: { data: JSON.stringify(mapDeep(JSON.parse(cmp.data))) } });
    }
  });

  return NextResponse.json({
    ok: true,
    name,
    folder: hasFolder ? newFolder : null,
    ...(failed.length ? { error: `Renamed, but these files kept the old name: ${failed.join(', ')}` } : {}),
  });
}
