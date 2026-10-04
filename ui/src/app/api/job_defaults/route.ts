import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// DUAL BUILD: per-model saved job defaults, stored in the settings table as
// JOB_DEFAULTS:<arch> -> JSON { process, gpu_ids }.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREFIX = 'JOB_DEFAULTS:';

export async function GET() {
  try {
    const rows = await prisma.settings.findMany({ where: { key: { startsWith: PREFIX } } });
    const defaults: { [arch: string]: any } = {};
    for (const row of rows) {
      try {
        defaults[row.key.slice(PREFIX.length)] = JSON.parse(row.value);
      } catch {
        // skip a corrupt entry rather than failing the whole page
      }
    }
    return NextResponse.json({ defaults }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch job defaults' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { arch, process, gpu_ids } = await request.json();
    if (!arch || typeof arch !== 'string' || !process || typeof process !== 'object') {
      return NextResponse.json({ error: 'arch and process are required' }, { status: 400 });
    }
    const key = PREFIX + arch;
    const value = JSON.stringify({ process, gpu_ids: gpu_ids ?? null });
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save job default' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const arch = request.nextUrl.searchParams.get('arch');
    if (!arch) {
      return NextResponse.json({ error: 'arch is required' }, { status: 400 });
    }
    await prisma.settings.deleteMany({ where: { key: PREFIX + arch } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete job default' }, { status: 500 });
  }
}
