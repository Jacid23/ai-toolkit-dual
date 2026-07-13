import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// dual-GPU build: full shutdown from the UI. Writes the .dual_shutdown flag so
// the Start-Dual.bat supervisor loop STOPS (its default on any exit is to
// relaunch). concurrently --kill-others tears down the worker when Next exits.
export async function GET() {
  try {
    fs.writeFileSync(path.resolve(process.cwd(), '..', '.dual_shutdown'), '1');
  } catch (e) {
    console.error('shutdown: could not write flag', e);
  }
  setTimeout(() => process.exit(0), 600);
  return NextResponse.json({ ok: true, action: 'shutdown' });
}
