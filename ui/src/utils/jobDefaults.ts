'use client';

// DUAL BUILD: per-model saved job defaults ("Save as model default" on the new
// job page) and the default model new jobs open on (Settings).
//
// A saved default is the job's process config minus the per-job fields below,
// stored per arch. Applying one overlays it on the job; "Reset to OEM default"
// rebuilds the job from the built-in defaults for that arch.
import { useCallback, useEffect, useState } from 'react';
import { JobConfig } from '@/types';
import { ModelArch } from '@/app/jobs/new/options';
import { handleModelArchChange } from '@/app/jobs/new/utils';
import { defaultJobConfig, migrateJobConfig } from '@/app/jobs/new/jobConfig';
import { objectCopy } from '@/utils/basic';
import { setNestedValue } from '@/utils/hooks';
import { apiClient } from '@/utils/api';

export type SavedJobDefault = { process: { [key: string]: any }; gpu_ids?: string | null };
export type SavedJobDefaults = { [arch: string]: SavedJobDefault };

// fields that change every job (or are set by the app) and are never saved
const PER_JOB_KEYS = ['datasets', 'trigger_word', 'training_folder', 'sqlite_db_path', 'device', 'performance_log_every'];

const perJobFields = (process: { [key: string]: any }) => {
  const kept: { [key: string]: any } = {};
  for (const key of PER_JOB_KEYS) {
    if (key in process) kept[key] = objectCopy(process[key]);
  }
  return kept;
};

export const extractJobDefault = (jobConfig: JobConfig, gpuIDs: string | null): SavedJobDefault => {
  const process: { [key: string]: any } = objectCopy(jobConfig.config.process[0]);
  for (const key of PER_JOB_KEYS) delete process[key];
  return { process, gpu_ids: gpuIDs };
};

// overlay a saved default on a job, keeping the job's own per-job fields
export const applyJobDefault = (jobConfig: JobConfig, saved: SavedJobDefault): JobConfig => {
  const next = objectCopy(jobConfig);
  const current = next.config.process[0] as any;
  next.config.process[0] = { ...current, ...objectCopy(saved.process), ...perJobFields(current) };
  return next;
};

// the job as it would be with only the built-in (OEM) defaults for `arch`,
// keeping the job's name and per-job fields
export const oemJobForArch = (modelArchs: ModelArch[], jobConfig: JobConfig, arch: string): JobConfig => {
  let next: JobConfig = objectCopy(migrateJobConfig(objectCopy(defaultJobConfig)));
  next.config.name = jobConfig.config.name;
  next.config.process[0] = { ...next.config.process[0], ...perJobFields(jobConfig.config.process[0] as any) };
  const set = (value: any, path?: string) => {
    next = path === undefined ? value : setNestedValue(next, value, path);
  };
  handleModelArchChange(modelArchs, next.config.process[0].model.arch, arch, objectCopy(next), set);
  return next;
};

export const useJobDefaults = () => {
  const [defaults, setDefaults] = useState<SavedJobDefaults>({});
  const [isLoaded, setIsLoaded] = useState(false);

  const refresh = useCallback(() => {
    return apiClient
      .get('/api/job_defaults')
      .then(res => setDefaults(res.data?.defaults ?? {}))
      .catch(error => console.error('Error fetching job defaults:', error))
      .finally(() => setIsLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async (arch: string, saved: SavedJobDefault) => {
    await apiClient.post('/api/job_defaults', { arch, ...saved });
    await refresh();
  };

  const remove = async (arch: string) => {
    await apiClient.delete(`/api/job_defaults?arch=${encodeURIComponent(arch)}`);
    await refresh();
  };

  return { defaults, isLoaded, save, remove };
};
