# Light Remote versioning policy

A published version identifies one immutable release BOM and one source Git SHA.

- VERSION, root/gateway package metadata and locks, binary metadata and package manifests must agree.
- Every release artifact set includes the exact Git SHA in package manifests or release-provenance.json.
- Signed update channels are trust pointers; promote them only after immutable artifact verification.
- Pre-release ordering follows SemVer. 0.9.1-beta.1 is newer than every 0.9.0-rc.* build.
- Stable/Core releases must pass the no-Real-Remote/no-Netlify scope gate.
