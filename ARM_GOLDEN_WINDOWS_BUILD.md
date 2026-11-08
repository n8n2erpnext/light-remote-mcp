# ARM Golden Windows Build

Purpose: build a Windows client from the exact Local Wall / Device Agent runtime currently proven on ARM, while keeping the native Windows shell and installer from the known-good rc.26 baseline.

- Native Windows shell / installer baseline: ce1ffe227fc5e89c35599e9d7b76b9651f39f215
- Runtime source: /opt/gpt-vps-operator/host-wall on ARM
- Runtime VERSION: 0.9.0-rc.26
- Frozen runtime backup: /home/ubuntu/light-remote-backups/arm-golden-runtime-20260928-2250.tgz
- Frozen backup SHA256: 1d36c4816e17e3b1b973765747beab6ba6acec94f3cf09f5ae0c0db8a00b0f29
- Staged client core digest: beeb5061ea00b526de85a3f9e1579ed58241918022942175679124380dc6880c
- Runtime files hash-verified against ARM before this commit.
- Vercel production is intentionally untouched.
