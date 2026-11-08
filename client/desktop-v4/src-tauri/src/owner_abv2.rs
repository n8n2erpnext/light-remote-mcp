//! Same-host Desktop Owner -> enrolled Agent A/B V2 IPC.
 //! Fixed OS-private endpoint, no HTTP Wall credentials and no JS Owner token.
 //! The Agent verifies Native Owner Bearer with GoldABV2 and signs the
 //! EXISTING A/B V2 Operator channel; it does not grant access locally.
#![allow(dead_code)]

use std::{io::{Read,Write},time::Duration};
use serde_json::{Value,json};

const PIPE: &str = r"\\.\pipe\light-remote-desktop-v4-abv2";
const UNIX_FILE: &str = "desktop-v4-abv2.sock";
const MAX_REQUEST: usize = 1700;
const MAX_RESPONSE: u64 = 8192;

fn deny() -> String { "desktop_abv2_native_unavailable".into() }
fn ident(s:&str) -> bool {
    !s.is_empty() && s.len()<=160 &&
      s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b))
}
fn request_id(s:&str) -> bool {
    s.len()==36 && s.starts_with("av2_") &&
      s.as_bytes()[4..].iter().all(|b|b.is_ascii_digit()||(*b>=b'a'&&*b<=b'f'))
}
fn row(view:&Value) -> Result<Value,String> {
    let id=view.get("requestId").and_then(Value::as_str).ok_or_else(deny)?;
    let attempt=view.get("attempt").and_then(Value::as_u64).ok_or_else(deny)?;
    let expires=view.get("expiresAt").and_then(Value::as_u64).ok_or_else(deny)?;
    if !request_id(id)||attempt==0||attempt>1_000_000||expires==0 {
        return Err(deny());
    }
    let a=view.get("aCode").and_then(Value::as_str);
    if a.is_some_and(|x|x.len()>32||!x.is_ascii()) {return Err(deny());}
    Ok(json!({"requestId":id,"attempt":attempt,"expiresAt":expires,
        "aCode":a}))
}
fn sanitize(request:&Value,response:Value)->Result<Value,String> {
    if response.get("ok").and_then(Value::as_bool)!=Some(true) {return Err(deny());}
    match request.get("action").and_then(Value::as_str) {
        Some("pending")=>{
            let device=response.get("deviceId").and_then(Value::as_str).ok_or_else(deny)?;
            let short=response.get("shortId").and_then(Value::as_str);
            let enabled=response.get("ownerApproveEnabled").and_then(Value::as_bool).ok_or_else(deny)?;
            let consent=response.get("ownerConsentRequired").and_then(Value::as_bool).ok_or_else(deny)?;
            let pending=response.get("pending").and_then(Value::as_array).ok_or_else(deny)?;
            if !ident(device)||pending.len()>5||
                short.is_some_and(|s|s.len()!=6||!s.bytes().all(|b|b.is_ascii_alphanumeric())) {
                return Err(deny());
            }
            let rows:Result<Vec<_>,_>=pending.iter().map(row).collect();
            Ok(json!({"state":"ready","deviceId":device,
                "shortId":short,"ownerApproveEnabled":enabled,
                "ownerConsentRequired":consent,"pending":rows?}))
        }
        Some("approve")=>{
            if response.get("state").and_then(Value::as_str)!=Some("granted") ||
              response.get("requestId")!=request.get("requestId") {
                return Err(deny());
            }
            let expires=response.get("expiresAt").and_then(Value::as_u64);
            Ok(json!({"state":"granted","requestId":response.get("requestId"),
                "expiresAt":expires}))
        }
        _=>Err(deny())
    }
}

pub(crate) fn exchange(request:&Value)->Result<Value,String> {
    let mut line=serde_json::to_vec(request).map_err(|_|deny())?;
    line.push(b'\n');
    if line.len()>MAX_REQUEST {return Err(deny());}
    let mut bytes=Vec::with_capacity(1024);
    #[cfg(windows)]
    {
        // An overlapped named-pipe client prevents a peer which never sends
        // EOF from pinning a Tauri Owner Approval worker forever. The deadline
        // covers connect/open, write and bounded read, not just a late check.
        use tokio::io::{AsyncReadExt,AsyncWriteExt};
        let runtime=tokio::runtime::Builder::new_current_thread()
            .enable_io().enable_time().build().map_err(|_|deny())?;
        runtime.block_on(async {
            tokio::time::timeout(Duration::from_secs(9),async {
                let mut pipe=tokio::net::windows::named_pipe::ClientOptions::new()
                    .open(PIPE).map_err(|_|deny())?;
                pipe.write_all(&line).await.map_err(|_|deny())?;
                pipe.flush().await.map_err(|_|deny())?;
                pipe.take(MAX_RESPONSE+1).read_to_end(&mut bytes).await.map_err(|_|deny())?;
                Ok::<(),String>(())
            }).await.map_err(|_|deny())?
        })?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let home=std::env::var_os("HOME").ok_or_else(deny)?;
        let file=std::path::PathBuf::from(home).join(".light-remote").join(UNIX_FILE);
        let mut socket=UnixStream::connect(file).map_err(|_|deny())?;
        socket.set_read_timeout(Some(Duration::from_secs(8))).map_err(|_|deny())?;
        socket.set_write_timeout(Some(Duration::from_secs(8))).map_err(|_|deny())?;
        socket.write_all(&line).map_err(|_|deny())?;
        socket.take(MAX_RESPONSE+1).read_to_end(&mut bytes).map_err(|_|deny())?;
    }
    if bytes.len()<3||bytes.len()>MAX_RESPONSE as usize||bytes.last()!=Some(&b'\n') {
        return Err(deny());
    }
    let response:Value=serde_json::from_slice(&bytes[..bytes.len()-1]).map_err(|_|deny())?;
    sanitize(request,response)
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn no_grant_from_pending_response(){
  let req=json!({"action":"pending"});
  assert!(sanitize(&req,json!({"ok":true,"state":"granted"})).is_err());
 }
 #[test]
 fn fail_closed_bad_rows(){
  let req=json!({"action":"pending"});
  let reply=json!({"ok":true,"deviceId":"dev_x","shortId":"ABC123",
   "ownerApproveEnabled":true,"ownerConsentRequired":false,
   "pending":[{"requestId":"av2_INVALID","attempt":1,"expiresAt":9999}]});
  assert!(sanitize(&req,reply).is_err());
 }
 #[test]
 fn pending_projection_has_only_bounded_fields(){
  let req=json!({"action":"pending"});
  let reply=json!({"ok":true,"deviceId":"dev_x","shortId":"ABC123",
   "ownerApproveEnabled":true,"ownerConsentRequired":false,"access_token":"secret",
   "pending":[{"requestId":format!("av2_{}","a".repeat(32)),
    "attempt":1,"expiresAt":9999,"aCode":"AAA-BBB","token":"FORBIDDEN"}]});
  let view=sanitize(&req,reply).unwrap();
  assert_eq!(view.get("pending").unwrap().as_array().unwrap().len(),1);
  assert!(view.get("access_token").is_none());
  assert!(view.get("pending").unwrap()[0].get("token").is_none());
 }
 #[test]
 fn approval_must_match_exact_request(){
  let req=json!({"action":"approve","requestId":format!("av2_{}","a".repeat(32))});
  let reply=json!({"ok":true,"state":"granted","requestId":format!("av2_{}","b".repeat(32))});
  assert!(sanitize(&req,reply).is_err());
 }
}
