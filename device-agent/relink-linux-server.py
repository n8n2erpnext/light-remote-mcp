#!/usr/bin/env python3
"""Local console-only Linux Server re-enrollment / account relink.

Usage:
  sudo light-remote-relink --begin [--unit gpt-operator-device-agent.service]
  sudo light-remote-relink --poll [--unit gpt-operator-device-agent.service]
  sudo light-remote-relink --status [--unit gpt-operator-device-agent.service]

No password, token, or device private key is accepted over CLI. The one-time
code MUST be approved by the owner in the HTTPS account portal. This script
temporarily stops the Agent service to prevent concurrent state writes and
always starts it again before exiting. Scoped to a locally installed unit.
"""
import argparse
import os
import pwd
import re
import shlex
import subprocess
import sys

DEFAULT_UNIT = "gpt-operator-device-agent.service"
ALLOWED_UNIT = re.compile(r"^[A-Za-z0-9_.@-]{3,110}\.service$")

def systemctl(*args):
    return subprocess.run(["systemctl", *args], check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()

def unit_setting(unit, property_name):
    return systemctl("show", unit, "-p", property_name, "--value").strip()

def service_config(unit):
    user_name = unit_setting(unit, "User")
    if not user_name or user_name == "root":
        raise RuntimeError("A non-root Device Agent service is required")
    pw = pwd.getpwnam(user_name)
    run = unit_setting(unit, "ExecStart")
    match = re.search(r"argv\[\]=(.*?)(?:\s;\signore_errors|$)", run)
    if not match:
        raise RuntimeError("Cannot determine Device Agent command from systemd")
    argv = shlex.split(match.group(1))
    if len(argv) < 3 or not argv[1].endswith("/device-agent/operator-agent.mjs") or argv[2] != "daemon":
        raise RuntimeError("Selected service is not a Light Remote Device Agent daemon")
    workdir = unit_setting(unit, "WorkingDirectory") or "/"
    env = os.environ.copy()
    env["HOME"] = pw.pw_dir
    for item in shlex.split(unit_setting(unit, "Environment")):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        if re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", key):
            env[key] = value
    # Only a console-controlled action can request a new device key.
    env["LR_LINUX_RELINK_CONSOLE"] = "1"
    return user_name, argv[0], argv[1], workdir, env

def require_local_machine_console():
    # Root is necessary but not sufficient. SSH sessions, remote PTYs and
    # AI-operated device shells do not count as local physical authorization.
    if not (os.isatty(0) and os.isatty(1)):
        raise RuntimeError("local_console_tty_required")
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_TTY"):
        raise RuntimeError("ssh_session_not_local_console")
    tty = os.ttyname(0)
    if tty == "/dev/console" or re.fullmatch(
        r"/dev/(?:tty[0-9]+|ttyS[0-9]+|ttyAMA[0-9]+|hvc[0-9]+|xvc[0-9]+)", tty
    ):
        return
    # A local workstation terminal is usually /dev/pts/N. Its logind session
    # must be active, non-remote and attached to a real local seat.
    if re.fullmatch(r"/dev/pts/[0-9]+", tty):
        session_id = os.environ.get("XDG_SESSION_ID", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", session_id):
            raise RuntimeError("local_seat_session_required")
        row = subprocess.run(
            ["loginctl", "show-session", session_id,
             "-p", "Remote", "-p", "Active", "-p", "Seat"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=False, timeout=5
        )
        fields = dict(line.split("=", 1) for line in row.stdout.splitlines() if "=" in line)
        if row.returncode == 0 and fields.get("Remote") == "no" and (
            fields.get("Active") == "yes" and fields.get("Seat")
        ):
            return
    raise RuntimeError("local_machine_console_required")

def main():
    parser = argparse.ArgumentParser(description="Owner-approved Light Remote Linux Server relink")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--begin", action="store_true", help="Generate a new device identity and one-time link code")
    mode.add_argument("--poll", action="store_true", help="Complete relink after the new account approves the code")
    mode.add_argument("--status", action="store_true", help="Read current device status without changing enrollment")
    parser.add_argument("--unit", default=DEFAULT_UNIT, help="Existing systemd Device Agent unit")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run this from the Linux server as root (sudo).")
    if not ALLOWED_UNIT.fullmatch(args.unit):
        parser.error("Invalid systemd unit name.")
    require_local_machine_console()
    user_name, node_bin, agent, workdir, env = service_config(args.unit)
    if args.begin:
        state_path = env.get("OPERATOR_AGENT_STATE") or (
            os.path.join(env.get("HOME", ""), ".config/gpt-operator-agent/device.json")
        )
        old = {}
        try:
            import json
            with open(state_path, "r", encoding="utf-8") as stream:
                old = json.load(stream)
        except (OSError, ValueError):
            pass
        if old.get("enrollment", {}).get("deviceId"):
            action = ["login", "--relink", "--no-wait"]
        elif old.get("cloud", {}).get("lastError") == "device_removed":
            action = ["login", "--reenroll", "--no-wait"]
        else:
            action = ["login", "--no-wait"]
    else:
        action = ["poll"] if args.poll else ["status"]
    was_active = unit_setting(args.unit, "ActiveState") == "active"
    if not args.status and was_active:
        systemctl("stop", args.unit)
    try:
        if args.begin:
            print("Creating a NEW key for a one-time owner-approved relink; previous enrollment is retained until approval.", flush=True)
        result = subprocess.run(
            ["runuser", "-u", user_name, "--", node_bin, agent, *action],
            cwd=workdir, env=env, check=False, timeout=45 if args.status or args.begin else 60)
        if result.returncode == 0 and args.begin:
            print("\nApprove the displayed code in GoldABV2 Account → Devices → Add device.")
            print("Then run: sudo light-remote-relink --poll" +
                  ("" if args.unit == DEFAULT_UNIT else " --unit " + args.unit))
        if result.returncode == 0 and args.poll:
            print("Poll complete; device state remains cloud-dormant until the owner explicitly connects.")
        return result.returncode
    finally:
        if not args.status and was_active:
            systemctl("start", args.unit)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print("Linux relink error: " + str(error), file=sys.stderr)
        sys.exit(1)
