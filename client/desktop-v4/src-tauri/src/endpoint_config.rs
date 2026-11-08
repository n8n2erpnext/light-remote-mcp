//! One build-embedded canonical JSON, authored at repo/config/endpoints.json.
//! Old credentials never select or change an issuer; product and route roles
//! fail closed on any profile, schema, origin, port or feed mismatch.
use serde_json::Value;
use std::{collections::HashMap,net::{SocketAddr,IpAddr},sync::OnceLock};
use url::Url;

struct Profile {
    revision:u64,
    product:String,
    name:String,
    cloud:HashMap<String,String>,
    routes:HashMap<String,String>,
    local:HashMap<String,(String,u16)>,
}
static GOLD:OnceLock<Result<Profile,String>>=OnceLock::new();
fn deny()->String{"canonical_endpoint_profile_invalid".into()}
fn parse()->Result<Profile,String>{
    let data:Value=serde_json::from_str(include_str!("../../../../config/endpoints.json"))
       .map_err(|_|deny())?;
    if data["schemaVersion"].as_u64()!=Some(1)||
       data["configRevision"].as_u64().unwrap_or(0)==0||
       data["selectedProfile"].as_str()!=Some("goldabv2-lab"){
        return Err(deny());
    }
    let product="goldabv2-desktop-v4";
    let profile=&data["profiles"]["goldabv2-lab"];
    if profile["productId"].as_str()!=Some(product)||
       profile["updates"]["productId"].as_str()!=Some(product)||
       profile["updates"]["channel"].as_str()!=Some("goldabv2-lab")||
       profile["updates"]["activationStatus"].as_str()!=
           Some("HOLD_UNTIL_APPROVED_PRODUCT_FEED_EXISTS")||
       !profile["updates"]["manifestUrl"].is_null()||
       !profile["updates"]["signatureUrl"].is_null()||
       data["releaseIntegrity"]["signedManifestRequired"].as_bool()!=Some(true){
        return Err(deny());
    }
    let mut cloud=HashMap::new();
    for role in ["owner","operator","deviceChannel","mcp"]{
        let raw=profile["cloudOrigins"][role].as_str().ok_or_else(deny)?;
        let parsed=Url::parse(raw).map_err(|_|deny())?;
        let host=parsed.host_str().ok_or_else(deny)?;
        if parsed.scheme()!="https"||parsed.port().is_some()||parsed.username()!=""||
           parsed.password().is_some()||parsed.query().is_some()||
           parsed.fragment().is_some()||parsed.path()!="/"||
           !host.starts_with("goldabv2.")||!host.ends_with(".thaiduy.digital"){
            return Err(deny());
        }
        cloud.insert(role.to_string(),raw.to_string());
    }
    let mut local=HashMap::new();
    for role in ["wall","fleet"]{
        let entry=&profile["localServices"][role];
        let host=entry["host"].as_str().ok_or_else(deny)?;
        let port=entry["port"].as_u64().ok_or_else(deny)?;
        if !["127.0.0.1","::1"].contains(&host)||port<1024||port>65535 {
            return Err(deny());
        }
        local.insert(role.to_string(),(host.to_string(),port as u16));
    }
    let map=data["routeCatalog"].as_object().ok_or_else(deny)?;
    let mut routes=HashMap::new();
    for (name,row) in map{
        let role=row["originRole"].as_str().ok_or_else(deny)?;
        let p=row["path"].as_str().ok_or_else(deny)?;
        if !p.starts_with('/')||p.starts_with("//")||p.contains("//")||
           p.contains("..")||p.contains('?')||p.contains('#') {
            return Err(deny());
        }
        let base=if let Some(service)=role.strip_prefix("local."){
            let (host,port)=local.get(service).ok_or_else(deny)?;
            let host=if host=="::1"{"[::1]"}else{host};
            format!("http://{}:{}",host,port)
        }else{
            cloud.get(role).ok_or_else(deny)?.to_string()
        };
        let fragment=match row.get("fragment"){
            Some(Value::String(value)) if value.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-')=>
                format!("#{}",value),
            Some(_)=>return Err(deny()),
            None=>String::new()
        };
        routes.insert(name.clone(),format!("{}{}{}",base,p,fragment));
    }
    for mandatory in ["ownerAuthorize","ownerToken","ownerRefresh","ownerSession",
        "ownerSnapshot","ownerLogout","wallHome","wallStatus","wallInstanceProof","wallLogsPage"]{
        if !routes.contains_key(mandatory){return Err(deny());}
    }
    Ok(Profile{revision:data["configRevision"].as_u64().ok_or_else(deny)?,
        product:product.into(),name:"goldabv2-lab".into(),cloud,routes,local})
}
fn profile()->Result<&'static Profile,String>{
    GOLD.get_or_init(parse).as_ref().map_err(Clone::clone)
}
pub(crate) fn cloud_origin(role:&str)->Result<&'static str,String>{
    profile()?.cloud.get(role).map(String::as_str).ok_or_else(deny)
}
pub(crate) fn route(name:&str)->Result<&'static str,String>{
    profile()?.routes.get(name).map(String::as_str).ok_or_else(deny)
}
pub(crate) fn local_port(role:&str)->Result<u16,String>{
    profile()?.local.get(role).map(|v|v.1).ok_or_else(deny)
}
pub(crate) fn local_socket(role:&str)->Result<SocketAddr,String>{
    let (host,port)=profile()?.local.get(role).ok_or_else(deny)?;
    Ok(SocketAddr::new(host.parse::<IpAddr>().map_err(|_|deny())?,*port))
}
pub(crate) fn credential_authority()->Result<String,String>{
    let p=profile()?;
    Ok(format!("{}|{}|{}",p.product,p.name,cloud_origin("owner")?))
}
pub(crate) fn config_revision()->Result<u64,String>{Ok(profile()?.revision)}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn routes_are_from_canonical_json_and_hold_not_legacy(){
        assert_eq!(config_revision().unwrap(),2);
        assert_eq!(local_port("wall").unwrap(),5491);
        assert_eq!(route("wallStatus").unwrap(),"http://127.0.0.1:5491/api/status");
        assert!(route("ownerAuthorize").unwrap().ends_with("/account/desktop/v4/authorize"));
        assert!(!route("ownerAuthorize").unwrap().contains("/mcp"));
        assert!(credential_authority().unwrap().contains("goldabv2-desktop-v4"));
    }
}
