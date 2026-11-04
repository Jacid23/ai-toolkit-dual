import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { jobOutputFolder } from '@/server/jobFolders';
import path from 'path';
import fs from 'fs';

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const trainingFolder = await jobOutputFolder(job);

  // force:true makes this a no-op if the folder is already gone
  await fs.promises.rm(trainingFolder, { recursive: true, force: true });

  await prisma.job.delete({
    where: { id: jobID },
  });

  return NextResponse.json(job);
}
