'use client';

import { useEffect, useState } from 'react';
import { SelectInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';

// DUAL BUILD: per-dataset prompt-group link. Picking a dataset auto-loads its
// linked group's prompts into the job's sample prompts; choosing a group here
// saves the link (into the dataset folder) and loads it immediately.
type Props = {
  folderPath: string;
  onLoadPrompts: (prompts: { name: string; text: string }[]) => void;
};

const datasetNameOf = (folderPath: string) =>
  folderPath ? folderPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '' : '';

export default function DatasetPromptLink({ folderPath, onLoadPrompts }: Props) {
  const [groups, setGroups] = useState<string[]>([]);
  const [group, setGroup] = useState<string>('');
  const datasetName = datasetNameOf(folderPath);

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

  // when the selected dataset changes, read its link + auto-fill prompts
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

  const changeGroup = async (g: string) => {
    setGroup(g);
    if (!datasetName) return;
    try {
      await apiClient.post('/api/datasets/prompt_link', { datasetName, group: g });
      const lr = await apiClient.get(`/api/datasets/prompt_link?datasetName=${encodeURIComponent(datasetName)}`);
      const prompts = lr.data?.prompts ?? [];
      if (prompts.length) onLoadPrompts(prompts);
    } catch {
      /* ignore */
    }
  };

  const options = [{ value: '', label: 'No linked prompts' }, ...groups.map(g => ({ value: g, label: g }))];
  if (group && !groups.includes(group)) options.push({ value: group, label: group });

  return (
    <SelectInput label="Linked Prompt Group" value={group} onChange={v => changeGroup(v)} options={options} />
  );
}
