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
fn device_id_ok(value: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;
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