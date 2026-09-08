# Portability contract

The bridge is intentionally split into three replaceable layers:

1. `api/` + `lib/`: ChatGPT-facing transport adapter. Today this is Vercel because ChatGPT can invoke it directly.
2. `gateway/`: provider-neutral authenticated MCP/HTTP gateway. It is unprivileged and can move to any HTTPS host.
3. `operator-host/`: provider-neutral host executor running as the normal `ubuntu` operator account over a local Unix socket.

A future transport provider only needs to reproduce four operations:
- execute one encrypted operator envelope
- query a job
- retrieve output
- query capabilities

The privileged payload format is X25519 + HKDF-SHA256 + AES-256-GCM with short-lived request IDs and replay rejection. The host private key never belongs in the transport provider or gateway container.

The wall is read-only observability and is not part of the control protocol.
