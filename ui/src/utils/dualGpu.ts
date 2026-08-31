// dual-GPU build: GPU picker options including the combined "split" entry.
// A comma gpu_ids value ("0,1") makes both devices visible to the job; the
// model.multi_gpu_split flag makes the trainer split the transformer blocks
// across them (single job pooling the VRAM of both cards).

export const gpuSelectOptions = (gpuList: any[]): { value: string; label: string }[] => {
  const options = gpuList.map((gpu: any) => ({ value: `${gpu.index}`, label: `GPU #${gpu.index}` }));
  if (gpuList.length >= 2) {
    const indexes = gpuList.map((gpu: any) => gpu.index);
    options.push({
      value: indexes.join(','),
      label: `GPU #${indexes.join(' + #')} (split)`,
    });
  }
  return options;
};

export const isSplitSelection = (gpuIDs: string | null): boolean => {
  return typeof gpuIDs === 'string' && gpuIDs.includes(',');
};
