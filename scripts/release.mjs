#!/usr/bin/env node
/**
 * Release guardrails that are deliberately dependency-free so the tagged workflow can run them
 * before publishing. The Windows build creates the inputs; the tag-only job verifies the manifest
 * again before it receives a writable GitHub token.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPDX_OPERATORS = new Set(['AND', 'OR', 'WITH', 'NONE', 'NOASSERTION']);
const REPOSITORY = process.env.GITHUB_REPOSITORY || 'RANJITHROSAN17/morrow-editor';

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`Could not read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function packageVersion() {
  const packageJson = readJson(join(ROOT, 'package.json'));
  const lock = readJson(join(ROOT, 'package-lock.json'));
  const tauri = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'));
  const cargo = readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/mu)?.[1];
  const versions = [packageJson.version, lock.packages?.['']?.version, tauri.version, cargo];
  if (versions.some((version) => typeof version !== 'string' || !version)) fail('A release version is missing from package.json, package-lock.json, tauri.conf.json or Cargo.toml.');
  if (new Set(versions).size !== 1) fail(`Release version mismatch: ${versions.join(', ')}.`);
  return versions[0];
}

function versionFromTag(tag) {
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    fail(`Expected a semantic version tag such as v${packageVersion()}, got ${tag || '(empty)'}.`);
  }
  return tag.slice(1).split('-', 1)[0];
}

function verifyTag(tag) {
  const version = packageVersion();
  if (versionFromTag(tag) !== version) fail(`Tag ${tag} does not match the source version ${version}.`);
  console.log(`Release tag ${tag} matches Morrow ${version}.`);
  return version;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ensureDirectory(path) { mkdirSync(path, { recursive: true }); }

function run(command, args, options = {}) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed${result.stderr ? `:\n${result.stderr}` : '.'}`);
  return result.stdout;
}

function parseSpdxIds(expression) {
  if (typeof expression !== 'string') return [];
  return [...new Set((expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/gu) || [])
    .filter((id) => !SPDX_OPERATORS.has(id)))];
}

function licenseRecords(npmSbom, cargoMetadata) {
  const packageLock = readJson(join(ROOT, 'package-lock.json'));
  const npm = Object.entries(packageLock.packages || {})
    .filter(([path, entry]) => path && entry?.version)
    .map(([path, entry]) => ({ ecosystem: 'npm', name: path.replace(/^node_modules\//u, ''), version: entry.version, license: entry.license || null }));
  const cargo = (cargoMetadata.packages || []).map((entry) => ({
    ecosystem: 'cargo', name: entry.name, version: entry.version,
    license: entry.license || null, licenseFile: entry.license_file || null,
  }));
  const missingMetadata = [...npm, ...cargo].filter((entry) => (
    (!entry.license && !entry.licenseFile) || entry.license === 'NONE' || entry.license === 'NOASSERTION'
  ));
  const expressions = [...npm, ...cargo].flatMap((entry) => parseSpdxIds(entry.license));
  for (const component of npmSbom.components || []) {
    for (const license of component.licenses || []) {
      const value = license.license?.id || license.license?.name || license.expression;
      expressions.push(...parseSpdxIds(value));
    }
  }
  return { npm, cargo, missingMetadata, ids: [...new Set(expressions)].sort() };
}

function generateSbom(directory) {
  const out = resolve(ROOT, directory || 'release');
  ensureDirectory(out);
  let npmOutput;
  try {
    npmOutput = run('npm', ['sbom', '--package-lock-only', '--sbom-format', 'cyclonedx']);
  } catch (error) {
    writeFileSync(join(out, 'SBOM-ERROR.txt'), `${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
  let npmSbom;
  try { npmSbom = JSON.parse(npmOutput); }
  catch (error) { fail(`npm sbom did not produce JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (npmSbom.bomFormat !== 'CycloneDX' || !Array.isArray(npmSbom.components) || !npmSbom.components.length) fail('The npm SBOM is empty or is not CycloneDX JSON.');
  if (process.env.SOURCE_DATE_EPOCH) {
    const epoch = Number(process.env.SOURCE_DATE_EPOCH);
    if (!Number.isFinite(epoch) || epoch < 0) fail(`Invalid SOURCE_DATE_EPOCH: ${process.env.SOURCE_DATE_EPOCH}.`);
    npmSbom.metadata = { ...(npmSbom.metadata || {}), timestamp: new Date(epoch * 1000).toISOString() };
  }
  writeFileSync(join(out, 'npm-sbom.cdx.json'), `${JSON.stringify(npmSbom, null, 2)}\n`);

  let cargoOutput;
  try {
    cargoOutput = run('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--format-version', '1']);
  } catch (error) {
    writeFileSync(join(out, 'SBOM-ERROR.txt'), `${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
  let cargoMetadata;
  try { cargoMetadata = JSON.parse(cargoOutput); }
  catch (error) { fail(`cargo metadata did not produce JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (cargoMetadata.version !== 1 || !Array.isArray(cargoMetadata.packages) || !cargoMetadata.packages.length) fail('Cargo metadata is empty or has an unsupported format.');
  writeFileSync(join(out, 'cargo-metadata.json'), `${JSON.stringify(cargoMetadata, null, 2)}\n`);

  const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const records = licenseRecords(npmSbom, cargoMetadata);
  const missingNotices = records.ids.filter((id) => !notices.includes(id));
  const report = {
    schemaVersion: 1,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH || null,
    npmPackages: records.npm.length,
    cargoPackages: records.cargo.length,
    packages: [...records.npm, ...records.cargo],
    licenseIds: records.ids,
    packagesWithoutLicenseMetadata: records.missingMetadata,
    licenseIdsMissingFromThirdPartyNotices: missingNotices,
  };
  writeFileSync(join(out, 'LICENSE-REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (records.missingMetadata.length) fail(`The dependency metadata has no license or license_file for ${records.missingMetadata.length} package(s).`);
  if (missingNotices.length) fail(`Add these SPDX identifiers to THIRD_PARTY_NOTICES.md before publishing: ${missingNotices.join(', ')}.`);
  console.log(`Wrote SBOMs for ${records.npm.length} npm and ${records.cargo.length} Cargo packages.`);
}

function installerFiles(directory) {
  const out = readdirSync(directory).filter((name) => /-setup\.exe$/iu.test(name)).sort();
  if (!out.length) fail(`No NSIS installer was found in ${directory}.`);
  return out;
}

function stageInstallers(sourceDirectory, destinationDirectory) {
  const source = resolve(ROOT, sourceDirectory);
  const destination = resolve(ROOT, destinationDirectory || 'release');
  ensureDirectory(destination);
  for (const name of installerFiles(source)) copyFileSync(join(source, name), join(destination, name));
  console.log(`Staged ${installerFiles(source).length} installer(s).`);
}

function checksumMap(directory) {
  const path = join(directory, 'SHA256SUMS.txt');
  if (!existsSync(path)) fail(`Missing ${path}.`);
  const entries = new Map();
  for (const line of readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/^([0-9a-f]{64})\s+(?:\*?)([^\s]+)$/iu);
    if (!match) fail(`Invalid checksum line: ${line}`);
    if (entries.has(match[2])) fail(`Duplicate checksum entry for ${match[2]}.`);
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

function writeChecksums(directory) {
  const out = resolve(ROOT, directory || 'release');
  const lines = installerFiles(out).map((name) => `${sha256(join(out, name))}  ${name}`);
  writeFileSync(join(out, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  console.log(`Wrote ${join(out, 'SHA256SUMS.txt')}.`);
}

function sourceInputs(directory) {
  const inputNames = ['package-lock.json', 'Cargo.lock', 'npm-sbom.cdx.json', 'cargo-metadata.json', 'LICENSE-REPORT.json'];
  return inputNames.map((name) => {
    const path = join(directory, name);
    if (!existsSync(path)) fail(`Release input ${name} is missing.`);
    return { name, sha256: sha256(path) };
  });
}

function writeManifest(directory, tag, commit) {
  const out = resolve(ROOT, directory || 'release');
  const version = verifyTag(tag);
  if (!/^[0-9a-f]{40}$/iu.test(commit || '')) fail(`Expected a full source commit SHA, got ${commit || '(empty)'}.`);
  const installers = installerFiles(out);
  if (installers.length !== 1) fail(`Expected exactly one release installer, found ${installers.length}.`);
  const sums = checksumMap(out);
  const installer = installers[0];
  if (sums.get(installer) !== sha256(join(out, installer))) fail(`Checksum does not match ${installer}.`);
  const signingMode = readFileSync(join(out, 'SIGNING-MODE.txt'), 'utf8').trim();
  if (!['signed', 'unsigned-preview'].includes(signingMode)) fail(`Invalid signing mode: ${signingMode}.`);
  const manifest = {
    schemaVersion: 1,
    product: 'Morrow',
    version,
    tag,
    commit,
    repository: REPOSITORY,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH || null,
    signingMode,
    installer: { name: installer, sha256: sums.get(installer) },
    inputs: sourceInputs(out),
  };
  writeFileSync(join(out, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const markdownTick = '`';
  const lines = [
    '# Morrow release provenance',
    '',
    `- Version: ${markdownTick}${version}${markdownTick}`,
    `- Tag: ${markdownTick}${tag}${markdownTick}`,
    `- Source commit: ${markdownTick}${commit}${markdownTick}`,
    `- Signing mode: **${signingMode}**`,
    `- Installer SHA-256: ${markdownTick}${sums.get(installer)}${markdownTick}`,
    '',
    'The release was built from the checked-in frontend and Rust lockfiles. The attached',
    '`npm-sbom.cdx.json`, `cargo-metadata.json` and `LICENSE-REPORT.json` describe the resolved',
    'dependency inputs. GitHub also stores an artifact provenance attestation for the release',
    'subjects. The release also carries an offline bundle for each attested subject. Verify this',
    'installer provenance without installing Node or Rust or using a GitHub token:',
    '',
    `${markdownTick}gh attestation verify ${installer} --repo ${REPOSITORY} --bundle attestations/${installer}.intoto.jsonl${markdownTick}`,
    '',
    'The checksum verifies downloaded bytes; a valid Authenticode signature verifies publisher',
    'identity only when this release is marked signed. No automatic updater is enabled.',
  ];
  writeFileSync(join(out, 'PROVENANCE.md'), `${lines.join('\n')}\n`);
}

function quoteYaml(value) { return `'${String(value).replace(/'/gu, "''")}'`; }

function writeWinget(directory, tag) {
  const out = resolve(ROOT, directory || 'release');
  const version = verifyTag(tag);
  const installers = installerFiles(out);
  if (installers.length !== 1) fail(`Expected exactly one release installer, found ${installers.length}.`);
  const installer = installers[0];
  const sums = checksumMap(out);
  const hash = sums.get(installer);
  const base = `https://github.com/${REPOSITORY}/releases/download/${tag}/${encodeURIComponent(installer)}`;
  const manifestDirectory = join(out, 'winget');
  ensureDirectory(manifestDirectory);
  const common = [
    'PackageIdentifier: RANJITHROSAN17.Morrow',
    `PackageVersion: ${version}`,
  ];
  writeFileSync(join(manifestDirectory, 'RANJITHROSAN17.Morrow.yaml'), `${[
    ...common,
    'PackageLocale: en-US',
    'Publisher: RANJITHROSAN17',
    'PublisherUrl: https://github.com/RANJITHROSAN17',
    'PackageName: Morrow',
    'PackageUrl: https://github.com/RANJITHROSAN17/morrow-editor',
    'License: MIT',
    'ShortDescription: A small local-first text and code editor for Windows.',
    'ManifestType: defaultLocale',
    'ManifestVersion: 1.6.0',
  ].join('\n')}\n`);
  writeFileSync(join(manifestDirectory, 'RANJITHROSAN17.Morrow.locale.en-US.yaml'), `${[
    ...common,
    'PackageLocale: en-US',
    'Publisher: RANJITHROSAN17',
    'PublisherUrl: https://github.com/RANJITHROSAN17',
    'PackageName: Morrow',
    'PackageUrl: https://github.com/RANJITHROSAN17/morrow-editor',
    'License: MIT',
    'ShortDescription: A small local-first text and code editor for Windows.',
    'Description: Morrow is a local-first text and code editor for notes and quick programming tasks.',
    'ManifestType: locale',
    'ManifestVersion: 1.6.0',
  ].join('\n')}\n`);
  writeFileSync(join(manifestDirectory, 'RANJITHROSAN17.Morrow.installer.yaml'), `${[
    ...common,
    'Installers:',
    '- Architecture: x64',
    '  InstallerType: nullsoft',
    `  InstallerUrl: ${quoteYaml(base)}`,
    `  InstallerSha256: ${hash}`,
    'ManifestType: installer',
    'ManifestVersion: 1.6.0',
  ].join('\n')}\n`);
  console.log(`Wrote a release-specific winget manifest for ${installer}.`);
}

function verifyRelease(directory, tag, commit) {
  const out = resolve(ROOT, directory || 'release');
  const version = verifyTag(tag);
  if (!/^[0-9a-f]{40}$/iu.test(commit || '')) fail(`Expected a full source commit SHA, got ${commit || '(empty)'}.`);
  const manifest = readJson(join(out, 'RELEASE-MANIFEST.json'));
  if (manifest.schemaVersion !== 1 || manifest.version !== version || manifest.tag !== tag || manifest.commit !== commit) fail('Release manifest does not match the tag, source version or commit.');
  const sums = checksumMap(out);
  const installers = installerFiles(out);
  for (const name of installers) {
    if (sums.get(name) !== sha256(join(out, name))) fail(`SHA256SUMS.txt does not match ${name}.`);
  }
  if (installers.length !== 1 || manifest.installer?.name !== installers[0] || manifest.installer?.sha256 !== sums.get(installers[0])) {
    fail('Release manifest installer name or checksum does not match SHA256SUMS.txt.');
  }
  const signingMode = readFileSync(join(out, 'SIGNING-MODE.txt'), 'utf8').trim();
  if (manifest.signingMode !== signingMode || !['signed', 'unsigned-preview'].includes(signingMode)) fail('Release manifest signing mode does not match SIGNING-MODE.txt.');
  const expectedInputs = new Set(['package-lock.json', 'Cargo.lock', 'npm-sbom.cdx.json', 'cargo-metadata.json', 'LICENSE-REPORT.json']);
  const actualInputs = new Set((manifest.inputs || []).map((input) => input.name));
  if (actualInputs.size !== expectedInputs.size || [...expectedInputs].some((name) => !actualInputs.has(name))) fail('Release manifest does not cover every lockfile, SBOM and license report input.');
  for (const input of manifest.inputs || []) {
    if (!existsSync(join(out, input.name)) || sha256(join(out, input.name)) !== input.sha256) fail(`Release input checksum changed: ${input.name}.`);
  }
  const report = readJson(join(out, 'LICENSE-REPORT.json'));
  if (report.packagesWithoutLicenseMetadata?.length || report.licenseIdsMissingFromThirdPartyNotices?.length) fail('The release license report contains unresolved dependency metadata or notice identifiers.');
  if (!existsSync(join(out, 'PROVENANCE.md')) || !existsSync(join(out, 'npm-sbom.cdx.json')) || !existsSync(join(out, 'cargo-metadata.json')) || !existsSync(join(out, 'SIGNATURE-VERIFICATION.txt'))) {
    fail('The release is missing a provenance, SBOM or signature asset.');
  }
  const wingetPath = join(out, 'winget', 'RANJITHROSAN17.Morrow.installer.yaml');
  if (!existsSync(wingetPath)) fail('The release-specific winget installer manifest is missing.');
  const winget = readFileSync(wingetPath, 'utf8');
  const expectedUrl = `releases/download/${tag}/${encodeURIComponent(installers[0])}`;
  if (!winget.includes(`InstallerSha256: ${sums.get(installers[0])}`) || !winget.includes(expectedUrl)) fail('The winget manifest does not match the release installer URL or checksum.');
  console.log(`Verified release ${tag} at ${commit}.`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'verify-tag': verifyTag(args[0] || process.env.GITHUB_REF_NAME); break;
    case 'sbom': generateSbom(args[0]); break;
    case 'stage-installers': stageInstallers(args[0], args[1]); break;
    case 'checksums': writeChecksums(args[0]); break;
    case 'manifest': writeManifest(args[0], args[1] || process.env.GITHUB_REF_NAME, args[2] || process.env.GITHUB_SHA); break;
    case 'winget': writeWinget(args[0], args[1] || process.env.GITHUB_REF_NAME); break;
    case 'verify-release': verifyRelease(args[0], args[1] || process.env.GITHUB_REF_NAME, args[2] || process.env.GITHUB_SHA); break;
    default: fail('Usage: release.mjs verify-tag <vX.Y.Z> | sbom <dir> | stage-installers <source-dir> <dir> | checksums <dir> | manifest <dir> <tag> <commit> | winget <dir> <tag> | verify-release <dir> <tag> <commit>');
  }
}

try { main(); }
catch (error) {
  console.error(`release guard failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
