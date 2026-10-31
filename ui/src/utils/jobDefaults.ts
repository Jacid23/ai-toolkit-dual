'use client';

// DUAL BUILD: per-model saved job defaults ("Save as model default" on the new
// job page) and the default model new jobs open on (Settings).
//
// A saved default is the job's process config minus the per-job fields below
// (dataset, sample prompts, save/sample schedules), stored per arch. Applying one overlays it on the job; "Reset to OEM default"
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

// per-job fields inside a section: sample prompts and the custom save/sample step lists
const PER_JOB_NESTED: [string, string][] = [
  ['sample', 'samples'],
  ['sample', 'sample_schedule'],
  ['save', 'save_schedule'],
];

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
  for (const [section, key] of PER_JOB_NESTED) delete process[section]?.[key];
  return { process, gpu_ids: gpuIDs };
};

// overlay a saved default on a job, keeping the job's own per-job fields
export const applyJobDefault = (jobConfig: JobConfig, saved: SavedJobDefault): JobConfig => {
  const next = objectCopy(jobConfig);
  const current = next.config.process[0] as any;
  const overlay: { [key: string]: any } = objectCopy(saved.process);
  for (const [section, key] of PER_JOB_NESTED) {
    // older saved defaults may still hold these; the job keeps its own
    if (!overlay[section]) continue;
    delete overlay[section][key];
    if (current[section] && key in current[section]) overlay[section][key] = objectCopy(current[section][key]);
  }
  next.config.process[0] = { ...current, ...overlay, ...perJobFields(current) };
  return next;
};

// a new job starts with no dataset, no sample prompts and no custom save/sample steps
export const blankPerJobFields = (jobConfig: JobConfig): JobConfig => {
  const next = objectCopy(jobConfig);
  const proc = next.config.process[0] as any;
  for (const d of proc.datasets ?? []) d.folder_path = '';
  if (proc.sample) {
    proc.sample.samples = [];
    proc.sample.sample_schedule = [];
  }
  if (proc.save) proc.save.save_schedule = [];
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
  const proc = next.config.process[0] as any;
  const current = jobConfig.config.process[0] as any;
  for (const [section, key] of PER_JOB_NESTED) {
    if (proc[section] && current[section] && key in current[section]) proc[section][key] = objectCopy(current[section][key]);
  }
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
