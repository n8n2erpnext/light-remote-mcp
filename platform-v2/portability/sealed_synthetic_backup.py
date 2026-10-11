"""Light Remote sealed synthetic state archive — OFFLINE UAT ONLY.

Never reads production directories, actual registries, Docker volumes or keys.
Five strictly allowlisted fake files, AES-256-GCM authenticated encryption,
full encrypted manifest (SHA256, mode, UID/GID), independent restore.

NOT a production backup/restore tool. No API/CLI accepting arbitrary paths.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MARKER=".light-remote-synthetic-only"
MARKER_VALUE=b"LIGHT_REMOTE_RC50_SYNTHETIC_ARCHIVE_V1\n"
FILENAMES=(
    "accounts.json",
    "devices.json",
    "device-access-grants.json",
    "usage.json",
    "enrollment-signer.json",
)
FORMAT="light-remote-rc50-synthetic-sealed-v1"
AAD=b"LightRemote/SYNTHETIC-ONLY/rc50/sealed-v1\x00"
MAX_FILE=512_000
MAX_TOTAL=2_500_000
ALLOWED_MODES={0o600,0o640}
SCRATCH_PREFIX="lr_rc50_sealed_fixture_"

def scratch_guard(root):
    """Do not read/write any arbitrary root, even when imported by accident."""
    root=Path(root).absolute()
    parent=root.parent
    require(parent.name.startswith(SCRATCH_PREFIX)
            and parent.parent.resolve()==Path(tempfile.gettempdir()).resolve()
            and not parent.is_symlink() and parent.is_dir(),
            "not_an_isolated_synthetic_scratch_workspace")
    info=parent.lstat()
    require(info.st_uid==os.getuid() and info.st_gid==os.getgid()
            and stat.S_IMODE(info.st_mode)==0o700,
            "synthetic_scratch_workspace_owner_or_mode_invalid")
    return root

class SyntheticArchiveDenied(ValueError):
    pass

def require(check,reason):
    if not check:raise SyntheticArchiveDenied(reason)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encode(raw):
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def decode(value):
    require(isinstance(value,str) and bool(value),"invalid_encoded_field")
    require(len(value)<=4_000_000,"encoded_field_too_large")
    try:
        raw=base64.urlsafe_b64decode(value+"="*((-len(value))%4))
    except Exception as exc:
        raise SyntheticArchiveDenied("invalid_encoded_field") from exc
    require(encode(raw)==value,"noncanonical_encoded_field")
    return raw

def root_guard(root):
    root=scratch_guard(root)
    require(root.name=="source-uat" or root.name.startswith("restored-uat-"),
            "not_a_synthetic_fixture_root")
    require(not root.is_symlink() and root.is_dir(),"synthetic_root_missing_or_link")
    metadata=root.lstat()
    require(stat.S_ISDIR(metadata.st_mode),"synthetic_root_not_directory")
    require(metadata.st_uid==os.getuid() and metadata.st_gid==os.getgid(),
            "synthetic_root_owner_mismatch")
    require(stat.S_IMODE(metadata.st_mode)==0o700,"synthetic_root_mode_invalid")
    marker=root/MARKER
    require(not marker.is_symlink() and marker.is_file(),"synthetic_marker_not_plain_file")
    m=marker.lstat()
    require(stat.S_ISREG(m.st_mode) and stat.S_IMODE(m.st_mode)==0o600
            and m.st_uid==os.getuid() and m.st_gid==os.getgid(),
            "synthetic_marker_permissions_invalid")
    require(marker.read_bytes()==MARKER_VALUE,"synthetic_marker_missing")
    return root

def inventory_guard():
    # The fixture filenames must remain members of the source-derived
    # Operator legacy-state contract. No dynamic file discovery occurs.
    contract=Path(__file__).with_name("legacy-state-contract.json")
    obj=json.loads(contract.read_text(encoding="utf8"))
    declared={x["filename"] for x in obj["operator_files"]}
    require(set(FILENAMES).issubset(declared),"synthetic_inventory_contract_drift")

def _read_files(root):
    inventory_guard()
    root=root_guard(root)
    allowed={MARKER,*FILENAMES}
    require({p.name for p in root.iterdir()}==allowed,
            "unexpected_or_missing_synthetic_file")
    rows=[];total=0
    for name in FILENAMES:
        item=root/name
        info=item.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,
                "synthetic_symlink_hardlink_or_nonfile_denied:"+name)
        mode=stat.S_IMODE(info.st_mode)
        require(mode in ALLOWED_MODES,"unsafe_synthetic_file_mode:"+name)
        require(info.st_uid==os.getuid() and info.st_gid==os.getgid(),
                "unapproved_fixture_file_owner:"+name)
        require(0<info.st_size<=MAX_FILE,"synthetic_file_size_invalid:"+name)
        raw=item.read_bytes()
        require(len(raw)==info.st_size,"file_changed_during_synthetic_snapshot:"+name)
        total+=len(raw)
        require(total<=MAX_TOTAL,"synthetic_archive_too_large")
        # Parse as JSON but do not emit fields/values into logs.
        try:json.loads(raw)
        except (ValueError,UnicodeDecodeError) as exc:
            raise SyntheticArchiveDenied("invalid_synthetic_json:"+name) from exc
        # Detect a changed file even if size remained the same.
        now=item.lstat()
        require((info.st_ino,info.st_size,info.st_mtime_ns)==
                (now.st_ino,now.st_size,now.st_mtime_ns),
                "file_changed_during_synthetic_snapshot:"+name)
        rows.append({"name":name,"sha256":digest(raw),"size":len(raw),
                     "mode":mode,"uid":info.st_uid,"gid":info.st_gid,
                     "bytes":encode(raw)})
    return rows

def seal(root,key):
    require(type(key) is bytes and len(key)==32,"ephemeral_256bit_key_required")
    rows=_read_files(root)
    inner={"format":FORMAT,"entries":rows,"file_count":len(rows)}
    plaintext=json.dumps(inner,separators=(",",":"),sort_keys=True).encode("utf8")
    nonce=os.urandom(12)
    ciphertext=AESGCM(key).encrypt(nonce,plaintext,AAD)
    # Only format, random nonce and encrypted bytes are outside encryption.
    archive={"format":FORMAT,"nonce":encode(nonce),"ciphertext":encode(ciphertext)}
    return (json.dumps(archive,separators=(",",":"),sort_keys=True)+"\n").encode("utf8")

def _open(archive,key):
    require(type(key) is bytes and len(key)==32,"ephemeral_256bit_key_required")
    require(type(archive) is bytes and len(archive)<=4_000_000,
            "invalid_sealed_synthetic_archive")
    try:outer=json.loads(archive)
    except (ValueError,UnicodeDecodeError,TypeError) as exc:
        raise SyntheticArchiveDenied("invalid_sealed_synthetic_archive") from exc
    require(type(outer) is dict and set(outer)=={"format","nonce","ciphertext"}
            and outer["format"]==FORMAT,"invalid_synthetic_envelope")
    nonce=decode(outer["nonce"]);ciphertext=decode(outer["ciphertext"])
    require(len(nonce)==12 and 16<len(ciphertext)<=3_500_000,
            "invalid_synthetic_envelope_size")
    try:clear=AESGCM(key).decrypt(nonce,ciphertext,AAD)
    except (InvalidTag,ValueError) as exc:
        raise SyntheticArchiveDenied("synthetic_archive_authentication_failed") from exc
    try:inner=json.loads(clear)
    except (ValueError,UnicodeDecodeError) as exc:
        raise SyntheticArchiveDenied("synthetic_manifest_corrupted") from exc
    require(type(inner) is dict and set(inner)=={"format","entries","file_count"}
            and inner["format"]==FORMAT and
            inner["file_count"]==len(FILENAMES),"synthetic_manifest_invalid")
    entries=inner["entries"]
    require(type(entries) is list and len(entries)==len(FILENAMES),
            "synthetic_manifest_invalid")
    validated=[];total=0
    for entry,expected in zip(entries,FILENAMES):
        require(type(entry) is dict and set(entry)=={
            "name","sha256","size","mode","uid","gid","bytes"
        } and entry["name"]==expected,"synthetic_path_or_manifest_tamper")
        require(type(entry["uid"]) is int and type(entry["gid"]) is int
                and entry["uid"]==os.getuid() and entry["gid"]==os.getgid(),
                "synthetic_cross_owner_restore_not_supported")
        require(type(entry["mode"]) is int and entry["mode"] in ALLOWED_MODES,
                "invalid_restored_mode")
        require(type(entry["size"]) is int and 0<entry["size"]<=MAX_FILE,
                "invalid_restored_size")
        raw=decode(entry["bytes"])
        total+=len(raw)
        require(total<=MAX_TOTAL and len(raw)==entry["size"]
                and digest(raw)==entry["sha256"],
                "synthetic_payload_integrity_mismatch")
        try:json.loads(raw)
        except (ValueError,UnicodeDecodeError) as exc:
            raise SyntheticArchiveDenied("synthetic_restored_json_invalid") from exc
        validated.append((expected,raw,entry["mode"],entry["sha256"]))
    return validated

def restore(archive,key,target):
    # Target must NOT already exist. Never overwrite a preexisting directory.
    target=scratch_guard(target)
    require(not target.exists() and not target.is_symlink(),
            "synthetic_restore_destination_already_exists")
    require(not target.parent.is_symlink() and target.parent.is_dir(),
            "synthetic_restore_parent_invalid")
    require(target.parent.lstat().st_uid==os.getuid(),"synthetic_restore_parent_owner_invalid")
    require(target.name.startswith("restored-uat-"),
            "synthetic_restore_destination_name_denied")
    inventory_guard()
    validated=_open(archive,key)  # validate everything before creating target
    target.mkdir(mode=0o700)
    try:
        marker=target/MARKER
        with marker.open("xb") as file:file.write(MARKER_VALUE)
        marker.chmod(0o600)
        for name,raw,mode,_ in validated:
            file=target/name
            flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL
            if hasattr(os,"O_NOFOLLOW"):flags|=os.O_NOFOLLOW
            fd=os.open(file,flags,0o600)
            with os.fdopen(fd,"wb") as out:out.write(raw)
            file.chmod(mode)
        root_guard(target)
        for name,raw,mode,sha in validated:
            info=(target/name).lstat()
            require(stat.S_IMODE(info.st_mode)==mode and info.st_uid==os.getuid()
                    and info.st_gid==os.getgid() and digest((target/name).read_bytes())==sha,
                    "synthetic_restored_file_verification_failed")
    except Exception:
        # Only files generated in this newly created empty destination.
        for name in (*FILENAMES,MARKER):
            candidate=target/name
            if candidate.exists() or candidate.is_symlink():candidate.unlink()
        target.rmdir()
        raise
    return {"restored":len(validated),"encrypted":True,"verified_sha256":True,
            "file_mode_preserved":True,"same_uid_gid_required":True}
