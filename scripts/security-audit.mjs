import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const warnings = [];

async function text(path) {
  return readFile(resolve(root, path), 'utf8');
}

function requireMatch(label, value, pattern) {
  if (!pattern.test(value)) failures.push(`${label}: expected ${pattern}`);
}

function forbidMatch(label, value, pattern) {
  if (pattern.test(value)) failures.push(`${label}: forbidden pattern ${pattern}`);
}

const tauri = JSON.parse(await text('src-tauri/tauri.conf.json'));
const capabilities = JSON.parse(await text('src-tauri/capabilities/default.json'));
const csp = tauri?.app?.security?.csp ?? '';

for (const directive of ["frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
  requireMatch(`Tauri CSP ${directive}`, csp, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
requireMatch('Tauri CSP connect-src', csp, /connect-src\s+ipc:\s+http:\/\/ipc\.localhost/);
forbidMatch('Tauri CSP wildcard source', csp, /\s\*/u);
if (capabilities?.webviews?.length !== 1 || capabilities.webviews[0] !== 'main') {
  failures.push('capabilities: native permissions must be scoped only to the bundled main webview');
}

const permissions = capabilities.permissions ?? [];
const httpPermission = permissions.find((permission) => typeof permission === 'object' && permission.identifier === 'http:default');
const openerPermission = permissions.find((permission) => typeof permission === 'object' && permission.identifier === 'opener:allow-open-url');
const httpUrls = httpPermission?.allow?.map((entry) => entry.url).sort() ?? [];
const openerUrls = openerPermission?.allow?.map((entry) => entry.url).sort() ?? [];
const expectedHttp = [
  'http://127.0.0.1:11434/api/generate',
  'http://127.0.0.1:11434/api/tags',
  'https://api.arena.ai/v1/chat/completions',
].sort();
const expectedOpener = [
  'https://arena.ai/agent',
  'https://help.arena.ai/articles/3765052346-privacy-policy',
  'https://platform.arena.ai/dashboard/keys',
].sort();
if (JSON.stringify(httpUrls) !== JSON.stringify(expectedHttp)) failures.push(`HTTP capability scope changed: ${JSON.stringify(httpUrls)}`);
if (JSON.stringify(openerUrls) !== JSON.stringify(expectedOpener)) failures.push(`opener capability scope changed: ${JSON.stringify(openerUrls)}`);
for (const url of [...httpUrls, ...openerUrls]) {
  if (/[\*]|\.\./u.test(url)) failures.push(`capability URL is not exact: ${url}`);
}

async function sourceFiles(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const childPath = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await sourceFiles(childPath, childRelative));
    else if (entry.isFile() && childRelative.endsWith('.ts')) paths.push(childRelative);
  }
  return paths;
}

const sourcePaths = await sourceFiles(resolve(root, 'src'), 'src');
sourcePaths.sort();
for (const relative of sourcePaths) {
  const source = await text(relative);
  for (const [label, pattern] of [
    ['dynamic code evaluation', /\beval\s*\(/u],
    ['Function constructor', /\bnew\s+Function\s*\(/u],
    ['document.write', /\bdocument\.write\s*\(/u],
    ['HTML string insertion', /\binsertAdjacentHTML\s*\(/u],
    ['outerHTML replacement', /\bouterHTML\s*=/u],
    ['React raw HTML escape hatch', /dangerouslySetInnerHTML/u],
  ]) {
    forbidMatch(`${relative} (${label})`, source, pattern);
  }
}

const markdownRender = await text('src/markdown-render.ts');
const markdownPreview = await text('src/markdown-preview.ts');
forbidMatch('Markdown renderer HTML output', markdownRender, /\.innerHTML\b|insertAdjacentHTML|outerHTML/u);
forbidMatch('Markdown preview HTML insertion', markdownPreview, /\.innerHTML\b|insertAdjacentHTML|outerHTML/u);
requireMatch('Markdown preview uses replacement DOM', markdownPreview, /replaceChildren\(/u);
requireMatch('Markdown preview has an allowlist', markdownPreview, /ALLOWED_TAGS/u);

const networkImportPaths = [];
for (const relative of sourcePaths) {
  const source = await text(relative);
  if (source.includes("@tauri-apps/plugin-http")) networkImportPaths.push(relative);
}
const allowedNetworkImportPaths = ['src/ai.ts', 'src/arena.ts'];
for (const path of networkImportPaths) {
  if (!allowedNetworkImportPaths.includes(path)) failures.push(`unexpected native HTTP import in ${path}`);
}
if (!networkImportPaths.includes('src/ai.ts') || !networkImportPaths.includes('src/arena.ts')) {
  failures.push('expected AI transport modules are missing their explicit HTTP boundary');
}

warnings.push('This is a static boundary audit, not a penetration test or Windows ACL/reparse-point race test.');
warnings.push('The Ollama loopback capability does not prove that a cloud model is not selected by the local provider.');

if (failures.length) {
  console.error('Static security audit FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Static security audit passed: CSP, capability scope, forbidden dynamic HTML/code patterns, Markdown DOM boundary, and HTTP import boundaries.');
}
for (const warning of warnings) console.log(`Warning: ${warning}`);
