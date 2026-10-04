import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // DUAL BUILD: Play starts the job now when nothing is running on its GPUs
  // (any overlapping set, so a split job blocks both single-GPU queues and
  // vice versa); otherwise it is queued behind the busy job as before.
  const jobGpuIds = job.gpu_ids.split(',').map(s => s.trim());
  const activeJobs = await prisma.job.findMany({
    where: { status: { in: ['running', 'stopping'] } },
  });
  const gpusBusy = activeJobs.some(
    other => other.id !== job.id && other.gpu_ids.split(',').some(id => jobGpuIds.includes(id.trim())),
  );

  let newQueuePosition: number;
  if (gpusBusy) {
    // get highest queue position
    const highestQueuePosition = await prisma.job.aggregate({
      _max: {
        queue_position: true,
      },
    });
    newQueuePosition = (highestQueuePosition._max.queue_position || 0) + 1000;
  } else {
    // idle: put this job at the front so the queue starts it, not an older one
    const lowestQueuePosition = await prisma.job.aggregate({
      _min: {
        queue_position: true,
      },
    });
    newQueuePosition = (lowestQueuePosition._min.queue_position || 0) - 1000;
  }

  await prisma.job.update({
    where: { id: jobID },
    data: { queue_position: newQueuePosition },
  });

  // make sure the queue is running
  const queue = await prisma.queue.findFirst({
    where: {
      gpu_ids: job.gpu_ids,
    },
  });

  // if queue doesn't exist, create it; when the GPUs are idle, switch it on
  // so the worker starts this job on its next pass
  if (!queue) {
    await prisma.queue.create({
      data: {
        gpu_ids: job.gpu_ids,
        is_running: !gpusBusy,
      },
    });
  } else if (!gpusBusy && !queue.is_running) {
    await prisma.queue.update({
      where: { id: queue.id },
      data: { is_running: true },
    });
  }

  await prisma.job.update({
    where: { id: jobID },
    data: {
      status: 'queued',
      stop: false,
      return_to_queue: false,
      info: 'Job queued',
    },
  });

  // Return the response immediately
  return NextResponse.json(job);
}
