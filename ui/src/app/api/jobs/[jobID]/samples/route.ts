import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { getTrainingFolder } from '@/server/settings';

// <time>__<step 9 digits>_<idx>.<ext>: order by step, then time, then prompt index, so samples
// rendered later for an earlier step (ComfyUI backfill) land with that step
const sampleSortKey = (file: string) => {
  const m = file.match(/^(\d+)__(\d+)_(\d+)\./);
  if (!m) return file;
  return `${m[2].padStart(12, '0')}_${m[1].padStart(15, '0')}_${m[3].padStart(5, '0')}`;
};

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // setup the training
  const trainingFolder = await getTrainingFolder();

  const samplesFolder = path.join(trainingFolder, job.name, 'samples');
  try {
    await fs.promises.access(samplesFolder);
  } catch {
    return NextResponse.json({ samples: [] });
  }

  // find all img (png, jpg, jpeg) files in the samples folder. Thumbnails
  // live in the hidden .thumbs subfolder (and partial writes in .tmp) — the
  // isFile check keeps those directories out even if their names ever match.
  const names = (await fs.promises.readdir(samplesFolder, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
  const isMedia = (file: string) =>
    file.endsWith('.png') ||
    file.endsWith('.jpg') ||
    file.endsWith('.jpeg') ||
    file.endsWith('.webp') ||
    file.endsWith('.mp4') ||
    file.endsWith('mp3');
  const mediaStems = new Set(names.filter(isMedia).map(file => file.slice(0, file.lastIndexOf('.'))));
  const sorted = names
    .filter(file => {
      if (isMedia(file)) return true;
      // text samples (LLM models); a .txt next to a media sample is its prompt sidecar, not a sample
      return file.endsWith('.txt') && !mediaStems.has(file.slice(0, -4));
    })
    .sort((a, b) => sampleSortKey(a).localeCompare(sampleSortKey(b)));
  // within a step, lay files out as rows of prompt slots: the n-th image of each prompt index
  // goes in row n, so one image re-rendered later still sits in its own slot of the row
  const slotted = sorted.map((file, order) => ({ file, order, step: '', row: 0, idx: 0 }));
  const seen = new Map<string, number>();
  for (const s of slotted) {
    const m = s.file.match(/^\d+__(\d+)_(\d+)\./);
    if (!m) continue;
    s.step = m[1];
    s.idx = parseInt(m[2], 10);
    const k = `${m[1]}:${m[2]}`;
    s.row = seen.get(k) ?? 0;
    seen.set(k, s.row + 1);
  }
  const samples = slotted
    .sort((a, b) =>
      a.step && b.step && a.step === b.step ? a.row - b.row || a.idx - b.idx || a.order - b.order : a.order - b.order,
    )
    .map(s => path.join(samplesFolder, s.file));

  return NextResponse.json({ samples });
}
