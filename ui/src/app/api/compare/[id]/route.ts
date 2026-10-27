import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { getDataRoot } from '@/server/settings';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comparison = await prisma.comparison.findUnique({ where: { id } });
  if (!comparison) return NextResponse.json({ error: 'Comparison not found' }, { status: 404 });
  // reopen this one next time the page loads
  await prisma.settings.upsert({
    where: { key: 'COMPARE_LAST_ID' },
    update: { value: id },
    create: { key: 'COMPARE_LAST_ID', value: id },
  });
  return NextResponse.json({ id: comparison.id, name: comparison.name, data: JSON.parse(comparison.data) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const comparison = await prisma.comparison.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.data !== undefined ? { data: JSON.stringify(body.data) } : {}),
      },
    });
    return NextResponse.json({ id: comparison.id, name: comparison.name });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save comparison' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.compareCell.deleteMany({ where: { comparison_id: id } });
    await prisma.comparison.delete({ where: { id } });
    const dir = path.join(await getDataRoot(), 'compare', id);
    await fs.promises.rm(dir, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to delete comparison' }, { status: 500 });
  }
}
