# Real Remote V2 - Golden Rebuild

Base commit: d748d4bdcf501c072daf554b23011ecd96a4f1e9

This implementation is rebuilt from the stable Golden Core. The previous feature/real-remote rc line is reference-only and is not merged or cherry-picked.

## Hard invariants

1. Golden Core must remain responsive and independently healthy.
2. Real Remote is dormant until explicitly requested.
3. When dormant there is no Real Remote process, UIA subscription, polling loop, Wall route, heartbeat, or timer.
4. Local Wall is not a Real Remote transport.
5. The Windows robot is a separate companion process and dies when its local control pipe closes.
6. Observation and action share a full-duplex local pipe; UI changes are pushed as events instead of polled.
7. Mouse and keyboard use real Windows input.
8. Agent can send bounded local batches so simple motor sequences do not round-trip through the model after every step.
9. Real Remote failure must never stop, restart, or reconfigure the Golden Agent.
10. Integration into Core is forbidden until the standalone robot lifecycle acceptance passes.

## Current standalone surface

- cursor halo while remote companion is active
- remote-active tray notification/icon owned by the companion
- cursor move
- single/right/middle click
- Unicode text input
- backspace/delete-by-count
- named key input
- bounded batch.run with foreground-title guard
- event-driven WinEvent observation push
- on-demand bounded UI Automation snapshot
- full-duplex named-pipe JSON protocol
- automatic exit on pipe disconnect

## Next integration boundary

After standalone Windows acceptance, add one minimal lazy launcher/broker to Golden Core. That broker may start the companion only on an explicit desktop.open request and must not add idle work to the Agent or Wall.
