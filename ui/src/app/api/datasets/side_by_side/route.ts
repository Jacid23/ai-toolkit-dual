import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TOOLKIT_ROOT } from '@/paths';
import { getDatasetsRoot } from '@/server/settings';
import { resolvePythonPath } from '../../../../../cron/pythonPath';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const TIMEOUT_MS = 10 * 60 * 1000;
const BUILDER = path.join(TOOLKIT_ROOT, 'scripts', 'build_dop_side_by_side.py');

interface Subject {
  dataset: string;
  trigger: string;
  sex?: 'auto' | 'man' | 'woman';
  description?: string;
}

// A top-level folder in the datasets root, or null. Names never carry separators or '..'.
const datasetFolder = (root: string, name: unknown): string | null => {
  if (typeof name !== 'string' || !name.trim() || /[\\/]/.test(name) || name.includes('..')) return null;
  return path.join(root, name.trim());
};

// Builds "subject next to a stranger" pictures into a new dataset with scripts/build_dop_side_by_side.py.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const root = await getDatasetsRoot();
  const subjects: Subject[] = Array.isArray(body?.subjects) ? body.subjects : [];
  if (subjects.length === 0) {
    return NextResponse.json({ error: 'Add at least one subject' }, { status: 400 });
  }

  // same cleanup as /api/datasets/create, so the new folder shows up like any other dataset
  const outName = String(body?.output ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!outName) {
    return NextResponse.json({ error: 'Name the output dataset' }, { status: 400 });
  }
  const outFolder = path.join(root, outName);

  const args = ['-u', BUILDER];
  for (const s of subjects) {
    const folder = datasetFolder(root, s?.dataset);
    const trigger = typeof s?.trigger === 'string' ? s.trigger.trim() : '';
    if (!folder || !fs.existsSync(folder)) {
      return NextResponse.json({ error: `Dataset not found: ${s?.dataset ?? ''}` }, { status: 400 });
    }
    if (!trigger) {
      return NextResponse.json({ error: `Give ${s.dataset} its trigger word` }, { status: 400 });
    }
    if (path.resolve(folder) === path.resolve(outFolder)) {
      return NextResponse.json({ error: 'The output must be a different dataset than the subjects' }, { status: 400 });
    }
    args.push('--subject', folder, trigger);
    if (s.sex === 'man' || s.sex === 'woman') args.push('--sex', `${trigger}=${s.sex}`);
    const description = typeof s.description === 'string' ? s.description.trim() : '';
    if (description) args.push('--describe', `${trigger}=${description}`);
  }
  args.push('--out', outFolder);
  if (body?.sameSex !== false) args.push('--same_sex');
  const seed = Number(body?.seed);
  if (Number.isInteger(seed)) args.push('--seed', String(seed));
  const captionExt = typeof body?.captionExt === 'string' ? body.captionExt.replace(/^\.?/, '.') : '.txt';
  args.push('--caption_ext', captionExt);
  const exclude: string[] = Array.isArray(body?.exclude) ? body.exclude : [];
  for (const name of exclude) {
    if (typeof name === 'string' && name.trim()) args.push('--exclude', name.trim());
  }

  const result = await new Promise<{ ok: boolean; log: string; error?: string }>(resolve => {
    const child = spawn(resolvePythonPath(), args, {
      cwd: TOOLKIT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf-8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')));
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, log: stdout, error: err.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      // the builder fails with a Python exception: its last line is the message worth showing
      const lastLine = stderr.trim().split(/\r?\n/).pop() ?? '';
      resolve({
        ok: code === 0,
        log: stdout,
        error: code === 0 ? undefined : lastLine.replace(/^\w+Error: /, '') || `Builder exited with code ${code}`,
      });
    });
  });

  return NextResponse.json({ ...result, name: outName }, { status: result.ok ? 200 : 500 });
}
