#!/usr/bin/env python3
"""Cross-physical-host rc.50 SYNTHETIC state transfer UAT.

Pure Python, no service discovery, DB connections, machine secrets, Docker,
network, ssh, deployment, firewall changes, or live writer activation.
No globally authenticated old-host fence exists: activation is ALWAYS denied.
Only paths with random, explicit lr_rc50_crosshost_ basename are permitted.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import stat
import sys
import tempfile
import uuid
import zipfile

FILES = (
    "operator/accounts.json", "operator/devices.json",
    "operator/sessions.json", "operator/ab-grants.json",
    "operator/remote-effects.json", "operator/jobs.json",
    "plugin/oauth-consumed.json", "plugin/paddle-events.json",
    "plugin/support-outbox.json", "wall/trust-references.json",
    "postgres/synthetic-rows.json", "redis/synthetic-rate-limits.json",
    "agent/synthetic-effect-inventory.json",
)
MARKER = ".rc50-synthetic-only"
ARCHIVE = "rc50-frozen-synthetic-state.zip"
PREFIX = "lr_rc50_crosshost_"
MODE = 0o600


def deny(reason):
    raise ValueError("RC50_SYNTHETIC_DENIED:" + reason)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=True) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def secure_dir(root, *, new=False):
    requested = Path(root).expanduser().absolute()
    if requested.name.startswith(PREFIX) is False or not re.fullmatch(
            r"lr_rc50_crosshost_[0-9a-f]{12}", requested.name):
        deny("invalid_private_scratch_name")
    if requested.is_symlink() or requested.exists() and not requested.is_dir():
        deny("unsafe_scratch_root")
    parent = requested.parent
    if not parent.is_dir() or parent.is_symlink():
        deny("unsafe_scratch_parent")
    if new:
        requested.mkdir(mode=0o700, exist_ok=False)
    if not requested.is_dir() or stat.S_IMODE(requested.stat().st_mode) != 0o700:
        deny("unsafe_scratch_permissions")
    if not new:
        marker = requested / MARKER
        if marker.is_symlink() or not marker.is_file() or marker.read_bytes() != b"rc50-synthetic-only-v1\n":
            deny("missing_synthetic_only_marker")
    return requested


def sync_parent(folder):
    fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_secure(path, data):
    if not isinstance(data, bytes):
        raise TypeError("bytes_only")
    if path.exists() or path.is_symlink():
        deny("refuse_overwrite")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY |
                          os.O_NOFOLLOW, MODE), "wb") as file:
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    sync_parent(path.parent)


def init(root):
    root = secure_dir(root, new=True)
    write_secure(root / MARKER, b"rc50-synthetic-only-v1\n")
    return root


def fake_state(seed):
    owner = "uat_" + seed + "_owner"
    device = "uat_" + seed + "_device"
    session = "uat_" + seed + "_session"
    values = (
        {"accounts": [{"accountId": owner, "plan": "free", "synthetic": True}]},
        {"devices": [{"deviceId": device, "owner": owner, "state": "offline"}]},
        {"sessions": [{"sessionId": session, "deviceId": device,
                       "state": "held", "synthetic": True}]},
        {"abGrants": [{"deviceId": device, "grantId": "uat_" + seed + "_revoked",
                       "status": "revoked"}]},
        {"schemaVersion": 1, "pending": [], "synthetic": True},
        {"jobs": [{"jobId": "uat_" + seed + "_done", "status": "ok",
                   "sideEffectsProvenAbsent": False}]},
        {"consumedHashes": ["0" * 64], "synthetic": True},
        {"providerEvents": [{"eventId": "uat_" + seed + "_invoice",
                            "status": "synthetic-only"}]},
        {"outbox": [{"id": "uat_" + seed + "_notice", "delivery": "blocked"}]},
        {"fingerprint": "synthetic-" + seed, "privateKeyIncluded": False},
        {"schemaVersion": 13, "accounts": [owner], "productionPgDump": False},
        {"key": "uat:" + seed, "quotaCount": 2, "productionRedisDump": False},
        {"entries": [], "schemaVersion": 1, "synthetic": True},
    )
    return {name: canonical(value) for name, value in zip(FILES, values)}


def source(root):
    root = init(root)
    seed = uuid.uuid4().hex[:12]
    data = fake_state(seed)
    for name, contents in data.items():
        write_secure(root / "state" / name, contents)
    # This local assertion does NOT fence production or other hosts.
    freeze = {"version": 1, "scope": "SYNTHETIC_LOCAL_UAT_ONLY",
              "sourceHostname": socket.gethostname(),
              "sourceArchitecture": platform.machine(),
              "fixtureId": seed,
              "writerGeneration": 1,
              "sourceWriterFrozenLocally": True,
              "globallyAuthenticatedWriterFence": False,
              "settlementAuthorized": False}
    write_secure(root / "source-freeze.json", canonical(freeze))
    manifest = {
        "version": 1, "target": "synthetic cross-host UAT only",
        "fixtureId": seed, "writerGeneration": 1,
        "sourceHostname": socket.gethostname(),
        "sourceArchitecture": platform.machine(),
        "sourceFrozenLocally": True,
        "globalWriterFenceProven": False,
        "files": [{"path": name, "sha256": digest(contents), "size": len(contents),
                   "mode": "0600"} for name, contents in data.items()],
        "freezeSha256": digest(canonical(freeze)),
        "cutoverAuthorized": False,
    }
    archive = root / ARCHIVE
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("manifest.json", canonical(manifest))
        zipped.writestr("source-freeze.json", canonical(freeze))
        for name, contents in data.items():
            zipped.writestr("state/" + name, contents)
    write_secure(archive, buffer.getvalue())
    result = verify_archive(archive)
    return {"source": str(root), "archive": str(archive), **result}


def verify_archive(archive, *, cross_host=False):
    archive = Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > 2 * 1024 * 1024:
        deny("invalid_or_oversized_archive")
    with zipfile.ZipFile(archive, "r") as zipped:
        names = zipped.namelist()
        wanted = ["manifest.json", "source-freeze.json"] + ["state/" + p for p in FILES]
        if len(names) != len(set(names)) or set(names) != set(wanted):
            deny("missing_extra_or_duplicate_archive_member")
        for entry in zipped.infolist():
            if (entry.is_dir() or entry.file_size > 256 * 1024 or
                    entry.flag_bits & 0x1):
                deny("invalid_archive_member")
        manifest = json.loads(zipped.read("manifest.json"))
        freeze_bytes = zipped.read("source-freeze.json")
        freeze = json.loads(freeze_bytes)
        if set(manifest) != {"version", "target", "fixtureId", "writerGeneration",
                             "sourceHostname", "sourceArchitecture",
                             "sourceFrozenLocally", "globalWriterFenceProven",
                             "files", "freezeSha256", "cutoverAuthorized"}:
            deny("invalid_manifest_shape")
        if (manifest["version"] != 1 or
            manifest["target"] != "synthetic cross-host UAT only" or
            manifest["writerGeneration"] != 1 or
            manifest["sourceFrozenLocally"] is not True or
            manifest["globalWriterFenceProven"] is not False or
            manifest["cutoverAuthorized"] is not False or
            not re.fullmatch(r"[0-9a-f]{12}", manifest["fixtureId"])):
            deny("untrusted_source_fence_or_manifest")
        if freeze.get("scope") != "SYNTHETIC_LOCAL_UAT_ONLY" or (
                freeze.get("fixtureId") != manifest["fixtureId"] or
                freeze.get("writerGeneration") != manifest["writerGeneration"] or
                freeze.get("sourceHostname") != manifest["sourceHostname"] or
                freeze.get("sourceArchitecture") != manifest["sourceArchitecture"] or
                freeze.get("sourceWriterFrozenLocally") is not True or
                freeze.get("globallyAuthenticatedWriterFence") is not False or
                freeze.get("settlementAuthorized") is not False or
                manifest["freezeSha256"] != digest(freeze_bytes)):
            deny("freeze_mismatch")
        if cross_host and manifest["sourceHostname"] == socket.gethostname():
            deny("source_and_target_same_host")
        listed = manifest["files"]
        if not isinstance(listed, list) or [x.get("path") for x in listed] != list(FILES):
            deny("file_contract_mismatch")
        for row in listed:
            name = row["path"]
            payload = zipped.read("state/" + name)
            if row.get("mode") != "0600" or row.get("size") != len(payload) or (
                    row.get("sha256") != digest(payload)):
                deny("payload_integrity_mismatch")
            obj = json.loads(payload)
            if not isinstance(obj, dict):
                deny("invalid_payload")
        # Every single byte belongs to an explicitly enumerated synthetic plane.
        return {"fixtureId": manifest["fixtureId"], "files": len(listed),
                "archiveSha256": digest(archive.read_bytes()),
                "sourceHostname": manifest["sourceHostname"],
                "sourceArchitecture": manifest["sourceArchitecture"],
                "destinationHostname": socket.gethostname(),
                "destinationArchitecture": platform.machine(),
                "crossHost": manifest["sourceHostname"] != socket.gethostname(),
                "globalWriterFenceProven": False, "cutoverAuthorized": False}


def restore(root, archive, *, cross_host=True):
    root = init(root)
    report = verify_archive(archive, cross_host=cross_host)
    # Construct entirely under hidden/private staging. A crash or fsync fault
    # cannot expose a partial snapshot under the final restored-state name.
    pending = root / ".restoring-state"
    stage = root / "restored-state"
    pending.mkdir(mode=0o700)
    with zipfile.ZipFile(archive, "r") as zipped:
        for name in FILES:
            write_secure(pending / name, zipped.read("state/" + name))
    write_secure(root / "restore-verification.json", canonical(report))
    # Store an explicit permanent deny BEFORE publishing staged bytes.
    # No actual writer process is launched or promoted on the destination.
    write_secure(root / "activation-denied.json", canonical({
        "reason": "no_authenticated_global_writer_fence",
        "sourceMayStillWrite": True,
        "targetWriterActive": False,
        "cutoverAuthorized": False,
    }))
    pending.rename(stage)
    sync_parent(root)
    return {"restoredPath": str(stage), "destinationWriterActive": False, **report}


def rollback(root):
    root = secure_dir(root)
    status = root / "activation-denied.json"
    restored = root / "restored-state"
    if not status.exists() or json.loads(status.read_bytes()) != {
        "reason": "no_authenticated_global_writer_fence",
        "sourceMayStillWrite": True,
        "targetWriterActive": False,
        "cutoverAuthorized": False,
    }:
        deny("rollback_activation_state_untrusted")
    if restored.is_symlink() or not restored.is_dir() or (
            root / "rolled-back-restored-state").exists():
        deny("rollback_unsafe_target")
    # Audit-preserving quarantine, not deleting any data or re-opening source.
    restored.rename(root / "rolled-back-restored-state")
    sync_parent(root)
    write_secure(root / "rollback-complete.json",
                 canonical({"destinationWriterActive": False,
                            "retainedQuarantine": True,
                            "globalWriterFenceProven": False}))
    return {"rollback": "destination_writes_never_enabled",
            "quarantined": True, "cutoverAuthorized": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["source", "verify", "restore", "rollback",
                                            "activate"])
    parser.add_argument("--root")
    parser.add_argument("--archive")
    parser.add_argument("--confirm-synthetic-only", action="store_true")
    args = parser.parse_args()
    if not args.confirm_synthetic_only:
        deny("explicit_synthetic_confirmation_required")
    if args.action == "activate":
        deny("authenticated_old_writer_fence_absent")
    if args.action == "source":
        result = source(args.root)
    elif args.action == "verify":
        result = verify_archive(args.archive)
    elif args.action == "restore":
        result = restore(args.root, args.archive)
    else:
        result = rollback(args.root)
    print(json.dumps({"ok": True, "action": args.action, **result},
                     sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile,
            json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:160]}),
              file=sys.stderr)
        sys.exit(1)
