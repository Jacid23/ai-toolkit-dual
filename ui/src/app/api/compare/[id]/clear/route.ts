import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import prisma from '@/server/prisma';

// "Clear images": delete generated images for some LoRA files (a row) so Generate makes them again
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { lora_paths } = (await request.json()) as { lora_paths?: string[] };
    const cells = await prisma.compareCell.findMany({
      where: {
        comparison_id: id,
        status: { not: 'pending' },
        ...(lora_paths ? { lora_path: { in: lora_paths } } : {}),
      },
    });
    for (const c of cells) if (c.image_path) await fs.promises.rm(c.image_path, { force: true });
    await prisma.compareCell.deleteMany({ where: { id: { in: cells.map(c => c.id) } } });
    return NextResponse.json({ cleared: cells.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to clear images' }, { status: 500 });
  }
}
