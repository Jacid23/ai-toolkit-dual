import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '@/server/prisma';
import { getDataRoot } from '@/server/settings';
import { comfyFetch, comfyJson } from '@/server/compare';

const historyError = (h: any) => {
  const msg = (h?.status?.messages ?? []).find((m: any) => m?.[0] === 'execution_error')?.[1];
  return msg ? `${msg.node_type ?? ''} #${msg.node_id ?? ''}: ${msg.exception_message ?? 'failed'}`.trim() : 'ComfyUI reported an error';
};

// Collect finished images from ComfyUI for this comparison's queued cells, then return every cell.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pending = await prisma.compareCell.findMany({ where: { comparison_id: id, status: 'pending' } });
  const queue = { running: 0, waiting: 0 };
  let comfyError: string | null = null;

  if (pending.length) {
    try {
      const q = await comfyJson('/queue');
      const running = new Set((q.queue_running ?? []).map((x: any[]) => x[1]));
      const waiting = new Set((q.queue_pending ?? []).map((x: any[]) => x[1]));
      const dir = path.join(await getDataRoot(), 'compare', id);
      for (const c of pending) {
        if (running.has(c.comfy_id)) {
          queue.running++;
          continue;
        }
        if (waiting.has(c.comfy_id)) {
          queue.waiting++;
          continue;
        }
        const h = c.comfy_id ? (await comfyJson(`/history/${c.comfy_id}`))?.[c.comfy_id] : null;
        if (!h) {
          await prisma.compareCell.update({
            where: { id: c.id },
            data: { status: 'error', error: 'ComfyUI no longer has this job (was it restarted or the queue cleared?)' },
          });
          continue;
        }
        if (h.status?.status_str === 'error') {
          await prisma.compareCell.update({ where: { id: c.id }, data: { status: 'error', error: historyError(h) } });
          continue;
        }
        const images = Object.values<any>(h.outputs ?? {}).flatMap(o => o?.images ?? []);
        const pick = images.find(i => i.type === 'output') ?? images[0];
        if (!pick) {
          if (h.status?.completed) {
            await prisma.compareCell.update({
              where: { id: c.id },
              data: { status: 'error', error: 'The workflow finished without producing an image' },
            });
          }
          continue;
        }
        const qs = new URLSearchParams({ filename: pick.filename, subfolder: pick.subfolder ?? '', type: pick.type ?? 'output' });
        const res = await comfyFetch(`/view?${qs}`, { timeoutMs: 60000 });
        if (!res.ok) throw new Error(`ComfyUI /view → HTTP ${res.status}`);
        await fs.promises.mkdir(dir, { recursive: true });
        const hash = crypto.createHash('sha1').update(c.lora_path + '\u0000' + c.prompt).digest('hex').slice(0, 16);
        const file = path.join(dir, `${hash}_${Date.now()}${path.extname(pick.filename) || '.png'}`);
        await fs.promises.writeFile(file, Buffer.from(await res.arrayBuffer()));
        if (c.image_path && c.image_path !== file) await fs.promises.rm(c.image_path, { force: true });
        await prisma.compareCell.update({ where: { id: c.id }, data: { status: 'done', image_path: file, error: null } });
      }
    } catch (e: any) {
      comfyError = e?.message ?? String(e);
    }
  }

  const cells = await prisma.compareCell.findMany({
    where: { comparison_id: id },
    select: { lora_path: true, prompt: true, status: true, image_path: true, error: true, settings: true, updated_at: true },
  });
  return NextResponse.json({ cells, queue, comfyError });
}
