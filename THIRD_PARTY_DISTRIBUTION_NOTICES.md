# Third-party distribution notices

Updated: 2026-09-10

This file records the notice files that must accompany Light Remote MCP binary packages. It does not grant a license to Light Remote MCP itself; the project-wide root license is a separate owner decision.

## Node.js runtime
Linux and Windows packages bundle Node.js `22.23.2`.

The Linux workflow downloads the official Node.js archive, verifies the official `SHASUMS256.txt`, and copies the archive's `LICENSE` into the package as:

`licenses/node/LICENSE`

The Windows workflow uses the pinned `actions/setup-node` runtime and copies its upstream `LICENSE` into the installer at the same relative path.

Official runtime source/download reference: https://nodejs.org/

## Microsoft .NET runtime
The Windows native client is published as a self-contained .NET 8 application. The package therefore carries the runtime license and third-party notices from the installed .NET distribution:

- `licenses/dotnet/LICENSE.txt`
- `licenses/dotnet/ThirdPartyNotices.txt`

Upstream runtime reference: https://github.com/dotnet/runtime

## NetBird UI reference
The Windows client contains UI/layout work derived from the NetBird desktop client. Its BSD 3-Clause notice remains in `client/windows-native/GptOperator.Client/THIRD_PARTY_NOTICES.txt` and is copied into the published Windows application.

Upstream reference: https://github.com/netbirdio/netbird

## Packaging gate
CI must fail if the bundled runtime license/notice files are absent or empty. Installer smoke also verifies that the Windows notice files survive installation, not only staging.
