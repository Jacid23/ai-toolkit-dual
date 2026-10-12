// dual-GPU build: GPU picker options including the combined "split" entry.
// A comma gpu_ids value ("0,1") makes both devices visible to the job; the
// model.multi_gpu_split flag makes the trainer split the transformer blocks
// across them (single job pooling the VRAM of both cards).

export const gpuSelectOptions = (gpuList: any[]): { value: string; label: string }[] => {
  const indexes = gpuList.map((gpu: any) => gpu.index);
  // each single card first
  const options = indexes.map((idx: number) => ({ value: `${idx}`, label: `GPU #${idx}` }));

  // then EVERY multi-card subset (size >= 2), so the split can pool any
  // combination of cards (e.g. 0+1, 0+2, 1+2, 0+1+2) rather than only "all of
  // them". The chosen subset becomes gpu_ids -> CUDA_VISIBLE_DEVICES, and the
  // comma in the value trips isSplitSelection() to set model.multi_gpu_split.
  if (indexes.length >= 2) {
    const subsets: number[][] = [];
    const total = 1 << indexes.length;
    for (let mask = 1; mask < total; mask++) {
      const subset = indexes.filter((_: number, i: number) => mask & (1 << i));
      if (subset.length >= 2) subsets.push(subset);
    }
    // tidy order: smaller groups first, then by card number
    subsets.sort((a, b) => a.length - b.length || a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0));
    for (const subset of subsets) {
      options.push({
        value: subset.join(','),
        label: `GPU #${subset.join(' + #')} (split)`,
      });
    }
  }
  return options;
};

export const isSplitSelection = (gpuIDs: string | null): boolean => {
  return typeof gpuIDs === 'string' && gpuIDs.includes(',');
};
