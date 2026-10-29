import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Media that counts as one training sample. Audio is intentionally excluded —
// it is not a trainable image/video sample for these datasets.
const MEDIA_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.m4v', '.flv'];

// Count media files under a folder (recursively), mirroring the dataset loader's
// own traversal: skip dot-dirs and the _controls folder. Returns 0 on any error
// (missing/placeholder folder) so the caller can show "set your dataset first".
async function countMedia(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  const subdirs: string[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const itemPath = path.join(dir, name);
    if (entry.isDirectory()) {
      if (name === '_controls') continue;
      subdirs.push(itemPath);
    } else if (entry.isFile()) {
      if (MEDIA_EXT.includes(path.extname(name).toLowerCase())) count++;
    }
  }
  const nested = await Promise.all(subdirs.map(countMedia));
  return count + nested.reduce((a, b) => a + b, 0);
}

/**
 * Estimate steps-per-epoch for a set of datasets and emit the epoch-boundary steps.
 *
 * steps/epoch = ceil( ceil(effectiveSamples / batch_size) / gradient_accumulation )
 * where effectiveSamples = Σ_dataset  images × num_repeats × num_resolutions.
 *
 * This is exact at batch_size 1 (each sample is its own step, buckets don't change
 * the count). At batch_size >= 2 real per-bucket rounding adds up to (#buckets - 1)
 * steps per dataset, so the number is a close lower-bound estimate there — good
 * enough for placing checkpoints, which is what it's for.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const datasets: Array<{ folder_path?: string; num_repeats?: number; num_resolutions?: number }> = Array.isArray(
      body?.datasets,
    )
      ? body.datasets
      : [];
    const batchSize = Math.max(1, Number(body?.batch_size) || 1);
    const gradAccum = Math.max(1, Number(body?.gradient_accumulation) || 1);
    const totalSteps = Math.max(0, Math.floor(Number(body?.total_steps) || 0));
    const maxEpochs = Math.min(500, Math.max(1, Number(body?.max_epochs) || 80));

    const perDataset: Array<{ folder_path: string; images: number; num_repeats: number; num_resolutions: number }> = [];
    let effectiveSamples = 0;
    let totalImages = 0;
    for (const ds of datasets) {
      const folder = typeof ds?.folder_path === 'string' ? ds.folder_path : '';
      const repeats = Math.max(1, Number(ds?.num_repeats) || 1);
      const numRes = Math.max(1, Number(ds?.num_resolutions) || 1);
      const images = folder ? await countMedia(folder) : 0;
      totalImages += images;
      effectiveSamples += images * repeats * numRes;
      perDataset.push({ folder_path: folder, images, num_repeats: repeats, num_resolutions: numRes });
    }

    const batchesPerEpoch = Math.ceil(effectiveSamples / batchSize);
    const stepsPerEpoch = Math.max(0, Math.ceil(batchesPerEpoch / gradAccum));

    const epochs: number[] = [];
    if (stepsPerEpoch > 0) {
      for (let e = 1; e <= maxEpochs; e++) {
        const step = stepsPerEpoch * e;
        if (totalSteps && step > totalSteps) break;
        epochs.push(step);
      }
    }

    return NextResponse.json({
      steps_per_epoch: stepsPerEpoch,
      total_images: totalImages,
      effective_samples: effectiveSamples,
      per_dataset: perDataset,
      epochs,
    });
  } catch (error) {
    console.error('Error computing epochs:', error);
    return NextResponse.json({ error: 'Failed to compute epochs' }, { status: 500 });
  }
}
