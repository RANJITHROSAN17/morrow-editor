# Microsoft Store submission (MSIX)

This guide covers publishing Wrytrove to the Microsoft Store as an MSIX package. The MSIX route does not need a paid code-signing certificate, because Microsoft signs the package after certification.

**Status: started, not yet verified.** The manifest generator, logos and tests are in the repository. The packaging step runs in CI only when the Store identity values are configured. It has not yet been run on Windows, and no package has been through Store certification.

## 1. Create a developer account

1. Go to storedeveloper.microsoft.com and choose **Get started for free**, then **Individual developer**.
2. Sign in with a personal Microsoft account and complete identity verification with a government ID and a selfie.

Individual registration is free. Company accounts have a one-time fee, so check the current amount before choosing that type.

## 2. Reserve the product name

1. In Partner Center, open **Apps and games** → **New product** → **MSIX or PWA**.
2. Enter **Wrytrove**, choose **Check availability**, then **Reserve product name**.
3. Open **Product management → Product identity** and copy three values:
   - **Package/Identity/Name** (for example `12345Publisher.Wrytrove`)
   - **Package/Identity/Publisher** (starts with `CN=`)
   - **Package/Properties/PublisherDisplayName**

These are issued by Partner Center. Do not make them up.

## 3. Store the identity values in the repository

In GitHub, open **Settings → Secrets and variables → Actions → Variables** and add three repository variables:

| Variable | Value |
| --- | --- |
| `MORROW_MSIX_IDENTITY_NAME` | Package/Identity/Name from step 2 |
| `MORROW_MSIX_PUBLISHER` | Package/Identity/Publisher from step 2 |
| `MORROW_MSIX_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName from step 2 |

These names keep the `MORROW_` prefix so they match the existing signing settings. The naming decision is still open.

When `MORROW_MSIX_IDENTITY_NAME` is set, the Windows workflow builds `msix-out/Wrytrove_<version>.0_x64.msix` and uploads it as the `Wrytrove-msix-unpublished` artifact. The release job does not download that artifact, so the package is not published to GitHub Releases.

## 4. Build and check locally (Windows)

After `npm run tauri build -- --target x86_64-pc-windows-msvc`:

```powershell
$env:MORROW_MSIX_IDENTITY_NAME = '<Package/Identity/Name>'
$env:MORROW_MSIX_PUBLISHER = '<Package/Identity/Publisher>'
$env:MORROW_MSIX_PUBLISHER_DISPLAY_NAME = '<PublisherDisplayName>'
node scripts/msix.mjs check
node scripts/msix.mjs layout src-tauri/target/x86_64-pc-windows-msvc/release/wrytrove-editor.exe src-tauri/icons/msix build/msix-layout
& "C:\Program Files (x86)\Windows Kits\10\bin\<sdk-version>\x64\makeappx.exe" pack /d build/msix-layout /p Wrytrove_0.4.0.0_x64.msix /o
```

The `makeappx.exe` path depends on the installed Windows SDK version. The Windows SDK is required.

## 5. Certify and submit

1. Run the Windows App Certification Kit on the package before submitting.
2. In Partner Center, upload the `.msix` under **Packages**.
3. Complete the listing: description, screenshots, age rating, support contact and privacy policy URL.
4. For a paid app, set the price and complete the tax and payment profile.
5. Choose **Submit for certification**.

## What is not covered yet

- **Store validation has not been run.** The manifest and layout are generated and tested, but not packed or certified.
- **Sideload testing.** An unsigned MSIX will not install on a normal Windows PC. Testing it locally needs a test certificate. Store-signed packages do not.
- **Signing the NSIS installer.** This route is separate, and it is still blocked on the signing decision in [docs/RELEASE-VERIFICATION.md](RELEASE-VERIFICATION.md).
- **Privacy policy and support pages.** These must exist before submission.
- **Naming.** The `MORROW_*` variable names may be renamed later. If they are, update this guide, the workflow and the tests together.
