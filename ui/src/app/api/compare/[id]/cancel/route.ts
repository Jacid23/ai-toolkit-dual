import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { comfyFetch, comfyJson } from '@/server/compare';

// Stop this comparison's queued images in ComfyUI. Cells that already had an image keep it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const pending = await prisma.compareCell.findMany({ where: { comparison_id: id, status: 'pending' } });
    const ids = pending.map(c => c.comfy_id).filter((x): x is string => !!x);
    if (ids.length) {
      try {
        const q = await comfyJson('/queue');
        await comfyFetch('/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: ids }),
        });
        const runningOurs = (q.queue_running ?? []).some((x: any[]) => ids.includes(x[1]));
        if (runningOurs) await comfyFetch('/interrupt', { method: 'POST' });
      } catch {
        // Comfy down: nothing left to cancel there, just clean up our side
      }
    }
    for (const c of pending) {
      if (c.image_path) await prisma.compareCell.update({ where: { id: c.id }, data: { status: 'done', comfy_id: null } });
      else await prisma.compareCell.delete({ where: { id: c.id } });
    }
    return NextResponse.json({ cancelled: pending.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to cancel' }, { status: 500 });
  }
}
