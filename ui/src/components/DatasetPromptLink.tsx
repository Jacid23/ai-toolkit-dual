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

type LinkedPrompts = { group: string; prompts: { name: string; text: string }[] };

const fetchLinkedPrompts = async (datasetName: string): Promise<LinkedPrompts> => {
  const r = await apiClient.get(`/api/datasets/prompt_link?datasetName=${encodeURIComponent(datasetName)}`);
  return { group: r.data?.group || '', prompts: r.data?.prompts ?? [] };
};

// New Job only (never edit / clone / Live Edit, which keep the job's own prompts): the dataset's
// prompt group is loaded into the job's samples when a dataset is picked (the select's
// onChange). It is just a starting point, nothing links the job to it; when the prompts no
// longer match the group's, "Use these" loads the group's again.
export async function loadDatasetPrompts(folderPath: string): Promise<{ prompt: string }[] | null> {
  const datasetName = datasetNameOf(folderPath);
  if (!datasetName) return null;
  const { prompts } = await fetchLinkedPrompts(datasetName).catch(() => ({ prompts: [] as LinkedPrompts['prompts'] }));
  return prompts.length ? prompts.map(p => ({ prompt: p.text })) : null;
}

export function DatasetPromptAutoLoad({
  folderPath,
  currentPrompts,
  onLoadPrompts,
}: {
  folderPath: string;
  currentPrompts: string[];
  onLoadPrompts: (samples: { prompt: string }[]) => void;
}) {
  const [linked, setLinked] = useState<LinkedPrompts>({ group: '', prompts: [] });
  const datasetName = datasetNameOf(folderPath);

  useEffect(() => {
    if (!datasetName) {
      setLinked({ group: '', prompts: [] });
      return;
    }
    fetchLinkedPrompts(datasetName)
      .then(setLinked)
      .catch(() => {});
  }, [datasetName]);

  if (!datasetName) return null;
  const { group, prompts } = linked;
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const same =
    prompts.length === currentPrompts.length && prompts.every((p, i) => norm(p.text) === norm(currentPrompts[i] ?? ''));
  return (
    <p className="text-xs text-gray-500 pt-1.5">
      {group && same ? (
        <>
          Sample prompts loaded from <span className="text-gray-300">{group}</span>.{' '}
        </>
      ) : group ? (
        <>
          Dataset prompts: <span className="text-gray-300">{group}</span>
          {prompts.length ? ` (${prompts.length})` : ''}.{' '}
          {prompts.length > 0 && (
            <button
              type="button"
              onClick={() => onLoadPrompts(prompts.map(p => ({ prompt: p.text })))}
              className="text-blue-400 hover:underline"
            >
              Use these
            </button>
          )}
          {prompts.length > 0 && ' · '}
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
