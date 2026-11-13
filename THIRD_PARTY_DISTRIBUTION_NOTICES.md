# Third-party distribution notices

Updated: 2026-09-25

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


## Cascadia Mono font
Light Remote bundles assets/fonts/CascadiaMono.ttf for an offline, consistent terminal UI across Windows, Linux and macOS. Cascadia Mono is from Microsoft Cascadia Code and is licensed under the SIL Open Font License 1.1.

The complete font license is distributed as assets/fonts/CascadiaMono-OFL.txt.

Upstream references: https://github.com/microsoft/cascadia-code and https://github.com/microsoft/terminal

## PTY / ConPTY terminal runtime
Light Remote packages a native pseudo-terminal backend for SSH-class interactive terminal sessions.

- Linux packages use `@homebridge/node-pty-prebuilt-multiarch` under the MIT license, with the package license copied to `licenses/terminal-runtime/homebridge-node-pty-LICENSE`.
- Windows and macOS packages use `node-pty` under the MIT license, with the package license copied to `licenses/terminal-runtime/node-pty-LICENSE`.
- Windows terminal sessions use the ConPTY backend supplied by the packaged `node-pty` runtime; Linux and macOS use native PTY semantics.

Upstream references: https://github.com/homebridge/node-pty-prebuilt-multiarch and https://github.com/microsoft/node-pty

## Packaging gate
CI must fail if the bundled runtime license/notice files are absent or empty. Installer smoke also verifies that the Windows notice files survive installation, not only staging.

## Project license files in release packages
Public beta Windows, Linux client, Linux Server and Vercel bridge bundles also carry the Light Remote MCP root `LICENSE` and `NOTICE`. Those project files are separate from the upstream runtime notices described above.

## Optional RM desktop duplication bindings

Windows RM includes Vortice.Direct3D11, Vortice.DXGI and Vortice.DirectX 3.8.3, Vortice.Mathematics 2.1.0, and SharpGen.Runtime / SharpGen.Runtime.COM 2.4.2-beta for its optional DXGI capture backend. The default GDI image path remains available. No Sunshine source is bundled.

Vortice: Copyright (c) Amer Koleci and Contributors.
Upstream: https://github.com/amerkoleci/Vortice.Windows (package source commit 9e609cb9439c9872aa1b339f177e40ec96f77239) and https://github.com/amerkoleci/Vortice.Mathematics .

SharpGen: Copyright (c) 2010-2017 Alexandre Mutel, 2017-2023 Jeremy Koritzinsky, 2023-2024 Amer Koleci.
Upstream: https://github.com/SharpGenTools/SharpGenTools .

These components use the MIT License reproduced below. System.Text.Json 10.0.15 and its Microsoft runtime dependencies also use the MIT license, Copyright (c) .NET Foundation and Contributors; the distribution includes the .NET license and third-party notices identified above.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
