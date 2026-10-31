import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { getDatasetsRoot } from '@/server/settings';
import { promptOrderBy } from '@/server/promptLinks';

// DUAL BUILD: link a dataset to a prompt group so New Job auto-fills its sample
// prompts. The link lives in a .aitk_prompts.json inside the dataset folder, so
// it travels with the dataset (no DB migration).
const LINK_FILE = '.aitk_prompts.json';

// Resolve a dataset (bare name or a folder path whose basename is the name) to a
// direct child of the datasets root; rejects traversal and the root itself.
async function resolveFolder(datasetName: string): Promise<string | null> {
  if (typeof datasetName !== 'string' || !datasetName.trim()) return null;
  const root = path.resolve(await getDatasetsRoot());
  const name = path.basename(datasetName.trim());
  const folder = path.resolve(root, name);
  if (path.dirname(folder) !== root || folder === root) return null;
  return folder;
}

export async function GET(request: NextRequest) {
  const folder = await resolveFolder(request.nextUrl.searchParams.get('datasetName') || '');
  if (!folder) return NextResponse.json({ error: 'Invalid dataset' }, { status: 400 });
  let group = '';
  try {
    group = String(JSON.parse(await fs.promises.readFile(path.join(folder, LINK_FILE), 'utf-8'))?.group || '');
  } catch {
    group = '';
  }
  let prompts: { name: string; text: string }[] = [];
  if (group) {
    const rows = await prisma.savedPrompt.findMany({ where: { group } as any, orderBy: promptOrderBy });
    prompts = rows.map((r: any) => ({ name: r.name, text: r.text }));
  }
  return NextResponse.json({ group, prompts });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const folder = await resolveFolder(body?.datasetName || '');
  if (!folder) return NextResponse.json({ error: 'Invalid dataset' }, { status: 400 });
  const group = String(body?.group || '').trim();
  try {
    await fs.promises.access(folder);
    if (group) {
      await fs.promises.writeFile(path.join(folder, LINK_FILE), JSON.stringify({ group }, null, 2), 'utf-8');
    } else {
      await fs.promises.unlink(path.join(folder, LINK_FILE)).catch(() => {});
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to set link' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, group });
}
