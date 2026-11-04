import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import path from 'path';
import fs from 'fs';
import { jobFolder as findJobFolder } from '@/server/compare';
import { META_DIR } from '@/server/jobFolders';

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // its own folder, or where its checkpoints were moved (dual build)
  const jobFolder = await findJobFolder(job);

  try {
    await fs.promises.access(jobFolder);
  } catch {
    return NextResponse.json({ files: [] });
  }

  // find all safetensors files in the job folder
  let files = (await fs.promises.readdir(jobFolder))
    .filter(file => {
      return file.endsWith('.safetensors');
    })
    .map(file => {
      return path.join(jobFolder, file);
    })
    .sort();

  // get the file size for each file (stat all in parallel)
  const fileObjects = await Promise.all(
    files.map(async file => {
      const stats = await fs.promises.stat(file);
      return {
        path: file,
        size: stats.size,
      };
    }),
  );

  // include the optimizer state if it exists
  const optimizerPath = path.join(jobFolder, META_DIR, 'optimizer.pt');
  try {
    const stats = await fs.promises.stat(optimizerPath);
    fileObjects.push({
      path: optimizerPath,
      size: stats.size,
    });
  } catch {
    // no optimizer state present, skip it
  }

  return NextResponse.json({ files: fileObjects });
}
