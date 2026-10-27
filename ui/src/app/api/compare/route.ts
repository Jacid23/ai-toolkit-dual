import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { newCompareData } from '@/utils/compare';
import { getCompareDefaults } from '@/server/compare';

// list saved comparisons, plus the one opened last (restored on reload) and the saved default settings
export async function GET() {
  try {
    const comparisons = await prisma.comparison.findMany({
      select: { id: true, name: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
    });
    const last = await prisma.settings.findFirst({ where: { key: 'COMPARE_LAST_ID' } });
    return NextResponse.json({ comparisons, lastId: last?.value ?? null, defaults: await getCompareDefaults() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to list comparisons' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = body.data ?? newCompareData(await getCompareDefaults());
    const comparison = await prisma.comparison.create({
      data: { name: body.name || 'New comparison', data: JSON.stringify(data) },
    });
    return NextResponse.json({ id: comparison.id, name: comparison.name, data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create comparison' }, { status: 500 });
  }
}
