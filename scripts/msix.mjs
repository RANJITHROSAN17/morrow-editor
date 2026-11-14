#!/usr/bin/env node
// Builds the MSIX package layout for Microsoft Store submission.
//
// Store identity values come from Partner Center when the product name is reserved, so they are
// required inputs and are never invented here. Pass them as flags or environment variables:
//   MORROW_MSIX_IDENTITY_NAME, MORROW_MSIX_PUBLISHER, MORROW_MSIX_PUBLISHER_DISPLAY_NAME
//
// Usage:
//   node scripts/msix.mjs layout <exe> <assetsDir> <layoutDir> [--identity-name N --publisher P --publisher-display-name D]
//   node scripts/msix.mjs check  [same identity flags]     validates the inputs and prints the version
//
// The layout is then packed with the Windows SDK tool, for example:
//   makeappx pack /d <layoutDir> /p Wrytrove_0.4.0.0_x64.msix /o
// Store submission accepts an unsigned MSIX because Microsoft signs it after certification.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXECUTABLE = 'wrytrove-editor.exe';
const ASSET_FILES = ['Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png'];
// Windows 10 1809 is the first build that supports the packaged full-trust desktop model used here.
const MIN_WINDOWS = '10.0.17763.0';
const MAX_TESTED_WINDOWS = '10.0.22621.0';

export function fail(message) {
  throw new Error(message);
}

export function packageVersion(semver) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(semver || '');
  if (!match) fail(`Expected a three-part version such as 0.4.0, got ${semver || '(empty)'}.`);
  // MSIX versions have four numeric parts; the last is reserved for Store builds and stays 0 here.
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function validateIdentity({ identityName, publisher, publisherDisplayName }) {
  if (!identityName || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/u.test(identityName)) {
    fail('Identity name is missing or invalid. Copy the Package/Identity/Name value from Partner Center.');
  }
  if (!publisher || !/^CN=[^\r\n]+$/u.test(publisher)) {
    fail('Publisher is missing or invalid. Copy the Package/Identity/Publisher value (it starts with CN=) from Partner Center.');
  }
  if (!publisherDisplayName || publisherDisplayName.trim().length === 0 || publisherDisplayName.length > 256) {
    fail('Publisher display name is missing. Copy Package/Properties/PublisherDisplayName from Partner Center.');
  }
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

export function manifestXml({ identityName, publisher, publisherDisplayName, version }) {
  validateIdentity({ identityName, publisher, publisherDisplayName });
  const v4 = packageVersion(version);
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="${xmlEscape(identityName)}" Publisher="${xmlEscape(publisher)}" Version="${v4}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Wrytrove</DisplayName>
    <PublisherDisplayName>${xmlEscape(publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${MIN_WINDOWS}" MaxVersionTested="${MAX_TESTED_WINDOWS}" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="Wrytrove" Executable="${EXECUTABLE}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Wrytrove"
                          Description="A small, local-first text and code editor"
                          BackgroundColor="transparent"
                          Square150x150Logo="Assets\\Square150x150Logo.png"
                          Square44x44Logo="Assets\\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

function identityFromArgs(args, env = process.env) {
  const flag = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    identityName: flag('identity-name') ?? env.MORROW_MSIX_IDENTITY_NAME,
    publisher: flag('publisher') ?? env.MORROW_MSIX_PUBLISHER,
    publisherDisplayName: flag('publisher-display-name') ?? env.MORROW_MSIX_PUBLISHER_DISPLAY_NAME,
  };
}

function readVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

export function layout({ exe, assetsDir, layoutDir, identity, version = readVersion() }) {
  if (!exe || !existsSync(exe)) fail(`Executable not found: ${exe}. Build with npm run tauri build -- --target x86_64-pc-windows-msvc first.`);
  if (!assetsDir || !existsSync(assetsDir)) fail(`Assets folder not found: ${assetsDir}.`);
  for (const asset of ASSET_FILES) {
    if (!existsSync(join(assetsDir, asset))) fail(`Missing MSIX asset ${asset} in ${assetsDir}.`);
  }
  mkdirSync(join(layoutDir, 'Assets'), { recursive: true });
  copyFileSync(exe, join(layoutDir, EXECUTABLE));
  for (const asset of ASSET_FILES) copyFileSync(join(assetsDir, asset), join(layoutDir, 'Assets', asset));
  writeFileSync(join(layoutDir, 'AppxManifest.xml'), manifestXml({ ...identity, version }));
  return { manifest: join(layoutDir, 'AppxManifest.xml'), version: packageVersion(version) };
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'check') {
    const identity = identityFromArgs(rest);
    validateIdentity(identity);
    console.log(`MSIX identity inputs are valid. Package version ${packageVersion(readVersion())}.`);
    return;
  }
  if (command === 'layout') {
    const [exe, assetsDir, layoutDir] = rest;
    if (!layoutDir) fail('Usage: msix.mjs layout <exe> <assetsDir> <layoutDir> [identity flags]');
    const result = layout({
      exe: resolve(ROOT, exe),
      assetsDir: resolve(ROOT, assetsDir),
      layoutDir: resolve(ROOT, layoutDir),
      identity: identityFromArgs(rest.slice(3)),
    });
    console.log(`Wrote ${result.manifest} for package version ${result.version}.`);
    return;
  }
  fail('Usage: msix.mjs layout <exe> <assetsDir> <layoutDir> | msix.mjs check');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
