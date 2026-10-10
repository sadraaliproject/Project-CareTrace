import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

// Encoded match vocabulary keeps the audit's own source eligible for the same check.
// Dependencies, compiled dependency bundles, private state and Git history are not authored source.
const vocabulary = [
  '\u0065\u006e\u0072\u006f\u006c\u006c\u0065\u0065', '\u0062\u0065\u006e\u0065\u0066\u0069\u0063\u0069\u0061\u0072\u0079', '\u0073\u0075\u0062\u0073\u0063\u0072\u0069\u0062\u0065\u0072', '\u0068\u0065\u0061\u006c\u0074\u0068\u0020\u0070\u006c\u0061\u006e', '\u0070\u0061\u0079\u0065\u0072', '\u0069\u006e\u0073\u0075\u0072\u0065\u0072', '\u0063\u0061\u0072\u0072\u0069\u0065\u0072',
  '\u006d\u0065\u0064\u0069\u0063\u0061\u0072\u0065\u0020\u0061\u0064\u0076\u0061\u006e\u0074\u0061\u0067\u0065', '\u006d\u0065\u0064\u0069\u0063\u0061\u0069\u0064\u0020\u0070\u006c\u0061\u006e', '\u0063\u006c\u0061\u0069\u006d\u0073', '\u0063\u006c\u0061\u0069\u006d\u0020\u006c\u0069\u006e\u0065\u0073', '\u0065\u006c\u0069\u0067\u0069\u0062\u0069\u006c\u0069\u0074\u0079\u0020\u0066\u0069\u006c\u0065\u0073',
  '\u0065\u006e\u0072\u006f\u006c\u006c\u006d\u0065\u006e\u0074', '\u0062\u0065\u006e\u0065\u0066\u0069\u0074\u0073', '\u0070\u0072\u0069\u006f\u0072\u0020\u0061\u0075\u0074\u0068\u006f\u0072\u0069\u007a\u0061\u0074\u0069\u006f\u006e', '\u0061\u0074\u0074\u0072\u0069\u0062\u0075\u0074\u0069\u006f\u006e', '\u0072\u0069\u0073\u006b\u0020\u0061\u0064\u006a\u0075\u0073\u0074\u006d\u0065\u006e\u0074', '\u0072\u0069\u0073\u006b\u0020\u0073\u0063\u006f\u0072\u0065\u0073',
  '\u006d\u0065\u006d\u0062\u0065\u0072\u0020\u0065\u006e\u0067\u0061\u0067\u0065\u006d\u0065\u006e\u0074', '\u006f\u0075\u0074\u0072\u0065\u0061\u0063\u0068\u0020\u0063\u0061\u006d\u0070\u0061\u0069\u0067\u006e\u0073', '\u0063\u0061\u006c\u006c\u0020\u0063\u0065\u006e\u0074\u0065\u0072', '\u0067\u0061\u0070\u0020\u0063\u006c\u006f\u0073\u0075\u0072\u0065\u0020\u0063\u0061\u006d\u0070\u0061\u0069\u0067\u006e\u0073', '\u0062\u0065\u006e\u0065\u0066\u0069\u0074\u0020\u006e\u0061\u0076\u0069\u0067\u0061\u0074\u0069\u006f\u006e',
  '\u0070\u006c\u0061\u006e\u0020\u0061\u0072\u0072\u0061\u006e\u0067\u0065\u0064\u0020\u0072\u0069\u0064\u0065\u0073', '\u0070\u006c\u0061\u006e\u0020\u0061\u0072\u0072\u0061\u006e\u0067\u0065\u0064\u0020\u006d\u0065\u0061\u006c\u0073', '\u0073\u0074\u0061\u0072\u0073', '\u0068\u0065\u0064\u0069\u0073', '\u0071\u0075\u0061\u006c\u0069\u0074\u0079\u0020\u0072\u0061\u0074\u0069\u006e\u0067\u0073', '\u0063\u0061\u0072\u0065\u0020\u0067\u0061\u0070\u0020\u0063\u006c\u006f\u0073\u0075\u0072\u0065\u0020\u0072\u0061\u0074\u0065\u0073',
  '\u0076\u0061\u006c\u0075\u0065\u0020\u0062\u0061\u0073\u0065\u0064\u0020\u0063\u006f\u006e\u0074\u0072\u0061\u0063\u0074\u0073', '\u0063\u0061\u0072\u0065\u0020\u0067\u0061\u0070', '\u0061\u0031\u0063\u0020\u0067\u0061\u0070', '\u006f\u0075\u0074\u0072\u0065\u0061\u0063\u0068\u0020\u006c\u0069\u0073\u0074', '\u0072\u0065\u006d\u0069\u006e\u0064\u0065\u0072\u0020\u006c\u0065\u0074\u0074\u0065\u0072', '\u0072\u0065\u0066\u0069\u006c\u006c\u0020\u0067\u0061\u0070',
  '\u0063\u0061\u006c\u006c\u0020\u0074\u0072\u0061\u006e\u0073\u0063\u0072\u0069\u0070\u0074', '\u0070\u006f\u0070\u0075\u006c\u0061\u0074\u0069\u006f\u006e\u0020\u0068\u0065\u0061\u006c\u0074\u0068\u0020\u0074\u0065\u0061\u006d', '\u006c\u0069\u006b\u0065\u006c\u0079\u0020\u0075\u006e\u006d\u0061\u006e\u0061\u0067\u0065\u0064',
  '\u0070\u006f\u0070\u0075\u006c\u0061\u0074\u0069\u006f\u006e', '\u0063\u006f\u006d\u006d\u0075\u006e\u0069\u0074\u0079', '\u006f\u0075\u0074\u0072\u0065\u0061\u0063\u0068', '\u0069\u006e\u0074\u0065\u0072\u0076\u0065\u006e\u0074\u0069\u006f\u006e', '\u0073\u0074\u0072\u0075\u0063\u0074\u0075\u0072\u0065\u0064\u0020\u0072\u0065\u0063\u006f\u0072\u0064', '\u0072\u0065\u0066\u0069\u006c\u006c',
  '\u0063\u0068\u0061\u0072\u0074\u0020\u006e\u006f\u0074\u0065', '\u0061\u0074\u0074\u0072\u0069\u0062\u0075\u0074\u0065\u0064\u0020\u0070\u0072\u006f\u0076\u0069\u0064\u0065\u0072', '\u0070\u0072\u0069\u006d\u0061\u0072\u0079\u0020\u0063\u0061\u0072\u0065\u0020\u0070\u0072\u006f\u0076\u0069\u0064\u0065\u0072', '\u0061\u0076\u006f\u0069\u0064\u0061\u0062\u006c\u0065\u0020\u0063\u006f\u006d\u0070\u006c\u0069\u0063\u0061\u0074\u0069\u006f\u006e\u0073',
  '\u0065\u006e\u0063\u006f\u0075\u006e\u0074\u0065\u0072', '\u0073\u006f\u0075\u0072\u0063\u0065\u0020\u0064\u006f\u0063\u0075\u006d\u0065\u006e\u0074', '\u0068\u0061\u0064\u0020\u0065\u006e\u0063\u006f\u0075\u006e\u0074\u0065\u0072', '\u0066\u0069\u006c\u006c\u0065\u0064', '\u0073\u0065\u0065\u006e\u0020\u0062\u0079', '\u0068\u0061\u0073\u0020\u0064\u006f\u0063\u0075\u006d\u0065\u006e\u0074',
  '\u0070\u0072\u006f\u0076\u0069\u0064\u0065\u0072', '\u0069\u006e\u0073\u0075\u0072\u0061\u006e\u0063\u0065', '\u0067\u0061\u0070\u0020\u0063\u006c\u006f\u0073\u0075\u0072\u0065', '\u0070\u0061\u0074\u0069\u0065\u006e\u0074\u0020\u0077\u0069\u0074\u0068\u0020\u0064\u0069\u0061\u0062\u0065\u0074\u0065\u0073', '\u0070\u0061\u0074\u0069\u0065\u006e\u0074\u0073\u0020\u0077\u0069\u0074\u0068\u0020\u0064\u0069\u0061\u0062\u0065\u0074\u0065\u0073'
];
const normalize = text => text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const patterns = vocabulary.map(term => ({ term, pattern: new RegExp(`\\b${term.replaceAll(' ', '\\s+')}s?\\b`, 'i') }));
const ignoredDirectories = new Set(['node_modules', '.git', '.sites-runtime', '.wrangler', 'data', 'server', 'vendor', 'Hackathon 26']);
const authoredExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.ps1', '.sh', '.json', '.sql', '.html', '.css', '.md', '.yml', '.yaml', '.toml', '.txt', '.csv', '.example', '.code-workspace']);
const findings = [];
const historicalFindings = [];
const historicalDigests = new Map([
  ['drizzle/0000_broad_proemial_gods.sql', '3fa265796fad519f5cca2a4516332969b3f5f91af305f84c6c98c741e6c470b2'],
  ['drizzle/meta/0000_snapshot.json', 'b36e68c47f60351ae5a10ecd9c0df5430089aef2fd07e0d4f052a36e4df4d9c1'],
]);
const verifiedHistory = new Set();
const root = resolve('.');
let files = 0;

function inspect(content, file) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const normalized = normalize(lines[index]);
    const hit = patterns.find(({ pattern }) => pattern.test(normalized));
    const target = verifiedHistory.has(file) ? historicalFindings : findings;
    if (hit) target.push({ file, line: index + 1, term: hit.term });
    const personWord = '\u006d\u0065\u006d\u0062\u0065\u0072';
    if (new RegExp(`\\b${personWord}s?\\b`).test(normalized.replace(new RegExp(`\\b(?:family|team) ${personWord}s?\\b`, 'g'), ''))) target.push({ file, line: index + 1, term: personWord });
  }
}
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const path = resolve(directory, item.name), file = relative(root, path).replaceAll('\\', '/');
    if (item.isDirectory()) { if (!ignoredDirectories.has(item.name)) await walk(path); continue; }
    if (item.name === 'package-lock.json' || item.name.startsWith('.env') && item.name !== '.env.example') continue;
    if (!authoredExtensions.has(extname(item.name)) && !['.gitignore'].includes(item.name)) continue;
    files++;
    const content = await readFile(path, 'utf8');
    if (historicalDigests.has(file)) {
      // Canonical LF preserves the Git content digest across Windows checkouts.
      const digest = createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
      if (digest === historicalDigests.get(file)) verifiedHistory.add(file);
      else findings.push({ file, line: 0, term: 'Applied migration history changed; restore the pinned original.' });
    }
    inspect(file, `${file} (filename)`); inspect(content, file);
  }
}
await walk(root);
for (const file of historicalDigests.keys()) if (!verifiedHistory.has(file) && !findings.some(finding => finding.file === file && finding.line === 0)) findings.push({ file, line: 0, term: 'Required applied migration history is missing.' });
if (historicalFindings.length) {
  console.warn(`Retained applied history: ${historicalFindings.length} wording findings in ${verifiedHistory.size} SHA-256-pinned files. These are explicit historical exceptions, not a clean whole-history result.`);
  for (const finding of historicalFindings) console.warn(`${finding.file}:${finding.line}: retained historical identifier`);
}
if (findings.length) {
  console.error(`Hospital language audit: ${findings.length} findings across ${files} authored files.`);
  const limit = process.argv.includes('--all') ? findings.length : 100;
  for (const finding of findings.slice(0, limit)) console.error(`${finding.file}:${finding.line}: ${finding.term}`);
  if (findings.length > limit) console.error(`${findings.length - limit} more findings; use --all for every location.`);
  if (!process.argv.includes('--report-only')) process.exitCode = 1;
} else console.log(`Hospital current-source language audit passed: ${files} authored files checked; ${verifiedHistory.size} immutable historical files reported separately.`);
