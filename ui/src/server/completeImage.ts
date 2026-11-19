// DUAL BUILD: a sample image that is still being written (a saver writing straight to its final
// name) isn't shown until it's whole, or the browser would get half an image. Whole means: a WebP's
// RIFF size covers the file, a PNG ends with its IEND chunk, a JPEG with its end-of-image marker.
// Only files changed in the last minute are opened; older ones are taken as finished.
import fs from 'fs';

const RECENT_MS = 60000;

export async function isCompleteImage(file: string, mtimeMs?: number): Promise<boolean> {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) return true;
  let fh: fs.promises.FileHandle | null = null;
  try {
    if (mtimeMs === undefined) mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    if (Date.now() - mtimeMs > RECENT_MS) return true;
    fh = await fs.promises.open(file, 'r');
    const size = (await fh.stat()).size;
    if (size < 16) return false;
    if (ext === '.webp') {
      const head = Buffer.alloc(12);
      await fh.read(head, 0, 12, 0);
      return head.toString('ascii', 0, 4) === 'RIFF' && head.readUInt32LE(4) + 8 <= size;
    }
    const tail = Buffer.alloc(12);
    await fh.read(tail, 0, 12, size - 12);
    if (ext === '.png') return tail.includes('IEND');
    return tail[10] === 0xff && tail[11] === 0xd9;
  } catch {
    return false; // gone or unreadable right now: list it on the next look
  } finally {
    await fh?.close().catch(() => {});
  }
}
