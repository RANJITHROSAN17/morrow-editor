import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/windows.yml'), 'utf8');
const helper = readFileSync(resolve(root, 'scripts/release.mjs'), 'utf8');
const verification = readFileSync(resolve(root, 'docs/RELEASE-VERIFICATION.md'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

function runRelease(...args: string[]) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/release.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('tagged release guard', () => {
  it('accepts the checked-in source version and rejects a different tag', () => {
    expect(execFileSync(process.execPath, [resolve(root, 'scripts/release.mjs'), 'verify-tag', 'v0.4.0'], {
      cwd: root,
      encoding: 'utf8',
    })).toContain('matches Morrow 0.4.0');

    const invalid = runRelease('verify-tag', 'v0.4.1');
    expect(invalid.status).not.toBe(0);
    expect(`${invalid.stdout}${invalid.stderr}`).toContain('does not match the source version');
  });

  it('keeps the publish permissions and attestation subjects tag-only', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow.slice(0, workflow.indexOf('\njobs:'))).not.toContain('secrets.');
    expect(workflow).toContain('if: startsWith(github.ref, \'refs/tags/v\')');
    expect(workflow.slice(0, workflow.indexOf('\n  publish:'))).not.toContain('contents: write');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('attestations: write');
    expect(workflow).toContain('uses: actions/attest-build-provenance@v2');
    expect(workflow).toContain('dist/*-setup.exe');
    expect(workflow).toContain('dist/package-lock.json');
    expect(workflow).toContain('dist/Cargo.lock');
    expect(workflow).toContain('dist/npm-sbom.cdx.json');
    expect(workflow).toContain('dist/cargo-metadata.json');
    expect(workflow).toContain('gh attestation download');
    expect(workflow).toContain('dist/attestations/*.intoto.jsonl');
  });

  it('fails closed for signing configuration and verifies publisher identity', () => {
    expect(workflow).toContain('MORROW_SIGNING_REQUIRED');
    expect(workflow).toContain('id: signing_mode');
    expect(workflow).toContain('MORROW_SIGNING_CERTIFICATE');
    expect(workflow).toContain('signtool.exe');
    expect(workflow).toContain('/tr $env:MORROW_TIMESTAMP_URL');
    expect(workflow).toContain('/td SHA256');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain('MORROW_SIGNING_CERTIFICATE_THUMBPRINT');
    expect(workflow).toContain("$signature.Status -ne 'Valid'");
    expect(workflow).toContain('$signature.TimeStamperCertificate');
    expect(workflow).toContain('unsigned-preview');
  });

  it('contains lockfile-driven SBOM, license, checksum and mismatch checks', () => {
    expect(helper).toContain("npm', ['sbom', '--package-lock-only', '--sbom-format', 'cyclonedx'");
    expect(helper).toContain("cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--format-version', '1'");
    expect(helper).toContain('packagesWithoutLicenseMetadata');
    expect(helper).toContain('licenseIdsMissingFromThirdPartyNotices');
    expect(helper).toContain('Release manifest does not match the tag, source version or commit.');
    expect(helper).toContain('SHA256SUMS.txt does not match');
    expect(helper).toContain('release-specific winget manifest');
  });
});

describe('release verification documentation', () => {
  it('offers offline checksum and Authenticode checks without a Node or Rust toolchain', () => {
    expect(verification).toContain('Verify a download without Node or Rust');
    expect(verification).toContain('Get-FileHash');
    expect(verification).toContain('Get-AuthenticodeSignature');
    expect(verification).toContain('without Node, Rust or a GitHub token');
    expect(verification).toContain('unsigned-preview');
    expect(verification).toContain('There is no automatic updater or forced migration.');
  });

  it('labels the preview fallback consistently in the README', () => {
    expect(readme).toContain('unsigned-preview');
    expect(readme).toContain('release verification and rollback guide');
  });
});
