import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['server.js', 'planner.js', ...(await readdir('backend')).filter(x => x.endsWith('.js')).map(x => `backend/${x}`), ...(await readdir('dist')).filter(x => x.endsWith('.js')).map(x => `dist/${x}`), 'worker/index.js'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
console.log(`Syntax verified: ${files.length} JavaScript modules.`);
