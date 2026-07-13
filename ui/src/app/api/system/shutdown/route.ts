import { NextResponse } from 'next/server';

// dual-GPU build: full shutdown from the UI. No restart flag is written, so the
// Start-Dual.bat supervisor loop exits after the server stops. concurrently
// --kill-others tears down the worker when Next exits.
export async function GET() {
  setTimeout(() => process.exit(0), 600);
  return NextResponse.json({ ok: true, action: 'shutdown' });
}
