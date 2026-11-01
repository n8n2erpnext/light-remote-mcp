#!/usr/bin/env python3
"""Linux Server Link/Relink: OS administrator terminal replaces Windows/macOS tray.

Usage:
  sudo light-remote-device link
  sudo light-remote-device relink
  sudo light-remote-device complete
  sudo light-remote-device status

For custom local systemd agents, add --unit <unit-name>. An interactive
administrator terminal (including SSH with TTY) initiates these operations.
Wall and MCP cannot initiate ownership changes. A signed device certificate
must be approved by the new account before the local identity changes.
"""
import argparse
import os
import pwd
import re
import shlex
import subprocess
import sys

DEFAULT_UNIT = "auto"
KNOWN_AGENT_UNITS = (
    "gpt-operator-device-agent.service",
    "light-remote-gold-wall.service",
)
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
    # Only an interactive OS administrator action can request a new device key.
    env["LR_LINUX_RELINK_CONSOLE"] = "1"
    return user_name, argv[0], argv[1], workdir, env

def confirm_os_admin_action(action):
    """Admin OS terminal confirmation; SSH TTY is valid for headless servers.

    No enrollment API / browser request may call this root-only helper.
    """
    if not (os.isatty(0) and os.isatty(1)):
        raise RuntimeError("interactive_admin_terminal_required")
    print("Linux Server ownership will change ONLY after the new account approves "
          "the one-time device code.")
    try:
        response = input("Type " + action.upper() + " to confirm this device action: ")
    except (EOFError, KeyboardInterrupt) as error:
        raise RuntimeError("linux_relink_confirmation_cancelled") from error
    if response.strip() != action.upper():
        raise RuntimeError("linux_relink_confirmation_cancelled")


def main():
    parser = argparse.ArgumentParser(description="Owner-approved Light Remote Linux Server relink")
    parser.add_argument("action", choices=("link", "relink", "complete", "status"),
                        help="link for new/revoked, relink for already-bound, complete after approval")
    parser.add_argument("--unit", default=DEFAULT_UNIT,
                        help="Existing Device Agent systemd service (default: autodetect)")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run this from the Linux server as root (sudo).")
    if args.unit != "auto" and not ALLOWED_UNIT.fullmatch(args.unit):
        parser.error("Invalid systemd unit name.")
    if args.action in ("link", "relink"):
        confirm_os_admin_action(args.action)
    if args.unit == "auto":
        for candidate in KNOWN_AGENT_UNITS:
            try:
                user_name, node_bin, agent, workdir, env = service_config(candidate)
                args.unit = candidate
                break
            except (RuntimeError, subprocess.CalledProcessError, KeyError):
                continue
        else:
            raise RuntimeError("linux_device_agent_service_not_found")
    else:
        user_name, node_bin, agent, workdir, env = service_config(args.unit)
    if args.action in ("link", "relink"):
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
        has_enrollment = bool(old.get("enrollment", {}).get("deviceId"))
        revoked = old.get("cloud", {}).get("lastError") in ("device_revoked", "device_removed")
        if args.action == "relink":
            if not has_enrollment or revoked:
                raise RuntimeError("No active linked device: use 'link' instead")
            action = ["login", "--relink", "--no-wait"]
        else:
            if has_enrollment and not revoked:
                raise RuntimeError("Device already linked: use 'relink' instead")
            # Revoked is free to Link via Wall or OS terminal. Re-enroll
            # locally using the existing key if revoked; the server accepts
            # cross-account linking only when it has a revocation record.
            action = (["login", "--reenroll", "--no-wait"] if has_enrollment
                      else ["login", "--no-wait"])
    else:
        action = ["poll"] if args.action == "complete" else ["status"]
    was_active = unit_setting(args.unit, "ActiveState") == "active"
    if args.action != "status" and was_active:
        systemctl("stop", args.unit)
    try:
        if args.action in ("link", "relink"):
            print("Creating a one-time owner-approved device code. The previous identity is preserved until approval.", flush=True)
        result = subprocess.run(
            ["runuser", "-u", user_name, "--", node_bin, agent, *action],
            cwd=workdir, env=env, check=False, timeout=45 if args.action in ("link", "relink", "status") else 60)
        if result.returncode == 0 and args.action in ("link", "relink"):
            print("\nOpen the Activation URL shown above, sign in to the intended account, and approve the code.")
            print("Then run: sudo light-remote-device complete" +
                  " --unit " + args.unit)
        if result.returncode == 0 and args.action == "complete":
            print("Check the enrollment state above. Only approved completes Link/Relink; access stays cloud-dormant.")
        return result.returncode
    finally:
        if args.action != "status" and was_active:
            systemctl("start", args.unit)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print("Linux relink error: " + str(error), file=sys.stderr)
        sys.exit(1)
