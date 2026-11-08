# GPT VPS Operator Host

`executor.mjs` runs on the VPS as user `ubuntu`, not as root. It inherits the operator account's normal groups and can therefore use the same operator-level build, Git, container, LXD and system tooling available to that account.

Ingress is a local Unix socket only. The public gateway cannot decrypt command payloads; it authenticates the transport caller and forwards a sealed envelope to this executor.

Operational history is JSONL under `/var/log/gpt-vps-operator/` with 50 MB size rotation and three retained rotations. Live wall memory is separately bounded.
