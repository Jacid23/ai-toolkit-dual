import prisma from '../prisma';

import { Job, Queue } from '@prisma/client';
import startJob from './startJob';

// dual-GPU build: a job started with gpu_ids "0,1" (split) occupies both
// single-GPU queues, and vice versa - queues must not start jobs on a GPU
// that an overlapping job is already using.
const gpuIdsOverlap = (a: string, b: string): boolean => {
  const aIds = a.split(',').map(s => s.trim());
  const bIds = b.split(',').map(s => s.trim());
  return aIds.some(id => bIds.includes(id));
};

export default async function processQueue() {
  const queues: Queue[] = await prisma.queue.findMany({
    orderBy: {
      id: 'asc',
    },
  });

  for (const queue of queues) {
    if (!queue.is_running) {
      // stop any running jobs first
      const runningJobs: Job[] = await prisma.job.findMany({
        where: {
          status: 'running',
          gpu_ids: queue.gpu_ids,
        },
      });

      for (const job of runningJobs) {
        console.log(`Stopping job ${job.id} on GPU(s) ${job.gpu_ids}`);
        await prisma.job.update({
          where: { id: job.id },
          data: {
            return_to_queue: true,
            info: 'Stopping job...',
          },
        });
      }
    }
    if (queue.is_running) {
      // first see if one is already running, status of running or stopping,
      // on this queue's GPUs or any overlapping set (split jobs)
      const activeJobs: Job[] = await prisma.job.findMany({
        where: {
          status: { in: ['running', 'stopping'] },
        },
      });
      const runningJob: Job | null = activeJobs.find(job => gpuIdsOverlap(job.gpu_ids, queue.gpu_ids)) ?? null;

      if (runningJob) {
        // already running, nothing to do
        continue; // skip to next queue
      } else {
        // find the next job in the queue
        const nextJob: Job | null = await prisma.job.findFirst({
          where: {
            status: 'queued',
            gpu_ids: queue.gpu_ids,
          },
          orderBy: {
            queue_position: 'asc',
          },
        });
        if (nextJob) {
          console.log(`Starting job ${nextJob.id} on GPU(s) ${nextJob.gpu_ids}`);
          await startJob(nextJob.id);
        } else {
          // no more jobs, stop the queue
          console.log(`No more jobs in queue for GPU(s) ${queue.gpu_ids}, stopping queue`);
          await prisma.queue.update({
            where: { id: queue.id },
            data: { is_running: false },
          });
        }
      }
    }
  }
}
