'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/utils/api';

// DUAL BUILD: per-dataset sample prompts. The dataset page picks which prompt group belongs
// to the dataset (saved into the dataset folder); New Job loads that group's prompts into the
// job's sample prompts whenever the dataset is picked.

const datasetNameOf = (folderPath: string) =>
  folderPath ? folderPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '' : '';

// dataset page: choose the dataset's sample-prompt group
export default function DatasetPromptGroup({ datasetName }: { datasetName: string }) {
  const [groups, setGroups] = useState<string[]>([]);
  const [group, setGroup] = useState<string>('');

  useEffect(() => {
    apiClient
      .get('/api/prompts')
      .then(r => {
        const gs = Array.from(
          new Set((r.data?.prompts ?? []).map((p: any) => (p.group || '').trim()).filter(Boolean)),
        ).sort();
        setGroups(gs as string[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!datasetName) return;
    apiClient
      .get(`/api/datasets/prompt_link?datasetName=${encodeURIComponent(datasetName)}`)
      .then(r => setGroup(r.data?.group || ''))
      .catch(() => {});
  }, [datasetName]);

  const changeGroup = (g: string) => {
    setGroup(g);
    apiClient.post('/api/datasets/prompt_link', { datasetName, group: g }).catch(() => {});
  };

  const options = group && !groups.includes(group) ? [...groups, group] : groups;

  return (
    <div className="flex items-center gap-1">
      <label className="text-xs text-gray-400 hidden sm:inline whitespace-nowrap">Sample prompts</label>
      <select
        value={group}
        onChange={e => changeGroup(e.target.value)}
        title="Prompt group New Job uses as this dataset's sample prompts"
        className="bg-gray-800 border border-gray-700 rounded-md text-sm px-2 py-1 max-w-[200px]"
      >
        <option value="">None</option>
        {options.map(g => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </div>
  );
}

// New Job: load the picked dataset's prompts into the job's samples
export function DatasetPromptAutoLoad({
  folderPath,
  onLoadPrompts,
}: {
  folderPath: string;
  onLoadPrompts: (prompts: { name: string; text: string }[]) => void;
}) {
  const [group, setGroup] = useState<string>('');
  const datasetName = datasetNameOf(folderPath);

  useEffect(() => {
    if (!datasetName) {
      setGroup('');
      return;
    }
    apiClient
      .get(`/api/datasets/prompt_link?datasetName=${encodeURIComponent(datasetName)}`)
      .then(r => {
        setGroup(r.data?.group || '');
        const prompts = r.data?.prompts ?? [];
        if (prompts.length) onLoadPrompts(prompts);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetName]);

  if (!datasetName) return null;
  return (
    <p className="text-xs text-gray-500 pt-1.5">
      {group ? (
        <>
          Sample prompts loaded from <span className="text-gray-300">{group}</span>.{' '}
        </>
      ) : (
        'No sample prompts set for this dataset. '
      )}
      <Link href={`/datasets/${encodeURIComponent(datasetName)}`} className="text-blue-400 hover:underline">
        {group ? 'Change' : 'Set'} on the dataset page
      </Link>
    </p>
  );
}
