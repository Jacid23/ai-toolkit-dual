import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import prisma from '@/server/prisma';
import { TOOLKIT_ROOT } from '@/paths';
import { getModelsPath } from '@/server/settings';
import { resolvePythonPath } from '../../../../../cron/pythonPath';

// DUAL BUILD: the New Job page's "Download model" button. models/hf/_models.json
// (scripts/make_model_folders.py) lists, per model, the itemized files aitk loads and where
// they go; GET reports what's missing, POST downloads it with toolkit/model_fetch.py (the
// same downloader the folders' download.bat files run).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Item = { repo: string; file: string; dest: string; size: number | null };
type ModelEntry = { label: string; repos: string[]; auto: boolean; items: Item[] };

const running = new Map<string, { child: ChildProcess; log: string }>();
const safeName = (arch: string) => arch.replace(/[^A-Za-z0-9_.-]/g, '_');

async function loadIndex(): Promise<{ root: string; models: Record<string, ModelEntry> } | null> {
  const root = await getModelsPath();
  try {
    const raw = JSON.parse(await fs.promises.readFile(path.join(root, 'hf', '_models.json'), 'utf-8'));
    return { root, models: raw.models ?? {} };
  } catch {
    return null;
  }
}

async function missingOf(root: string, items: Item[]) {
  const missing: Item[] = [];
  for (const it of items) {
    const stat = await fs.promises.stat(path.join(root, ...it.dest.split('/'))).catch(() => null);
    if (!stat || (it.size && stat.size !== it.size)) missing.push(it);
  }
  return missing;
}

// last progress line of the downloader's output (tqdm redraws with \r)
async function lastLine(log: string) {
  const raw = await fs.promises.readFile(log, 'utf-8').catch(() => '');
  const lines = raw.slice(-4000).split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

export async function GET(request: NextRequest) {
  const arch = request.nextUrl.searchParams.get('arch') || '';
  const index = await loadIndex();
  if (!index) return NextResponse.json({ known: false, reason: 'no-index' });
  const entry = index.models[arch];
  if (!entry || !entry.items?.length) return NextResponse.json({ known: false, auto: !!entry?.auto });
  const missing = await missingOf(index.root, entry.items);
  const run = running.get(arch);
  const log = path.join(index.root, 'hf', '.logs', `${safeName(arch)}.log`);
  return NextResponse.json({
    known: true,
    auto: entry.auto,
    total: entry.items.reduce((a, i) => a + (i.size || 0), 0),
    files: entry.items.length,
    missing: missing.length,
    missingBytes: missing.reduce((a, i) => a + (i.size || 0), 0),
    running: !!run,
    progress: run || fs.existsSync(log) ? await lastLine(log) : '',
  });
}

export async function POST(request: NextRequest) {
  const { arch } = await request.json().catch(() => ({}));
  if (typeof arch !== 'string' || !arch) return NextResponse.json({ error: 'arch required' }, { status: 400 });
  if (running.has(arch)) return NextResponse.json({ ok: true, running: true });
  const index = await loadIndex();
  const entry = index?.models[arch];
  if (!index || !entry?.items?.length) {
    return NextResponse.json({ error: 'No download list for this model (run scripts/make_model_folders.py)' }, { status: 404 });
  }

  const logs = path.join(index.root, 'hf', '.logs');
  await fs.promises.mkdir(logs, { recursive: true });
  const manifest = path.join(logs, `${safeName(arch)}.json`);
  await fs.promises.writeFile(
    manifest,
    JSON.stringify({ title: entry.label, models_root: index.root, items: entry.items }, null, 1),
    'utf-8',
  );
  const log = path.join(logs, `${safeName(arch)}.log`);
  const out = fs.openSync(log, 'w');

  const token = (await prisma.settings.findFirst({ where: { key: 'HF_TOKEN' } }))?.value?.trim();
  const child = spawn(resolvePythonPath(), ['-u', path.join(TOOLKIT_ROOT, 'toolkit', 'model_fetch.py'), manifest], {
    cwd: TOOLKIT_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...(token ? { HF_TOKEN: token } : {}) },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  running.set(arch, { child, log });
  const done = () => {
    running.delete(arch);
    try {
      fs.closeSync(out);
    } catch {}
  };
  child.on('exit', done);
  child.on('error', done);
  return NextResponse.json({ ok: true, running: true });
}
