import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const helper = resolve(root, 'scripts/msix.mjs');
const cargoToml = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');

const IDENTITY = {
  identityName: 'Example.Wrytrove',
  publisher: 'CN=00000000-0000-0000-0000-000000000000',
  publisherDisplayName: 'Example Developer',
};

let scratch: string;

interface Identity {
  identityName: string;
  publisher: string;
  publisherDisplayName: string;
}

// The helper is plain JavaScript, so its exports are typed here for the test.
interface MsixHelper {
  packageVersion(version: string | undefined): string;
  validateIdentity(identity: Identity): void;
  manifestXml(input: Identity & { version: string }): string;
  layout(input: {
    exe: string;
    assetsDir: string;
    layoutDir: string;
    identity: Identity;
    version: string;
  }): { manifest: string; version: string };
}

async function loadHelper(): Promise<MsixHelper> {
  return (await import(pathToFileURL(helper).href)) as MsixHelper;
}

function tagsBalanced(xml: string): boolean {
  // Lightweight well-formedness check: every opened element name is closed or self-closed, in order.
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/gu;
  for (const match of xml.matchAll(tag)) {
    const [, closing, name, selfClosing] = match;
    if (match[0].startsWith('<?')) continue;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'wrytrove-msix-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('MSIX package inputs', () => {
  it('converts the product version to a four-part MSIX version', async () => {
    const { packageVersion } = await loadHelper();
    expect(packageVersion('0.4.0')).toBe('0.4.0.0');
    expect(packageVersion('1.12.3')).toBe('1.12.3.0');
  });

  it('refuses pre-release and malformed versions, which MSIX cannot represent', async () => {
    const { packageVersion } = await loadHelper();
    expect(() => packageVersion('0.4.0-rc.1')).toThrow(/three-part version/u);
    expect(() => packageVersion('0.4')).toThrow(/three-part version/u);
    expect(() => packageVersion(undefined)).toThrow(/three-part version/u);
  });

  it('requires the Partner Center identity values and refuses invented ones', async () => {
    const { validateIdentity } = await loadHelper();
    expect(() => validateIdentity({ ...IDENTITY, identityName: '' })).toThrow(/Identity name/u);
    expect(() => validateIdentity({ ...IDENTITY, identityName: 'has spaces' })).toThrow(/Identity name/u);
    expect(() => validateIdentity({ ...IDENTITY, publisher: 'Example Developer' })).toThrow(/CN=/u);
    expect(() => validateIdentity({ ...IDENTITY, publisherDisplayName: '   ' })).toThrow(/display name/u);
    expect(() => validateIdentity(IDENTITY)).not.toThrow();
  });
});

describe('AppxManifest.xml', () => {
  it('declares the identity, executable, full-trust entry point and Store logo paths', async () => {
    const { manifestXml } = await loadHelper();
    const xml = manifestXml({ ...IDENTITY, version: '0.4.0' });
    expect(xml).toContain(`Name="${IDENTITY.identityName}"`);
    expect(xml).toContain(`Publisher="${IDENTITY.publisher}"`);
    expect(xml).toContain('Version="0.4.0.0"');
    expect(xml).toContain('ProcessorArchitecture="x64"');
    expect(xml).toContain('Executable="wrytrove-editor.exe"');
    expect(xml).toContain('EntryPoint="Windows.FullTrustApplication"');
    expect(xml).toContain('<rescap:Capability Name="runFullTrust" />');
    expect(xml).toContain('<Logo>Assets\\StoreLogo.png</Logo>');
    expect(xml).toContain('Square44x44Logo="Assets\\Square44x44Logo.png"');
    expect(xml).toContain('Square150x150Logo="Assets\\Square150x150Logo.png"');
  });

  it('escapes Partner Center text so it cannot break the XML', async () => {
    const { manifestXml } = await loadHelper();
    const xml = manifestXml({ ...IDENTITY, publisherDisplayName: 'Ada & Co <Dev> "x"', version: '0.4.0' });
    expect(xml).toContain('<PublisherDisplayName>Ada &amp; Co &lt;Dev&gt; &quot;x&quot;</PublisherDisplayName>');
    expect(tagsBalanced(xml)).toBe(true);
  });

  it('produces balanced element nesting', async () => {
    const { manifestXml } = await loadHelper();
    expect(tagsBalanced(manifestXml({ ...IDENTITY, version: '0.4.0' }))).toBe(true);
  });

  it('uses the same executable name that Cargo builds for the desktop package', () => {
    const cargoName = cargoToml.match(/^name\s*=\s*"([^"]+)"/mu)?.[1];
    expect(cargoName).toBe('wrytrove-editor');
  });
});

describe('MSIX layout', () => {
  it('copies the executable, the logos and the manifest into the package folder', async () => {
    const { layout } = await loadHelper();
    const exe = join(scratch, 'wrytrove-editor.exe');
    writeFileSync(exe, 'synthetic executable bytes');
    const assets = join(scratch, 'assets');
    cpSync(resolve(root, 'src-tauri/icons/msix'), assets, { recursive: true });
    const out = join(scratch, 'layout');

    const result = layout({ exe, assetsDir: assets, layoutDir: out, identity: IDENTITY, version: '0.4.0' });

    expect(result.version).toBe('0.4.0.0');
    expect(existsSync(join(out, 'wrytrove-editor.exe'))).toBe(true);
    for (const name of ['Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png']) {
      expect(existsSync(join(out, 'Assets', name))).toBe(true);
    }
    expect(readFileSync(join(out, 'AppxManifest.xml'), 'utf8')).toContain('Version="0.4.0.0"');
  });

  it('refuses to build a layout when a logo is missing', async () => {
    const { layout } = await loadHelper();
    const exe = join(scratch, 'missing-logo.exe');
    writeFileSync(exe, 'x');
    const assets = join(scratch, 'partial-assets');
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, 'StoreLogo.png'), 'x');
    expect(() => layout({ exe, assetsDir: assets, layoutDir: join(scratch, 'x'), identity: IDENTITY, version: '0.4.0' })).toThrow(/Missing MSIX asset/u);
  });

  it('refuses to build a layout without an executable', async () => {
    const { layout } = await loadHelper();
    expect(() => layout({ exe: join(scratch, 'nope.exe'), assetsDir: scratch, layoutDir: join(scratch, 'y'), identity: IDENTITY, version: '0.4.0' })).toThrow(/Executable not found/u);
  });

  it('exposes the command line with the same validation', () => {
    const result = spawnSync(process.execPath, [helper, 'check'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, MORROW_MSIX_IDENTITY_NAME: '', MORROW_MSIX_PUBLISHER: '', MORROW_MSIX_PUBLISHER_DISPLAY_NAME: '' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Identity name');
  });
});
