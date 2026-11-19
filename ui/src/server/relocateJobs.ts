// DUAL BUILD: find trainings whose folder was moved (in Explorer, to another group or drive) and
// point their jobs at the new place. A job folder is <save location>\<job name>; every one that ran
// has config\.job_config.json carrying "aitk_job_id", so a folder is matched to its job by id, never
// by guessing from names. Relocating a job rewrites its save location (and its name, when the
// folder was renamed too) and the paths Compare keeps of its LoRAs.
import path from 'path';
import fs from 'fs';
import { Job, Prisma } from '@prisma/client';
import prisma from '@/server/prisma';
import { clearRootsCache, jobOutputFolder, META_DIR } from '@/server/jobFolders';

export const BUSY = ['running', 'queued', 'stopping'];
const SKIP = new Set([
  META_DIR,
  'samples',
  'logs',
  'node_modules',
  '.git',
  '$recycle.bin',
  'system volume information',
]);
const MAX_DEPTH = 6;

// the job id a job folder records, null when it isn't one
async function jobIdIn(folder: string): Promise<string | null> {
  const raw = await fs.promises.readFile(path.join(folder, META_DIR, '.job_config.json'), 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    const id = JSON.parse(raw)?.aitk_job_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

// every job folder under the roots (a root may itself be one): job id -> folders. A job folder
// isn't searched further, so its samples and LoRAs are never listed.
export async function findJobFolders(roots: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const seen = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const id = await jobIdIn(dir);
    if (id) {
      found.set(id, [...(found.get(id) ?? []), path.resolve(dir)]);
      return;
    }
    if (depth >= MAX_DEPTH) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter(e => e.isDirectory() && !SKIP.has(e.name.toLowerCase()))
        .map(e => walk(path.join(dir, e.name), depth + 1)),
    );
  };
  for (const r of roots) await walk(r, 0);
  return found;
}

export const folderExists = (p: string) =>
  fs.promises
    .stat(p)
    .then(s => s.isDirectory())
    .catch(() => false);

// a path under oldFolder, moved under newFolder, with a <oldName>_* / <oldName>.* file renamed too
export const folderMapper = (oldFolder: string, newFolder: string, oldName: string, newName: string) => {
  const renameFile = (f: string) =>
    oldName !== newName && (f.startsWith(oldName + '_') || f.startsWith(oldName + '.'))
      ? newName + f.slice(oldName.length)
      : f;
  const mapPath = (p: string) => {
    if (p === oldFolder) return newFolder;
    if (!p.startsWith(oldFolder + path.sep)) return p;
    const rest = p.slice(oldFolder.length + 1);
    return path.join(newFolder, rest.includes(path.sep) ? rest : renameFile(rest));
  };
  const mapDeep = (v: any): any =>
    typeof v === 'string'
      ? mapPath(v)
      : Array.isArray(v)
        ? v.map(mapDeep)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapDeep(x)]))
          : v;
  return { mapPath, mapDeep, renameFile };
};

// point Compare's saved LoRA and image paths at the job's new folder
export async function remapComparePaths(
  tx: Prisma.TransactionClient,
  oldFolder: string,
  mapPath: (p: string) => string,
  mapDeep: (v: any) => any,
) {
  for (const c of await tx.compareCell.findMany({ where: { lora_path: { startsWith: oldFolder + path.sep } } })) {
    await tx.compareCell.update({
      where: { id: c.id },
      data: { lora_path: mapPath(c.lora_path), image_path: c.image_path ? mapPath(c.image_path) : c.image_path },
    });
  }
  for (const cmp of await tx.comparison.findMany()) {
    if (!cmp.data.includes(JSON.stringify(oldFolder).slice(1, -1))) continue;
    await tx.comparison.update({
      where: { id: cmp.id },
      data: { data: JSON.stringify(mapDeep(JSON.parse(cmp.data))) },
    });
  }
}

export type Relocated = { id: string; name: string; from: string; to: string; renamedTo?: string; error?: string };

// point a job at a folder found for it. A folder renamed in Explorer renames the job (and the
// <old name>_<step> files in it) to match, the way Rename does, but leaves the folder where it is.
export async function relocateJob(job: Job, folder: string): Promise<Relocated> {
  const from = await jobOutputFolder(job);
  const to = path.resolve(folder);
  const out: Relocated = { id: job.id, name: job.name, from, to };
  if (BUSY.includes(job.status)) return { ...out, error: 'running; stop it first' };
  const oldName = job.name;
  const newName = path.basename(to);
  if (newName.toLowerCase() === META_DIR) return { ...out, error: `${to} is a config folder, not a job folder` };
  if (newName !== oldName && (await prisma.job.findUnique({ where: { name: newName } })))
    return { ...out, error: `the folder is named "${newName}" and another job already has that name` };

  const { mapPath, mapDeep, renameFile } = folderMapper(from, to, oldName, newName);
  const failed: string[] = [];
  if (newName !== oldName) {
    for (const f of await fs.promises.readdir(to)) {
      const t = renameFile(f);
      if (t !== f) await fs.promises.rename(path.join(to, f), path.join(to, t)).catch(() => failed.push(f));
    }
    out.renamedTo = newName;
  }

  const cfg = JSON.parse(job.job_config);
  const proc = cfg?.config?.process?.[0];
  if (proc) proc.save_location = path.dirname(to);
  if (cfg?.config) cfg.config.name = newName;
  await prisma.$transaction(async tx => {
    await tx.job.update({
      where: { id: job.id },
      data: { name: newName, job_config: JSON.stringify(cfg), updated_at: job.updated_at },
    });
    await remapComparePaths(tx, from, mapPath, mapDeep);
  });
  clearRootsCache();
  if (failed.length) out.error = `moved, but these files kept the old name: ${failed.join(', ')}`;
  return out;
}
