import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the real release helper against a generated release directory. These cases execute the
// refusal logic that the tag-only publish job relies on, rather than only checking that the
// workflow text mentions it.
const root = resolve(import.meta.dirname, '..');
const helper = resolve(root, 'scripts/release.mjs');
const TAG = 'v0.4.0';
const COMMIT = 'a'.repeat(40);
const INSTALLER = 'Wrytrove_0.4.0_x64-setup.exe';

let scratch: string;
let baseRelease: string;

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Builds a complete, valid release directory with the same helper commands the workflow uses.
const CLEAN_LICENSE_REPORT = '{"packagesWithoutLicenseMetadata":[],"licenseIdsMissingFromThirdPartyNotices":[]}\n';

function buildRelease(dir: string, licenseReport = CLEAN_LICENSE_REPORT) {
  writeFileSync(join(dir, INSTALLER), 'synthetic installer bytes');
  writeFileSync(join(dir, 'SIGNING-MODE.txt'), 'unsigned-preview\n');
  copyFileSync(resolve(root, 'package-lock.json'), join(dir, 'package-lock.json'));
  copyFileSync(resolve(root, 'src-tauri/Cargo.lock'), join(dir, 'Cargo.lock'));
  writeFileSync(join(dir, 'npm-sbom.cdx.json'), '{"bomFormat":"CycloneDX","components":[]}\n');
  writeFileSync(join(dir, 'cargo-metadata.json'), '{"packages":[]}\n');
  writeFileSync(join(dir, 'LICENSE-REPORT.json'), licenseReport);
  writeFileSync(join(dir, 'SIGNATURE-VERIFICATION.txt'), 'synthetic verification note\n');
  for (const step of [['checksums', dir], ['manifest', dir, TAG, COMMIT], ['winget', dir, TAG]]) {
    const result = run(...step);
    if (result.status !== 0) throw new Error(`fixture step ${step[0]} failed: ${result.output}`);
  }
}

function verify(dir: string, commit = COMMIT, tag = TAG) {
  return run('verify-release', dir, tag, commit);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'wrytrove-release-verify-'));
  // Build one complete release, then copy it for each case so every case starts from a verified state.
  baseRelease = join(scratch, 'base');
  mkdirSync(baseRelease, { recursive: true });
  buildRelease(baseRelease);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function fresh(name: string): string {
  const dir = join(scratch, name);
  cpSync(baseRelease, dir, { recursive: true });
  return dir;
}

describe('release verification refuses mismatched inputs', () => {
  it('accepts a complete release for the matching tag and commit', () => {
    const result = verify(fresh('ok'));
    expect(result.status).toBe(0);
    expect(result.output).toContain(`Verified release ${TAG} at ${COMMIT}.`);
  });

  it('refuses a tag that does not match the source version', () => {
    const result = verify(fresh('wrong-tag'), COMMIT, 'v0.4.1');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('does not match the source version');
  });

  it('refuses a commit that differs from the one recorded in the manifest', () => {
    const result = verify(fresh('wrong-commit'), 'b'.repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Release manifest does not match the tag, source version or commit');
  });

  it('refuses a malformed commit SHA', () => {
    const result = verify(fresh('short-commit'), 'abc123');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Expected a full source commit SHA');
  });

  it('refuses an installer whose bytes changed after checksums were written', () => {
    const dir = fresh('tampered-installer');
    writeFileSync(join(dir, INSTALLER), 'tampered bytes');
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`SHA256SUMS.txt does not match ${INSTALLER}`);
  });

  it('refuses a checksum file that lists a different digest for the installer', () => {
    const dir = fresh('bad-sums');
    const sums = readFileSync(join(dir, 'SHA256SUMS.txt'), 'utf8').replace(/^[0-9a-f]{64}/u, '0'.repeat(64));
    writeFileSync(join(dir, 'SHA256SUMS.txt'), sums);
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`SHA256SUMS.txt does not match ${INSTALLER}`);
  });

  it('refuses a signing mode that was changed after the manifest was written', () => {
    const dir = fresh('mode-changed');
    writeFileSync(join(dir, 'SIGNING-MODE.txt'), 'signed\n');
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('signing mode does not match SIGNING-MODE.txt');
  });

  it('refuses a dependency lockfile that changed after the manifest was written', () => {
    const dir = fresh('lock-changed');
    writeFileSync(join(dir, 'package-lock.json'), `${readFileSync(join(dir, 'package-lock.json'), 'utf8')}\n// tampered\n`);
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Release input checksum changed: package-lock.json');
  });

  it('refuses a release that contains a second installer that is not in the checksums', () => {
    const dir = fresh('two-installers');
    writeFileSync(join(dir, 'Wrytrove_0.4.0_extra-setup.exe'), 'second installer');
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('SHA256SUMS.txt does not match Wrytrove_0.4.0_extra-setup.exe');
  });

  it('refuses a release built from a license report with unresolved dependency metadata', () => {
    // Built the way the workflow would build it, so the manifest and checksums are internally consistent
    // and only the license gate can stop publication.
    const dir = join(scratch, 'license-gap');
    mkdirSync(dir, { recursive: true });
    buildRelease(dir, '{"packagesWithoutLicenseMetadata":["left-pad"],"licenseIdsMissingFromThirdPartyNotices":[]}\n');
    const result = verify(dir);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('unresolved dependency metadata');
  });
});
