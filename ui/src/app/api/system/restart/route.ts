import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// dual-GPU build: restart from the UI (the launcher console is hidden, so
// Ctrl+C isn't available). Drop a flag the Start-Dual.bat supervisor loop
// checks, then cleanly exit the Next process. concurrently --kill-others tears
// down the worker too, npm returns to the bat, the bat sees the flag and
// relaunches (rebuild included).
export async function GET() {
  try {
    // next runs with cwd = ui/, so repo root is one up
    fs.writeFileSync(path.resolve(process.cwd(), '..', '.dual_restart'), '1');
  } catch (e) {
    console.error('restart: could not write flag', e);
  }
  // give the response time to flush before we exit
  setTimeout(() => process.exit(0), 600);
  return NextResponse.json({ ok: true, action: 'restart' });
}
