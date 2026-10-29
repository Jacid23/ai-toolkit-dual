import { JobConfig } from '@/types';
import { Job } from '@prisma/client';
import { apiClient } from '@/utils/api';

export const startJob = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/start`)
      .then(res => res.data)
      .then(data => {
        console.log('Job started:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error starting job:', error);
        reject(error);
      });
  });
};

export const stopJob = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/stop`)
      .then(res => res.data)
      .then(data => {
        console.log('Job stopped:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error stopping job:', error);
        reject(error);
      });
  });
};

export const deleteJob = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/delete`)
      .then(res => res.data)
      .then(data => {
        console.log('Job deleted:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error deleting job:', error);
        reject(error);
      });
  });
};

export const saveJobNow = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/save_now`)
      .then(res => res.data)
      .then(data => {
        console.log('Job set to save on next step:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error setting job to save on next step:', error);
        reject(error);
      });
  });
};

export const stopJobAtCheckpoint = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/stop_at_checkpoint`)
      .then(res => res.data)
      .then(data => {
        console.log('Job set to stop after next checkpoint:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error setting job to stop at checkpoint:', error);
        reject(error);
      });
  });
};

export const sampleJobNow = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/sample_now`)
      .then(res => res.data)
      .then(data => {
        console.log('Job set to sample on next step:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error setting job to sample on next step:', error);
        reject(error);
      });
  });
};

export const markJobAsStopped = (jobID: string) => {
  return new Promise<void>((resolve, reject) => {
    apiClient
      .get(`/api/jobs/${jobID}/mark_stopped`)
      .then(res => res.data)
      .then(data => {
        console.log('Job marked as stopped:', data);
        resolve();
      })
      .catch(error => {
        console.error('Error marking job as stopped:', error);
        reject(error);
      });
  });
};

export const getJobConfig = (job: Job) => {
  return JSON.parse(job.job_config) as JobConfig;
};

export const getAvaliableJobActions = (job: Job) => {
  const jobConfig = getJobConfig(job);
  const isStopping = job.stop && job.status === 'running';
  const canDelete = ['queued', 'completed', 'stopped', 'error'].includes(job.status) && !isStopping;
  let canEdit = ['queued', 'completed', 'stopped', 'error'].includes(job.status) && !isStopping;
  const canRemoveFromQueue = job.status === 'queued';
  const canStop = job.status === 'running' && !isStopping;
  let canStart = ['stopped', 'error'].includes(job.status) && !isStopping;
  // can resume if more steps were added
  if (job.status === 'completed' && (jobConfig.config.process[0].train?.steps || 0) > job.step && !isStopping) {
    canStart = true;
  }
  return { canDelete, canEdit, canStop, canStart, canRemoveFromQueue };
};

export const getNumberOfSamples = (job: Job) => {
  const jobConfig = getJobConfig(job);
  return jobConfig.config.process[0].sample?.prompts?.length || 0;
};

export const getTotalSteps = (job: Job) => {
  if (job.total_steps != null) {
    return job.total_steps;
  }
  const jobConfig = getJobConfig(job);
  return jobConfig.config.process[0].train?.steps || 0;
};

// The steps at which this job saves a checkpoint (a sample follows each). Uses the
// explicit save_schedule when set, otherwise every-N gated by save_start_step.
// Sorted, de-duped, clamped to totalSteps, and capped so a tiny save_every can't
// generate thousands of entries for the queue-page ticks.
export const getSavePoints = (job: Job, totalSteps?: number): number[] => {
  const total = totalSteps ?? getTotalSteps(job);
  let save: any;
  try {
    save = getJobConfig(job).config.process[0].save;
  } catch {
    return [];
  }
  if (!save) return [];
  const set = new Set<number>();
  if (Array.isArray(save.save_schedule) && save.save_schedule.length > 0) {
    for (const s of save.save_schedule) {
      const n = Number(s);
      if (Number.isFinite(n) && n > 0 && (!total || n <= total)) set.add(n);
    }
  } else if (save.save_every && save.save_every > 0) {
    const every = Number(save.save_every);
    const start = Math.max(every, Number(save.save_start_step) || 0);
    const limit = total || every * 500;
    for (let s = Math.ceil(start / every) * every; s <= limit && set.size < 500; s += every) {
      if (s > 0) set.add(s);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
};
