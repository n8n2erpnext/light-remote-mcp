# Hub Topology v0.5

ARM is the control-plane hub. ChatGPT/Vercel talks only to ARM; execution nodes are addressed behind the hub.

Current production topology:
`GPT -> Vercel -> ARM hub -> ARM executor`

Planned topology without changing the ChatGPT-facing URL:
`GPT -> Vercel -> ARM hub -> {ARM, AMD, HomeLab, ...} executor`

Each node has a stable `nodeId`. Sessions and jobs carry `nodeId`, `sessionId`, and `agentId`; the wall aggregates all nodes and exposes one `ALL` view plus per-session tabs. A future remote executor should establish an outbound authenticated channel to ARM so HomeLab/AMD do not need public inbound exposure. ARM owns node registry, routing, audit aggregation and wall fan-in; node executors own local process lifetime and output.

The current release implements the hub metadata and single-node `arm` path only. It intentionally does not invent a remote-node transport before a second node exists.
