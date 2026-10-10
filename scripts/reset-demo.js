import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = resolve('data/careweave.sqlite');
if (!process.argv.includes('--confirm')) {
  console.log('Stop the server, then run npm run demo:reset -- --confirm. This archives the local demo database so the next start seeds a fresh 1,000 patients.');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(base + suffix)) await rename(base + suffix, base + '.backup-' + stamp + suffix);
}
console.log('Previous demo database archived in data/. Restart the server for a fresh dataset.');
