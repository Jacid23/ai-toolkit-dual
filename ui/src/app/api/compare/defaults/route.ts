import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// "Save as default": the sample settings new comparisons start with
export async function POST(request: NextRequest) {
  try {
    const { settings } = await request.json();
    const value = JSON.stringify(settings ?? {});
    await prisma.settings.upsert({
      where: { key: 'COMPARE_DEFAULTS' },
      update: { value },
      create: { key: 'COMPARE_DEFAULTS', value },
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save defaults' }, { status: 500 });
  }
}
