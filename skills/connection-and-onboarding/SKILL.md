---
name: connection-and-onboarding
description: Connect to Light Remote, understand the authorized device topology, and explain the local-first A/B enrollment trust boundary.
---

Use this skill when the user asks to connect to Light Remote, asks what Light Remote can do, or needs help choosing a device.

1. Call `light_remote_connection_helper` first.
2. Explain the currently enrolled topology and effective capabilities without exposing internal identifiers or secrets.
3. If the user needs a new device, explain the production enrollment flow accurately: the one-time A code originates from that device's Local Wall; the remote MCP cannot mint it or bypass local approval.
4. Never invent an A code, B code, approval, device, entitlement, or capability.
5. Before remote work, keep the target explicit. If the requested target is missing or unavailable, report that condition and do not silently switch to another device.
