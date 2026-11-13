# Verifying a Morrow Windows release

Morrow does not silently update itself. A tagged preview is a set of inspectable files: the NSIS installer, a SHA-256 file, dependency inventories, a release manifest, a release-specific winget manifest and a GitHub artifact provenance attestation.

The release workflow has two permissions boundaries:

- The Windows build and all pull-request jobs are read-only. They run the frontend, UI and Rust checks, create the installer, generate SBOMs and validate licenses.
- Only a `v*` tag can run the publish job. That job verifies the source version, commit and every checksum before it receives release-write, OIDC and attestation permissions.

## Verify a download without Node or Rust

Download the installer and `SHA256SUMS.txt` from the same GitHub release. In PowerShell:

```powershell
$installer = Get-ChildItem .\*-setup.exe | Select-Object -First 1
$expected = (Get-Content .\SHA256SUMS.txt | Where-Object { $_ -match [regex]::Escape($installer.Name) }).Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum mismatch: do not run $($installer.Name)." }
"Checksum verified: $actual"
```

On Linux or macOS, the equivalent is:

```bash
sha256sum -c SHA256SUMS.txt
```

A matching checksum proves that the downloaded bytes match the bytes published by this repository. It does not, by itself, prove publisher identity. The checksum and Authenticode checks below run locally without Node, Rust or a GitHub token; the offline attestation-bundle check also needs no token.

## Check publisher signing

Open `SIGNING-MODE.txt` first.

- `signed` means the Windows build verified an Authenticode signature and timestamp before publishing. Run:

  ```powershell
  Get-AuthenticodeSignature .\Morrow_*setup.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
  ```

  On a clean consumer Windows VM, the status must be `Valid`, `SignerCertificate` must be the expected publisher, and `TimeStamperCertificate` must be present. Compare the signer thumbprint with the public `SIGNATURE-VERIFICATION.txt` report; the report is evidence of what the build verified, while the VM check confirms the installed trust chain.

- `unsigned-preview` is an explicit early-preview fallback. Windows may show an unknown-publisher SmartScreen warning; do not treat the checksum as a replacement for a publisher signature.

Signing is fail-closed when the repository's `MORROW_SIGNING_REQUIRED` variable is `true`. When a certificate is configured, the repository must also provide `MORROW_SIGNING_CERTIFICATE_THUMBPRINT`; the build compares the embedded signer thumbprint with that expected identity, verifies the Authenticode chain and requires a trusted timestamp. A missing or invalid certificate fails the tagged build rather than producing a misleading signed label. The thumbprint and expected publisher should be recorded in the repository's protected release configuration, never guessed from the installer.

Maintainers configure `MORROW_SIGNING_CERTIFICATE` as a base64-encoded PFX secret, `MORROW_SIGNING_CERTIFICATE_PASSWORD` as a protected secret, and `MORROW_SIGNING_CERTIFICATE_THUMBPRINT` as a repository variable. `MORROW_TIMESTAMP_URL` may select an approved RFC 3161 service; `MORROW_SIGNING_REQUIRED=true` makes a certificate mandatory for tagged releases.

## Check build provenance

GitHub stores an artifact attestation for the installer, both lockfiles and the generated SBOM inputs. The release also includes an `attestations/` bundle for each subject, so provenance can be checked offline after downloading the bundle. With a GitHub CLI version that supports artifact attestations:

```bash
gh attestation verify Morrow_0.4.0_x64-setup.exe \
  --repo RANJITHROSAN17/morrow-editor \
  --bundle attestations/Morrow_0.4.0_x64-setup.exe.intoto.jsonl
```

The `--bundle` form needs no GitHub token and checks the signed SLSA provenance statement locally. Repeat it for `package-lock.json`, `Cargo.lock`, `npm-sbom.cdx.json` and `cargo-metadata.json` when auditing those subjects. The attached `RELEASE-MANIFEST.json` records the exact source commit, tag, signing mode and SHA-256 values. `PROVENANCE.md` repeats the same information in a human-readable form.

The release also contains:

- `npm-sbom.cdx.json`: CycloneDX inventory produced from `package-lock.json`;
- `cargo-metadata.json`: the complete locked Cargo dependency graph;
- `LICENSE-REPORT.json`: package counts, SPDX identifiers, missing metadata and the notices coverage result;
- `package-lock.json` and `Cargo.lock`: the exact dependency inputs;
- `winget/`: a release-specific manifest whose installer URL and SHA-256 point to this tag.

The release job refuses to publish if the tag does not match the package, Tauri and Cargo versions, if the source commit differs, if an installer checksum changes, or if an SBOM/license input is missing.

## Package-manager path

The release-specific manifest is suitable for inspection or a local WinGet install without waiting for an official catalog submission. Download the three YAML files under `winget/` into one directory and run:

```powershell
winget install --manifest .\winget
```

WinGet still applies its own publisher and package policies. This local manifest is not a claim that the package has already been accepted into the public WinGet community source.

## Rollback and reinstall

There is no automatic updater or forced migration. To roll back, save or back up your work, uninstall Morrow from **Windows Settings → Apps**, download an earlier tagged release, verify its checksum and signing mode, and install it. Morrow stores user files separately from the application; keep a copy of important files before any reinstall.
