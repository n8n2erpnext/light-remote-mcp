//! Desktop V4 native Owner login: system browser + bounded loopback OAuth
//! callback + native HTTPS token exchange. Feature OFF in current pilot.
//! The only Tauri IPC result is sanitized phase/accountId (never credentials).
//!
//! This is independent from ChatGPT's custom MCP endpoint and from the local
//! HTTP Wall. OAuth and refresh secrets remain in Rust / OS credential store.
#![allow(dead_code)]

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;
use url::Url;
use crate::owner_vault;

const AUTH_ORIGIN: &str = "https://goldabv2.light-remote.thaiduy.digital";
const AUTHORIZE: &str = "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/authorize";
const TOKEN: &str = "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/token";
const REFRESH: &str = "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/refresh";
const SESSION: &str = "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/session";
const LOGOUT: &str = "https://goldabv2.light-remote.thaiduy.digital/account/desktop/v4/logout";
const RESOURCE: &str = "urn:light-remote:desktop-owner:v4";
const CLIENT_ID: &str = "light-remote-desktop-v4";
const SCOPE: &str = "desktop:read";
const CALLBACK_PATH: &str = "/desktop/v4/callback";

fn secret() -> String {
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}
fn token_ok(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn account_ok(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 &&
        value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct OwnerView {
    pub phase: String,
    pub account_id: Option<String>,
}
struct NativeSession {
    phase: String,
    account_id: Option<String>,
    access_token: Option<String>,
    access_deadline: Option<Instant>,
    last_verified: Option<Instant>,
    generation: u64,
}
impl Default for NativeSession {
    fn default() -> Self {
        Self { phase:"signed_out".into(),account_id:None,access_token:None,
            access_deadline:None,last_verified:None,generation:0 }
    }
}
#[derive(Default, Clone)]
pub(crate) struct OwnerRuntime {
    inner: Arc<Mutex<NativeSession>>,
}
impl OwnerRuntime {
    fn view(&self) -> Result<OwnerView,String> {
        let mut s = self.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.phase=="verified" && s.access_deadline.is_some_and(|d| Instant::now() >= d) {
            s.phase="expired".into();
            s.access_token=None;
            s.account_id=None;
            s.last_verified=None;
        }
        Ok(OwnerView {phase:s.phase.clone(),account_id:s.account_id.clone()})
    }
    fn transition(&self, phase:&str) -> Result<u64,String> {
        let mut s=self.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.phase=="browser_pending" || s.phase=="restoring" {
            return Err("owner_login_already_pending".into());
        }
        s.generation=s.generation.wrapping_add(1);
        s.phase=phase.into();
        s.account_id=None;
        s.access_token=None;
        s.access_deadline=None;
        s.last_verified=None;
        Ok(s.generation)
    }
    fn finish(&self, generation:u64, result:Result<TokenSet,String>) {
        let Ok(mut s)=self.inner.lock() else { return; };
        // A cancelled/old browser attempt MUST NOT write a refresh token into
        // the vault after local Sign out. Burn its server-side family instead.
        if s.generation!=generation {
            drop(s);
            if let Ok(tokens)=result {
                if let Ok(client)=http(){revoke_remote(&client,&tokens.refresh_token);}
            }
            return;
        }
        match result {
            Ok(tokens)=>{
                // Hold the native state mutex through persistence so Sign out
                // cannot race a successful rotation into an orphaned vault.
                if let Err(_)=owner_vault::store_refresh(&tokens.refresh_token) {
                    s.phase="expired".into();
                    s.account_id=None;
                    s.access_token=None;
                    s.access_deadline=None;
                    s.last_verified=None;
                    drop(s);
                    if let Ok(client)=http(){revoke_remote(&client,&tokens.refresh_token);}
                    return;
                }
                s.phase="verified".into();
                s.account_id=Some(tokens.account_id);
                s.access_token=Some(tokens.access_token);
                s.access_deadline=Some(Instant::now()+Duration::from_secs(tokens.expires_in));
                s.last_verified=Some(Instant::now());
            }
            Err(_)=>{
                s.phase="expired".into();
                s.account_id=None;
                s.access_token=None;
                s.access_deadline=None;
                s.last_verified=None;
            }
        }
    }
}
struct TokenSet {
    access_token:String,
    refresh_token:String,
    account_id:String,
    expires_in:u64,
}
fn http() -> Result<Client,String> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_|"owner_https_unavailable".into())
}
fn read_json(mut response:Response) -> Result<Value,String> {
    if !response.status().is_success(){return Err("owner_authorization_rejected".into());}
    // Untrusted HTTP response body is capped at 8 KiB.
    let mut bounded=Vec::with_capacity(1024);
    response.take(8193).read_to_end(&mut bounded)
        .map_err(|_|"owner_https_unavailable")?;
    if bounded.len()>8192{return Err("owner_reply_oversize".into());}
    serde_json::from_slice(&bounded).map_err(|_|"owner_reply_invalid".into())
}
fn check_token_set(response:Value) -> Result<TokenSet,String> {
    let access=response.get("access_token").and_then(Value::as_str).unwrap_or("");
    let refresh=response.get("refresh_token").and_then(Value::as_str).unwrap_or("");
    let account=response.get("account_id").and_then(Value::as_str).unwrap_or("");
    let exp=response.get("expires_in").and_then(Value::as_u64).unwrap_or(0);
    if response.get("token_type").and_then(Value::as_str)!=Some("Bearer") ||
        response.get("scope").and_then(Value::as_str)!=Some(SCOPE) ||
        response.get("resource").and_then(Value::as_str)!=Some(RESOURCE) ||
        !token_ok(access) || !token_ok(refresh) || !account_ok(account) ||
        exp==0 || exp>600 {
        return Err("owner_reply_invalid".into());
    }
    Ok(TokenSet {
        access_token:access.into(),refresh_token:refresh.into(),
        account_id:account.into(),expires_in:exp
    })
}
fn revoke_remote(client:&Client, refresh:&str) {
    if token_ok(refresh) {
        let _=client.post(LOGOUT).json(&json!({"refresh_token":refresh})).send();
    }
}
fn exchange(code:&str, verifier:&str, redirect:&str, install_nonce:&str, state:&str)
        -> Result<TokenSet,String> {
    let client=http()?;
    let response=client.post(TOKEN).json(&json!({
        "code":code,"code_verifier":verifier,"redirect_uri":redirect,
        "install_nonce":install_nonce,"state":state
    })).send().map_err(|_|"owner_https_unavailable")?;
    let received=check_token_set(read_json(response)?)?;
    // The generation-checked native OwnerRuntime persists the rotating
    // refresh token atomically with presentation of verified Owner state.
    Ok(received)
}
fn refresh_from_vault() -> Result<TokenSet,String> {
    let existing=owner_vault::read_refresh()?
        .ok_or_else(||"owner_not_signed_in".to_string())?;
    let client=http()?;
    let response=client.post(REFRESH)
        .json(&json!({"refresh_token":existing}))
        .send().map_err(|_|"owner_https_unavailable")?;
    let received=match read_json(response).and_then(check_token_set) {
        Ok(tokens)=>tokens,
        Err(error)=>return Err(error)
    };
    // Storage is handled by OwnerRuntime.finish only if still current.
    Ok(received)
}
fn auth_url(redirect:&str, verifier:&str, state:&str, install_nonce:&str)
        -> Result<String,String> {
    let mut url=Url::parse(AUTHORIZE).map_err(|_|"owner_url_invalid")?;
    url.query_pairs_mut()
        .append_pair("client_id",CLIENT_ID)
        .append_pair("resource",RESOURCE)
        .append_pair("scope",SCOPE)
        .append_pair("response_type","code")
        .append_pair("code_challenge_method","S256")
        .append_pair("code_challenge",&challenge(verifier))
        .append_pair("redirect_uri",redirect)
        .append_pair("state",state)
        .append_pair("install_nonce",install_nonce);
    Ok(url.into())
}
fn system_browser(url:&str) -> Result<(),String> {
    if !url.starts_with(AUTHORIZE) {return Err("owner_url_invalid".into());}
    #[cfg(target_os="windows")]
    let result=Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url).spawn();
    #[cfg(target_os="macos")]
    let result=Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os="windows",target_os="macos")))]
    let result=Command::new("xdg-open").arg(url).spawn();
    result.map(|_|()).map_err(|_|"owner_browser_unavailable".into())
}
fn validate_callback(target:&str, state:&str) -> Result<String,String> {
    if target.len()>1800 || !target.starts_with(CALLBACK_PATH) ||
        target.bytes().any(|b| b<0x20 || b==0x7f) {
        return Err("owner_callback_invalid".into());
    }
    let url=Url::parse(&format!("http://127.0.0.1{}",target))
        .map_err(|_|"owner_callback_invalid")?;
    if url.path()!=CALLBACK_PATH || url.fragment().is_some() {
        return Err("owner_callback_invalid".into());
    }
    let mut code=None;let mut returned_state=None;let mut issuer=None;let mut error=None;
    for (k,v) in url.query_pairs() {
        match k.as_ref() {
            "code" if code.is_none()=>code=Some(v.into_owned()),
            "state" if returned_state.is_none()=>returned_state=Some(v.into_owned()),
            "iss" if issuer.is_none()=>issuer=Some(v.into_owned()),
            "error" if error.is_none()=>error=Some(v.into_owned()),
            _=>return Err("owner_callback_invalid".into())
        }
    }
    if returned_state.as_deref()!=Some(state) || issuer.as_deref()!=Some(AUTH_ORIGIN){
        return Err("owner_callback_mismatch".into());
    }
    if error.as_deref()==Some("access_denied") && code.is_none(){
        return Err("owner_consent_denied".into());
    }
    let code=code.ok_or_else(||"owner_callback_invalid".to_string())?;
    if !token_ok(&code) || error.is_some(){return Err("owner_callback_invalid".into());}
    Ok(code)
}
fn respond(mut client:TcpStream, ok:bool) {
    let msg=if ok { "Return to Light Remote Desktop. Sign-in result received." }
        else { "This sign-in request was not accepted. Return to Light Remote Desktop." };
    let response=format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        msg.len(),msg);
    let _=client.write_all(response.as_bytes());
}
fn capture(listener:TcpListener, state:&str, port:u16) -> Result<String,String> {
    listener.set_nonblocking(true).map_err(|_|"owner_callback_unavailable")?;
    let deadline=Instant::now()+Duration::from_secs(120);
    while Instant::now()<deadline {
        match listener.accept() {
            Ok((mut client,_))=>{
                client.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let mut b=[0u8;4096];
                let n=match client.read(&mut b) {
                    Ok(n) if n>0=>n,
                    _=>{respond(client,false);continue;}
                };
                let raw=match std::str::from_utf8(&b[..n]) {
                    Ok(t)=>t,_=>{respond(client,false);continue;}
                };
                let mut lines=raw.split("\r\n");
                let first=lines.next().unwrap_or("");
                let expected_host=format!("127.0.0.1:{}",port);
                let mut host_count=0usize;
                let mut host_valid=false;
                for line in lines {
                    if let Some((name,value))=line.split_once(':') {
                        if name.eq_ignore_ascii_case("host") {
                            host_count+=1;
                            host_valid=value.trim()==expected_host;
                        }
                    }
                }
                if host_count!=1 || !host_valid ||
                    !first.starts_with("GET ") || !first.ends_with(" HTTP/1.1") {
                    respond(client,false);
                    continue;
                }
                let target=first.strip_prefix("GET ").unwrap_or("")
                    .strip_suffix(" HTTP/1.1").unwrap_or("");
                let outcome=validate_callback(target,state);
                respond(client,outcome.is_ok());
                match outcome {
                    Ok(code)=>return Ok(code),
                    Err(error) if error=="owner_consent_denied"=>return Err(error),
                    Err(_)=>continue
                }
            }
            Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>
                thread::sleep(Duration::from_millis(50)),
            Err(_)=>return Err("owner_callback_unavailable".into()),
        }
    }
    Err("owner_callback_expired".into())
}

#[tauri::command]
pub(crate) fn desktop_owner_begin(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let listener=TcpListener::bind("127.0.0.1:0")
        .map_err(|_|"owner_callback_unavailable")?;
    let port=listener.local_addr().map_err(|_|"owner_callback_unavailable")?.port();
    if port<1024 {return Err("owner_callback_unavailable".into());}
    let redirect=format!("http://127.0.0.1:{}{}",port,CALLBACK_PATH);
    let verifier=secret();let csrf_state=secret();let install_nonce=secret();
    let url=auth_url(&redirect,&verifier,&csrf_state,&install_nonce)?;
    let generation=state.transition("browser_pending")?;
    let runtime=OwnerRuntime { inner:Arc::clone(&state.inner) };
    if let Err(error)=system_browser(&url) {
        runtime.finish(generation,Err(error.clone()));
        return Err(error);
    }
    thread::spawn(move||{
        let result=capture(listener,&csrf_state,port)
            .and_then(|code|exchange(&code,&verifier,&redirect,&install_nonce,&csrf_state));
        runtime.finish(generation,result);
    });
    state.view()
}
// Revalidate the original Owner account session through the dedicated HTTPS
// Desktop endpoint at most every 15 seconds. On network loss or revocation,
// lock immediately instead of keeping stale Owner privilege in the Webview.
fn revalidate_owner(runtime:&OwnerRuntime) -> Result<OwnerView,String> {
    let info={
        let s=runtime.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.phase!="verified" || s.last_verified.is_some_and(|t|t.elapsed()<Duration::from_secs(15)){
            None
        } else {
            Some((s.access_token.clone(),s.account_id.clone(),s.generation))
        }
    };
    let Some(info)=info else {return runtime.view();};
    let ok=match (info.0.as_deref(),info.1.as_deref()) {
        (Some(access),Some(account))=>{
            let response=http().and_then(|client|{
                let res=client.get(SESSION).bearer_auth(access)
                    .send().map_err(|_|"owner_https_unavailable")?;
                read_json(res)
            });
            response.is_ok_and(|value|
                value.get("verified").and_then(Value::as_bool)==Some(true) &&
                value.get("accountId").and_then(Value::as_str)==Some(account) &&
                value.get("resource").and_then(Value::as_str)==Some(RESOURCE) &&
                value.get("scope").and_then(Value::as_str)==Some(SCOPE))
        }
        _=>false
    };
    {
        let mut s=runtime.inner.lock().map_err(|_|"owner_state_unavailable")?;
        if s.generation==info.2 && s.phase=="verified" {
            if ok {s.last_verified=Some(Instant::now());}
            else {
                s.phase="expired".into();
                s.account_id=None;s.access_token=None;s.access_deadline=None;s.last_verified=None;
            }
        }
    }
    runtime.view()
}
#[tauri::command]
pub(crate) async fn desktop_owner_status(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let runtime=OwnerRuntime {inner:Arc::clone(&state.inner)};
    tauri::async_runtime::spawn_blocking(move||revalidate_owner(&runtime))
        .await.map_err(|_|"owner_state_unavailable".to_string())?
}
#[tauri::command]
pub(crate) fn desktop_owner_restore(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let generation=state.transition("restoring")?;
    let runtime=OwnerRuntime { inner:Arc::clone(&state.inner) };
    thread::spawn(move||runtime.finish(generation,refresh_from_vault()));
    state.view()
}
#[tauri::command]
pub(crate) fn desktop_owner_logout(state:State<'_,OwnerRuntime>) -> Result<OwnerView,String> {
    let access={
        let mut s=state.inner.lock().map_err(|_|"owner_state_unavailable")?;
        s.generation=s.generation.wrapping_add(1);
        s.phase="signed_out".into();
        s.account_id=None;
        s.access_deadline=None;
        s.last_verified=None;
        s.access_token.take()
    };
    let stored=owner_vault::read_refresh()?;
    // Delete even if the server is offline. No credentials remain on device.
    owner_vault::remove_refresh()?;
    if let Some(value)=access.or(stored) {
        let client=http()?;
        client.post(LOGOUT)
            .header("Authorization",format!("Bearer {}",value))
            .json(&json!({}))
            .send().map_err(|_|"owner_server_logout_unconfirmed")?
            .error_for_status().map_err(|_|"owner_server_logout_unconfirmed")?;
    }
    state.view()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_is_exact_account_desktop_not_mcp_or_wall() {
        let u=auth_url("http://127.0.0.1:49152/desktop/v4/callback",
            &"V".repeat(43),&"S".repeat(43),&"I".repeat(43)).unwrap();
        let parsed=Url::parse(&u).unwrap();
        assert_eq!(parsed.origin().ascii_serialization(),AUTH_ORIGIN);
        assert_eq!(parsed.path(),"/account/desktop/v4/authorize");
        assert!(!parsed.path().contains("/mcp"));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(!u.contains("code_verifier"));
    }
    #[test]
    fn exact_pkce_and_callback_prevent_replay_and_redirect_spoof() {
        let state="S".repeat(43);
        let code="C".repeat(43);
        let success=format!("/desktop/v4/callback?code={}&state={}&iss=https%3A%2F%2Fgoldabv2.light-remote.thaiduy.digital",code,state);
        assert_eq!(validate_callback(&success,&state).unwrap(),code);
        for invalid in [
            success.replace("SSSS","TTTT"),
            success.replace("goldabv2.light-remote.thaiduy.digital","evil.example"),
            success.replace("/desktop/v4/callback","/desktop/v4/callback/extra"),
            format!("{}&code={}",success,code),
            format!("{}&state={}",success,state),
            format!("{}&extra=value",success),
            "/desktop/v4/callback?code=foo".into(),
            "/desktop/v4/callback#fragment".into()
        ] {
            assert!(validate_callback(&invalid,&state).is_err());
        }
    }
    #[test]
    fn explicit_consent_denial_is_not_success() {
        let state="S".repeat(43);
        let denied=format!("/desktop/v4/callback?error=access_denied&state={}&iss=https%3A%2F%2Fgoldabv2.light-remote.thaiduy.digital",state);
        assert_eq!(validate_callback(&denied,&state).unwrap_err(),"owner_consent_denied");
    }
    #[test]
    fn token_reply_must_be_exact_purpose_and_bounded() {
        let valid=json!({
            "token_type":"Bearer","scope":SCOPE,"resource":RESOURCE,
            "account_id":"owner1","access_token":"A".repeat(43),
            "refresh_token":"R".repeat(43),"expires_in":600
        });
        assert_eq!(check_token_set(valid.clone()).unwrap().expires_in,600);
        let mut invalid=valid.clone();invalid["scope"]=json!("remote:execute");
        assert!(check_token_set(invalid).is_err());
        let mut invalid=valid;invalid["expires_in"]=json!(86400);
        assert!(check_token_set(invalid).is_err());
    }
    #[test]
    fn generated_material_is_independent_random_base64url() {
        let a=secret();let b=secret();
        assert!(token_ok(&a));assert!(token_ok(&b));assert_ne!(a,b);
        assert!(token_ok(&challenge(&a)));
    }
}
