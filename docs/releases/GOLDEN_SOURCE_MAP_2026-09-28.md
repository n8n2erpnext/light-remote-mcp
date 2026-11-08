# Light Remote Golden Source Map — 2026-09-28

This document separates the frozen deployed golden reference from the clean source composition used for 0.9.1-beta.2.

## Frozen deployed golden reference

- Vercel production deployment: light-remote-n6isbu2fq-thdangduys-projects.vercel.app
- Vercel deployed source anchor: 3b2e2e67e099277da0eaca19746bc360a04503ed
- ARM runtime label at freeze: 0.9.0-rc.26
- Fleet pointer at freeze: 0.9.0-rc.26
- Agent-client registry source anchor: 05c3bb1eb38121fb3b9ae0efee9682d02c884b4b
- Wall presentation source anchor: 57e641167572e4de9b794f9c783cc491aea42698
- Validated Windows Core baseline: 0.9.1-beta.1@6b58ce1535d3054265626da622c0f152868f1c4e

Runtime golden BOM:
- Path on ARM: /home/ubuntu/light-remote-backups/GOLDEN_BOM_2026-09-28.txt
- SHA256: 17c9dea9bfc7db912fd301130ff53fc2b23dbd59ee727b62a6f2183ca5134596

## Clean 0.9.1-beta.2 source composition

The release source is intentionally not a byte-for-byte copy of the hybrid deployed runtime. It starts from the clean stable beta1 line and ports only accepted fixes:

- Clean stable base: 6b58ce1535d3054265626da622c0f152868f1c4e
- Agent-client 401 transport fix already present in base: 05c3bb1eb38121fb3b9ae0efee9682d02c884b4b
- Signed lr1 Vercel client continuity: 503fa97326e317ee020536fd210843a3de312914 + 204e654700c818f8837449c7f4f1342a0ef0a594
- Late-result / HTTP 410 recovery: 33ff0b4e69b919d920f053c87843dc5fd03c4267
- Result-delivery packaging contract: 0ae6f58d19811ab0bbbc8a9c3630e302ac1f607c
- Wall presentation baseline: 57e641167572e4de9b794f9c783cc491aea42698, with desktop-only capability metadata removed from the stable line
- beta2 Wall polish: neutral command badges, Settings icon, in-Wall action feedback, Refresh A spin, manual held/orphan session cleanup

Stable/Core source and packages do not include the experimental computer-use runtime. The Netlify backup lane is retired.

The deployed golden Vercel/ARM runtime is not replaced until immutable beta2 artifacts pass CI and real-device A/B acceptance.
