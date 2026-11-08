//! Desktop V4 private, OS-backed refresh credential storage.
//! This module is never exposed as a Tauri invoke command; only the Rust
//! native Owner login flow may touch the OS credential store.
//! Windows Credential Manager, Apple Keychain and Linux Secret Service.
//! Fail closed when a backend is locked, inaccessible or unsupported.

#![allow(dead_code)]
use keyring::{Entry, Error};
use sha2::{Sha256,Digest};

const SERVICE: &str = "digital.thaiduy.lightremote.desktop.v4.owner";
// The keyring account is tied to product, profile and Owner issuer. A
// changed issuer receives a DIFFERENT OS credential; never forward old bearer.
fn authority_account()->Result<String,String>{
    let authority=crate::endpoint_config::credential_authority()?;
    let digest=Sha256::digest(authority.as_bytes());
    let suffix=digest[..12].iter().map(|b|format!("{:02x}",b)).collect::<String>();
    Ok(format!("owner_refresh_goldabv2_{}",suffix))
}
const TOKEN_LEN: usize = 43;

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_LEN &&
        token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, &authority_account()?).map_err(|_| "os_vault_unavailable".to_string())
}

/// Store one opaque rotating refresh credential. Never print it or expose it
/// to Webview, IPC payload, activity stream or the Local Wall HTTP endpoint.
pub(crate) fn store_refresh(token: &str) -> Result<(), String> {
    if !valid_token(token) { return Err("invalid_desktop_refresh".to_string()); }
    entry()?
        .set_password(token)
        .map_err(|_| "os_vault_write_failed".to_string())
}

/// Return a credential only to private native Rust caller. Distinguish
/// not-signed-in from OS secret-store failure; never silently fall back to a
/// plaintext local JSON file if Secret Service/Keychain is absent.
pub(crate) fn read_refresh() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(value) if valid_token(&value) => Ok(Some(value)),
        Ok(_) => Err("os_vault_credential_invalid".to_string()),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("os_vault_read_failed".to_string()),
    }
}

/// Remove native refresh after confirmed or attempted server-side logout.
/// A missing credential is harmless; a locked vault is NOT silently ignored.
pub(crate) fn remove_refresh() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err("os_vault_delete_failed".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_opaque_secret_validation() {
        assert!(valid_token(&"A".repeat(43)));
        assert!(valid_token(&("A".repeat(40) + "-z_")));
        assert!(!valid_token("short"));
        assert!(!valid_token(&"A".repeat(44)));
        assert!(!valid_token(&("A".repeat(42) + "/")));
        assert!(!valid_token(&("A".repeat(42) + "\n")));
    }
    #[test]
    fn fixed_distinct_credential_namespace() {
        assert_eq!(SERVICE,"digital.thaiduy.lightremote.desktop.v4.owner");
        assert!(!SERVICE.contains("/mcp"));
    }
}
