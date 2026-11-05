//! T04b9a — native-only, purpose-scoped Owner -> Wall ticket preparation.
//!
//! This is deliberately NOT a Tauri command and NOT wired to the UI yet:
//! the enrolled device-signed relay and browser-safe Wall cookie bootstrap
//! must exist before a real ticket can be requested. Never put the Owner
//! access token or this one-use ticket into WebView, browser URL or logs.
#![allow(dead_code)]

use std::{io::Read, time::{SystemTime, UNIX_EPOCH, Duration}};
use reqwest::blocking::Client;
use serde_json::{json, Value};

const ISSUE_URL: &str =
    "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/wall-sso/ticket";
const MAX_REPLY: u64 = 2048;
const MAX_TICKET_TTL_MS: u64 = 45_000;

pub(crate) struct NativeWallTicket {
    // Intentionally not Debug/Serialize/Clone: raw bearer stays Rust-only.
    ticket: String,
    device_id: String,
    expires_at_ms: u64,
}
impl NativeWallTicket {
    pub(crate) fn ticket_for_signed_relay(&self) -> &str { &self.ticket }
    pub(crate) fn device_id(&self) -> &str { &self.device_id }
    pub(crate) fn expires_at_ms(&self) -> u64 { self.expires_at_ms }
}

fn opaque(value: &str) -> bool {
    value.len() == 43 &&
        value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub(crate) fn device_id_ok(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 &&
        value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
}
fn deny() -> String { "desktop_wall_sso_ticket_unavailable".to_string() }

fn parse_ticket(reply: &[u8], device: &str, now_ms: u64)
    -> Result<NativeWallTicket, String>
{
    if reply.len() > MAX_REPLY as usize || !device_id_ok(device) { return Err(deny()); }
    let value: Value = serde_json::from_slice(reply).map_err(|_|deny())?;
    let obj = value.as_object().ok_or_else(deny)?;
    // Trust only the narrow issuer contract; reject unexpected fields.
    if obj.len() != 4 || !["ok","ticket","expiresAt","deviceId"]
        .iter().all(|k|obj.contains_key(*k)) ||
        value.get("ok").and_then(Value::as_bool) != Some(true)
    { return Err(deny()); }
    let ticket = value.get("ticket").and_then(Value::as_str).ok_or_else(deny)?;
    let returned_device = value.get("deviceId").and_then(Value::as_str).ok_or_else(deny)?;
    let expires = value.get("expiresAt").and_then(Value::as_u64).ok_or_else(deny)?;
    if !opaque(ticket) || returned_device != device || expires <= now_ms ||
        expires - now_ms > MAX_TICKET_TTL_MS
    { return Err(deny()); }
    Ok(NativeWallTicket {
        ticket: ticket.to_owned(), device_id: device.to_owned(),
        expires_at_ms: expires
    })
}

/// Only the future Rust signed-device-relay owner may call this.
/// No ticket is created by importing this module or opening the Desktop UI.
pub(crate) fn request_native_wall_ticket(
    owner_access: &str, selected_device: &str
) -> Result<NativeWallTicket, String> {
    if !opaque(owner_access) || !device_id_ok(selected_device) { return Err(deny()); }
    // No browser cookies, redirects, untrusted proxy-origin headers, or URL
    // formed from user input. The server independently verifies Owner/family,
    // scope, enrollment and one-use Redis issue permissions.
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_|deny())?;
    let response = client.post(ISSUE_URL)
        .bearer_auth(owner_access)
        .json(&json!({"device_id":selected_device}))
        .send().map_err(|_|deny())?;
    if !response.status().is_success() { return Err(deny()); }
    let mut bounded = Vec::with_capacity(256);
    response.take(MAX_REPLY + 1).read_to_end(&mut bounded).map_err(|_|deny())?;
    if bounded.len() as u64 > MAX_REPLY { return Err(deny()); }
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|deny())?.as_millis() as u64;
    parse_ticket(&bounded, selected_device, now)
}


// T04b9c3b2: OS-private Agent handoff, never browser, React or URL.
// Source-only: no Tauri IPC invokes this and the running Agent has not
// enabled its matching listener. Do not mint a ticket before both the
// Owner session-generation fence and the local Agent are ready.
const NATIVE_WALL_SSO_WIN_PIPE: &str =
    r"\\.\pipe\light-remote-desktop-v4-owner-wall-sso";
const NATIVE_WALL_SSO_UNIX_FILE: &str =
    "desktop-v4-owner-wall-sso.sock";
const NATIVE_AGENT_ACK: &[u8] = b"{\"ok\":true}\n";
const NATIVE_AGENT_MAX_BYTES: usize = 1536;

fn native_handoff_line(
    challenge: &str,
    ticket: &NativeWallTicket,
) -> Result<Vec<u8>, String> {
    if !opaque(challenge) || !opaque(&ticket.ticket) ||
       !device_id_ok(&ticket.device_id) {
        return Err(deny());
    }
    let mut line = serde_json::to_vec(&json!({
        "challenge": challenge,
        "ticket":ticket.ticket,
        "deviceId":ticket.device_id
    })).map_err(|_|deny())?;
    line.push(b'\n');
    if line.len()>NATIVE_AGENT_MAX_BYTES {
        return Err(deny());
    }
    Ok(line)
}

#[cfg(unix)]
fn trusted_unix_agent_socket() -> Result<std::path::PathBuf, String> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    let home=std::env::var_os("HOME").ok_or_else(deny)?;
    let directory=std::path::PathBuf::from(home).join(".light-remote");
    let socket=directory.join(NATIVE_WALL_SSO_UNIX_FILE);
    let parent=std::fs::symlink_metadata(&directory).map_err(|_|deny())?;
    let target=std::fs::symlink_metadata(&socket).map_err(|_|deny())?;
    if parent.file_type().is_symlink() ||
       !parent.file_type().is_dir() ||
       parent.permissions().mode()&0o077!=0 ||
       target.file_type().is_symlink() ||
       !target.file_type().is_socket() ||
       target.permissions().mode()&0o077!=0 {
        return Err(deny());
    }
    Ok(socket)
}

/// Deliver only through private same-owner OS IPC. The one-use ticket is
/// still validated by the enrolled Agent's Ed25519 key at Gold Operator.
/// This function does not request a ticket and is not exported to Tauri.
pub(crate) async fn relay_native_wall_ticket_to_agent(
    challenge: &str,
    ticket: &NativeWallTicket,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let now=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|deny())?.as_millis() as u64;
    // A ticket that will expire during local IPC is not an Owner proof.
    // Never start a pipe exchange with an already stale one-use ticket.
    if ticket.expires_at_ms<=now+2_000 ||
       ticket.expires_at_ms-now>MAX_TICKET_TTL_MS {
        return Err(deny());
    }
    let line=native_handoff_line(challenge,ticket)?;
    let operation=async {
        #[cfg(windows)]
        let mut stream=tokio::net::windows::named_pipe::ClientOptions::new()
            .open(NATIVE_WALL_SSO_WIN_PIPE).map_err(|_|deny())?;
        #[cfg(unix)]
        let mut stream=tokio::net::UnixStream::connect(
            trusted_unix_agent_socket()?
        ).await.map_err(|_|deny())?;
        #[cfg(not(any(unix,windows)))]
        return Err(deny());
        stream.write_all(&line).await.map_err(|_|deny())?;
        stream.flush().await.map_err(|_|deny())?;
        let mut answer=Vec::with_capacity(20);
        (&mut stream).take(64).read_to_end(&mut answer)
            .await.map_err(|_|deny())?;
        if answer.as_slice()!=NATIVE_AGENT_ACK {
            return Err(deny());
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(4),operation)
        .await.map_err(|_|deny())?
}


/// The browser's public challenge is read from the same-device enrolled
/// Agent, never taken from Tauri/React arguments or an untrusted URL.
/// It cannot authorize a Wall cookie without a separate HttpOnly browser
/// cookie and the Owner-approved one-use signed ticket.
pub(crate) struct NativeWallPending {
    pub(crate) challenge:String,
    pub(crate) device_id:String,
}
const NATIVE_AGENT_PENDING_REQUEST: &[u8]=b"{\"action\":\"pending\"}\n";
const NATIVE_PENDING_MAX_REPLY: u64=512;

fn parse_native_wall_pending(bytes:&[u8],now_ms:u64)
    -> Result<NativeWallPending,String>
{
    if bytes.len()>NATIVE_PENDING_MAX_REPLY as usize {return Err(deny());}
    let row:Value=serde_json::from_slice(bytes).map_err(|_|deny())?;
    let obj=row.as_object().ok_or_else(deny)?;
    if obj.len()!=5 || !["ok","pending","challenge","deviceId","expiresAt"]
        .iter().all(|k|obj.contains_key(*k)) ||
       row.get("ok").and_then(Value::as_bool)!=Some(true) ||
       row.get("pending").and_then(Value::as_bool)!=Some(true)
    {return Err(deny());}
    let challenge=row.get("challenge").and_then(Value::as_str)
        .ok_or_else(deny)?;
    let device=row.get("deviceId").and_then(Value::as_str)
        .ok_or_else(deny)?;
    let expires=row.get("expiresAt").and_then(Value::as_u64)
        .ok_or_else(deny)?;
    if !opaque(challenge)||!device_id_ok(device)||
       expires<=now_ms+2_000||
       expires>now_ms+60_000 {return Err(deny());}
    Ok(NativeWallPending{
        challenge:challenge.to_owned(),device_id:device.to_owned()
    })
}

pub(crate) async fn read_private_wall_pending_from_agent()
    -> Result<NativeWallPending,String>
{
    use tokio::io::{AsyncReadExt,AsyncWriteExt};
    let operation=async {
        #[cfg(windows)]
        let mut stream=tokio::net::windows::named_pipe::ClientOptions::new()
            .open(NATIVE_WALL_SSO_WIN_PIPE).map_err(|_|deny())?;
        #[cfg(unix)]
        let mut stream=tokio::net::UnixStream::connect(
            trusted_unix_agent_socket()?
        ).await.map_err(|_|deny())?;
        #[cfg(not(any(windows,unix)))]
        return Err(deny());
        stream.write_all(NATIVE_AGENT_PENDING_REQUEST)
            .await.map_err(|_|deny())?;
        stream.flush().await.map_err(|_|deny())?;
        let mut answer=Vec::with_capacity(160);
        (&mut stream).take(NATIVE_PENDING_MAX_REPLY+1)
            .read_to_end(&mut answer).await.map_err(|_|deny())?;
        if answer.len()>NATIVE_PENDING_MAX_REPLY as usize{
            return Err(deny());
        }
        let now=SystemTime::now().duration_since(UNIX_EPOCH)
            .map_err(|_|deny())?.as_millis() as u64;
        parse_native_wall_pending(&answer,now)
    };
    tokio::time::timeout(Duration::from_secs(4),operation)
        .await.map_err(|_|deny())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t04b9c3c_pending_pipe_read_contains_no_ticket_or_owner_credential() {
        let reply=json!({
            "ok":true,"pending":true,"challenge":"C".repeat(43),
            "deviceId":"dev_loc","expiresAt":1_030_000u64
        });
        let p=parse_native_wall_pending(
            reply.to_string().as_bytes(),1_000_000
        ).unwrap();
        assert_eq!(p.device_id,"dev_loc");
        assert_eq!(p.challenge,"C".repeat(43));
        assert_eq!(NATIVE_AGENT_PENDING_REQUEST,b"{\"action\":\"pending\"}\n");
    }
    #[test]
    fn t04b9c3c_pending_pipe_read_rejects_privilege_fields_and_expiry() {
        let mut reply=json!({
            "ok":true,"pending":true,"challenge":"C".repeat(43),
            "deviceId":"dev_loc","expiresAt":1_030_000u64
        });
        reply["ticket"]=json!("T".repeat(43));
        assert!(parse_native_wall_pending(
            reply.to_string().as_bytes(),1_000_000
        ).is_err());
        reply.as_object_mut().unwrap().remove("ticket");
        reply["expiresAt"]=json!(1_001_000u64);
        assert!(parse_native_wall_pending(
            reply.to_string().as_bytes(),1_000_000
        ).is_err());
        reply["expiresAt"]=json!(1_060_001u64);
        assert!(parse_native_wall_pending(
            reply.to_string().as_bytes(),1_000_000
        ).is_err());
        reply["expiresAt"]=json!(1_030_000u64);
        reply["deviceId"]=json!("../not-local");
        assert!(parse_native_wall_pending(
            reply.to_string().as_bytes(),1_000_000
        ).is_err());
    }


    #[test]
    fn native_private_pipe_path_is_fixed_not_browser_or_remote_http() {
        assert_eq!(
            NATIVE_WALL_SSO_WIN_PIPE,
            r"\\.\pipe\light-remote-desktop-v4-owner-wall-sso"
        );
        assert_eq!(
            NATIVE_WALL_SSO_UNIX_FILE,
            "desktop-v4-owner-wall-sso.sock"
        );
        assert!(!NATIVE_WALL_SSO_WIN_PIPE.contains("http:"));
        assert!(!NATIVE_WALL_SSO_WIN_PIPE.contains("https:"));
    }
    #[test]
    fn private_handoff_line_contains_only_exact_agent_and_ticket_binding() {
        let ticket=NativeWallTicket {
            ticket:"T".repeat(43),
            device_id:"dev_local".into(),
            expires_at_ms:12345
        };
        let line=native_handoff_line(&"C".repeat(43),&ticket).unwrap();
        let payload:Value=serde_json::from_slice(
            &line[..line.len()-1]
        ).unwrap();
        assert_eq!(payload.as_object().unwrap().len(),3);
        assert_eq!(payload["challenge"],"C".repeat(43));
        assert_eq!(payload["deviceId"],"dev_local");
        assert_eq!(payload["ticket"],"T".repeat(43));
        assert!(payload.get("owner_access").is_none());
        assert!(payload.get("refresh_token").is_none());
        assert!(payload.get("grant").is_none());
        assert_eq!(*line.last().unwrap(),b'\n');
    }
    #[test]
    fn private_handoff_never_accepts_malformed_challenge_or_device_id() {
        let mut ticket=NativeWallTicket {
            ticket:"T".repeat(43),
            device_id:"dev_good".into(),
            expires_at_ms:12345
        };
        assert!(native_handoff_line("",&ticket).is_err());
        assert!(native_handoff_line("bad",&ticket).is_err());
        assert!(native_handoff_line(&"C".repeat(44),&ticket).is_err());
        ticket.device_id="../attacker".into();
        assert!(native_handoff_line(&"C".repeat(43),&ticket).is_err());
    }

    fn fixture(device:&str, expires:u64) -> Vec<u8> {
        json!({"ok":true,"ticket":"T".repeat(43),"expiresAt":expires,
            "deviceId":device}).to_string().into_bytes()
    }
    #[test]
    fn exact_native_endpoint_cannot_be_device_controlled() {
        assert_eq!(
            url::Url::parse(ISSUE_URL).unwrap().path(),
            "/account/desktop/v4/wall-sso/ticket"
        );
        assert!(ISSUE_URL.starts_with("https://"));
        assert!(!ISSUE_URL.contains("/mcp"));
    }
    #[test]
    fn native_ticket_accepts_exact_short_lived_owner_device_binding() {
        let t = parse_ticket(&fixture("dev_abc", 1045_000), "dev_abc", 1_000_000).unwrap();
        assert_eq!(t.device_id(),"dev_abc");
        assert_eq!(t.expires_at_ms(), 1045_000);
        assert_eq!(t.ticket_for_signed_relay().len(),43);
    }
    #[test]
    fn ticket_denies_cross_device_expired_long_lived_and_extra_fields() {
        assert!(parse_ticket(&fixture("dev_abc", 1045_000),"dev_other",1_000_000).is_err());
        assert!(parse_ticket(&fixture("dev_abc", 1_000_000),"dev_abc",1_000_000).is_err());
        assert!(parse_ticket(&fixture("dev_abc", 1045_001),"dev_abc",1_000_000).is_err());
        let mut bad = serde_json::from_slice::<Value>(&fixture("dev_abc",1045_000)).unwrap();
        bad["refresh_token"]=json!("no");
        assert!(parse_ticket(bad.to_string().as_bytes(),"dev_abc",1_000_000).is_err());
    }
    #[test]
    fn malformed_reply_and_purpose_confusion_fail_closed() {
        assert!(parse_ticket(b"[]","dev_abc",1).is_err());
        assert!(parse_ticket(b"{}","dev_abc",1).is_err());
        assert!(parse_ticket(&vec![b'x';2049],"dev_abc",1).is_err());
        assert!(parse_ticket(&fixture("dev/other",1045_000),"dev/other",1_000_000).is_err());
        let bad=json!({"ok":true,"ticket":"T".repeat(43),"expiresAt":1045_000,
            "deviceId":"dev_abc","scope":"remote:execute"});
        assert!(parse_ticket(bad.to_string().as_bytes(),"dev_abc",1_000_000).is_err());
    }
}