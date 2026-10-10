# Sourced from the installed Light Remote CLI. Never echo agent state secrets.
show_summary() {
  local payload current
  current="$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
  if ! payload="$(agent status 2>/dev/null)"; then
    printf 'Light Remote — status unavailable\nService   : %s\nLocal Wall: http://%s:%s/\n' "$current" "$WALL_HOST" "$WALL_PORT"
    return 1
  fi
  printf '%s' "$payload" | "$NODE" "$ROOT/current/client/linux/cli-status.mjs" "$WALL_HOST" "$WALL_PORT" "$current"
}

# Only allow loopback, RFC1918 LAN or the local NetBird wt* interface.
# The selected address must currently belong to this machine.
available_hosts() {
  printf 'Local|127.0.0.1|lo\n'
  command -v ip >/dev/null 2>&1 || return 0
  ip -4 -o addr show scope global 2>/dev/null | python3 -c '
import sys,ipaddress
for line in sys.stdin:
    parts=line.split()
    if len(parts)<4:continue
    iface,ip=parts[1],parts[3].split("/")[0]
    if iface.startswith(("docker","br-","veth","lxc","virbr","podman","cni","flannel","tailscale")):continue
    try:addr=ipaddress.IPv4Address(ip)
    except ValueError:continue
    if addr in ipaddress.IPv4Network("100.64.0.0/10") and iface.startswith(("wt","netbird")):
        print("NetBird|"+ip+"|"+iface)
    elif any(addr in net for net in (ipaddress.IPv4Network("10.0.0.0/8"),ipaddress.IPv4Network("172.16.0.0/12"),ipaddress.IPv4Network("192.168.0.0/16"))):
        print("LAN|"+ip+"|"+iface)
'
}
select_wall_address() {
  local choice="" target="" mode="" kind="" addr="" iface="" index=0
  local candidates=""
  candidates="$(available_hosts)"
  case "${1:-}" in
    --local) [[ $# -eq 1 ]] || die 'unexpected arguments'; printf '127.0.0.1\n'; return;;
    --netbird) [[ $# -eq 1 ]] || die 'unexpected arguments'; mode=NetBird;;
    --lan) [[ $# -eq 1 ]] || die 'unexpected arguments'; mode=LAN;;
    --host) [[ $# -eq 2 && -n "$2" ]] || die 'usage: light-remote bind --host IPv4'; target="$2";;
    "") [[ $# -eq 0 ]] || die 'unexpected bind arguments';;
    *) die 'usage: light-remote bind [--local|--lan|--netbird|--host IPv4]';;
  esac
  if [[ -z "$mode" && -z "$target" ]]; then
    ( : </dev/tty ) >/dev/null 2>&1 || die 'non-interactive: use bind --local, --lan, --netbird or --host IPv4'
    printf '\nLocal Wall — select an address\n' >/dev/tty
    while IFS='|' read -r kind addr iface; do
      index=$((index+1))
      printf '  %s) %-8s %s (%s)\n' "$index" "$kind" "$addr" "$iface" >/dev/tty
    done <<< "$candidates"
    printf 'Choose [1]: ' >/dev/tty
    IFS= read -r choice </dev/tty || true
    choice="${choice:-1}"
    [[ "$choice" =~ ^[0-9]+$ ]] && ((choice>=1 && choice<=index)) || die 'invalid selection'
    printf '%s\n' "$candidates" | sed -n "$choice"p | cut -d'|' -f2
    return
  fi
  while IFS='|' read -r kind addr iface; do
    if [[ ( -n "$mode" && "$kind" == "$mode" ) || ( -n "$target" && "$addr" == "$target" ) ]]; then
      printf '%s\n' "$addr"
      return
    fi
  done <<< "$candidates"
  die 'requested address is not configured on a permitted local interface'
}
change_wall_bind() {
  local selected previous unit
  selected="$(select_wall_address "$@")"
  previous="$WALL_HOST"
  [[ "$SERVICE" == 'gpt-operator-device-agent.service' ]] || die 'unsupported service name'
  unit="/etc/systemd/system/$SERVICE"
  [[ -f "$unit" ]] || die 'installed systemd service is missing'
  if [[ "$selected" == "$previous" ]]; then printf 'Wall already bound to %s:%s\n' "$previous" "$WALL_PORT"; return; fi
  grep -q '^Environment=OPERATOR_AGENT_WALL_HOST=' "$unit" || die 'Wall bind environment missing from service'
  as_root sed -i -E "s|^Environment=OPERATOR_AGENT_WALL_HOST=.*|Environment=OPERATOR_AGENT_WALL_HOST=$selected|" "$unit"
  WALL_HOST="$selected"
  if ! as_root systemctl daemon-reload || ! as_root systemctl restart "$SERVICE" || ! wall_health; then
    as_root sed -i -E "s|^Environment=OPERATOR_AGENT_WALL_HOST=.*|Environment=OPERATOR_AGENT_WALL_HOST=$previous|" "$unit"
    as_root systemctl daemon-reload
    as_root systemctl restart "$SERVICE" || true
    WALL_HOST="$previous"
    die 'Wall bind failed health check; restored previous address'
  fi
  printf 'Wall bind changed successfully.\n'
  show_summary
}
enroll_briefly() {
  # Keep one-time code and activation URL, hide post-approval diagnostic JSON.
  agent login "$@" | python3 -u -c '
import sys
for line in sys.stdin:
    msg=line.strip()
    if msg.startswith(("Activation URL:","Device code:","Expires in:","Waiting for approval")):
        print(msg,flush=True)
'
}
help_commands() {
  cat <<'EOF'
Light Remote Linux Server

  light-remote up                 Enroll/start service
  light-remote down               Disconnect cloud session
  light-remote restart            Restart Agent safely, check Local Wall and show status
  light-remote status             Friendly status summary
  light-remote announcements      Read cached notices in this SSH terminal
  light-remote status --json      Full diagnostics (technical)
  light-remote wall               Show local Wall URL
  light-remote bind               Choose new Wall address
  light-remote bind --local       Use loopback address
  light-remote bind --lan         Use detected LAN address
  light-remote bind --netbird     Use detected NetBird address
  light-remote bind --host IPv4   Use an eligible local address
  light-remote connect            Connect to cloud
  light-remote disconnect         Disconnect from cloud
  light-remote drain / undrain    Stop/resume incoming sessions
  light-remote help               Show command reference
EOF
}
cmd="${1:-status}"
shift || true
case "$cmd" in
  up|login)
    if [[ ! -f "$STATE_FILE" ]]; then
      printf 'Light Remote — device activation\n'
      enroll_briefly "$@"
    else
      enrolled="$(agent status 2>/dev/null | python3 -c 'import json,sys; print("true" if json.load(sys.stdin).get("enrolled") else "false")' 2>/dev/null || echo false)"
      if [[ "$enrolled" != true ]]; then enroll_briefly "$@"; fi
    fi
    refresh_service_policy
    as_root systemctl daemon-reload
    as_root systemctl enable --now "$SERVICE" >/dev/null
    as_root systemctl enable --now gpt-operator-agent-update.timer gpt-operator-agent-update.path gpt-operator-agent-update-check.path >/dev/null
    wall_health
    show_summary
    ;;
  status)
    if [[ $# -eq 1 && "$1" == '--json' ]]; then agent status
    elif [[ $# -eq 0 ]]; then show_summary
    else die 'usage: light-remote status [--json]'; fi
    ;;
  announcements|notices)
    [[ $# -eq 0 ]] || die 'usage: light-remote announcements'
    agent announcements | "$NODE" "$ROOT/current/client/linux/cli-announcements.mjs"
    ;;
  bind) change_wall_bind "$@";;
  down)
    agent disconnect "$@" >/dev/null
    show_summary
    ;;
  restart)
    [[ $# -eq 0 ]] || die 'usage: light-remote restart'
    [[ "$SERVICE" == 'gpt-operator-device-agent.service' ]] || die 'unsupported service name'
    printf 'Restarting Light Remote Agent...\n'
    as_root systemctl restart "$SERVICE" || die 'agent restart failed'
    wall_health
    printf 'Agent restarted successfully.\n'
    show_summary
    ;;
  connect|disconnect|drain|undrain) agent "$cmd" "$@";;
  wall) printf 'http://%s:%s/\n' "$WALL_HOST" "$WALL_PORT";;
  help|-h|--help) help_commands;;
  *) help_commands; exit 2;;
esac
