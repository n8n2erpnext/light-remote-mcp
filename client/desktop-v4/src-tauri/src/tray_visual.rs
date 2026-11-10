//! Presentation of the native Agent's existing five-state projection.
//! These pixels are the Moryqa SVG exports, not a second status indicator.
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Visual { Stopped, Unlinked, Disconnected, Dormant, Connected }

impl Visual {
    pub(crate) fn from_status(status: Option<&Value>) -> Self {
        let Some(s) = status else { return Self::Disconnected; };
        let yes = |key: &str| s.get(key).and_then(Value::as_bool) == Some(true);
        let no = |key: &str| s.get(key).and_then(Value::as_bool) == Some(false);
        // The managed component shares VisualFor with its own tray. Never
        // turn a missing, unknown or contradictory response green.
        match s.get("visualState").and_then(Value::as_str) {
            Some("stopped") if no("wallOnline") => Self::Stopped,
            Some("unlinked") if yes("ok") && yes("wallOnline") && no("Enrolled") => Self::Unlinked,
            Some("connected") if yes("ok") && yes("wallOnline") && yes("Enrolled") && yes("connected") => Self::Connected,
            Some("dormant") if yes("ok") && yes("wallOnline") && yes("Enrolled") && no("connected") => Self::Dormant,
            _ => Self::Disconnected,
        }
    }
    pub(crate) fn label(self) -> &'static str {
        match self { Self::Stopped => "Stopped", Self::Unlinked => "Link this PC",
            Self::Disconnected => "Disconnected", Self::Dormant => "Paused",
            Self::Connected => "Connected" }
    }
    pub(crate) fn rgba(self) -> &'static [u8; 4096] {
        match self {
            Self::Stopped => include_bytes!("../assets/tray/stopped.rgba"),
            Self::Unlinked => include_bytes!("../assets/tray/unlinked.rgba"),
            Self::Disconnected => include_bytes!("../assets/tray/disconnected.rgba"),
            Self::Dormant => include_bytes!("../assets/tray/dormant.rgba"),
            Self::Connected => include_bytes!("../assets/tray/connected.rgba"),
        }
    }
}

/// Five frames only when state changes; no idle/activity timer or fake pulse.
pub(crate) fn transition(from: Visual, to: Visual, step: u16) -> Vec<u8> {
    let step = step.min(5);
    from.rgba().iter().zip(to.rgba()).map(|(&a,&b)|
        ((u16::from(a)*(5-step) + u16::from(b)*step + 2)/5) as u8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_verified_native_projection_can_be_connected() {
        let good = json!({"ok":true,"wallOnline":true,"Enrolled":true,"connected":true,"visualState":"connected"});
        assert_eq!(Visual::from_status(Some(&good)),Visual::Connected);
        for field in ["ok","wallOnline","Enrolled","connected"] {
            let mut invalid=good.clone();invalid[field]=json!(false);
            assert_eq!(Visual::from_status(Some(&invalid)),Visual::Disconnected);
            invalid.as_object_mut().unwrap().remove(field);
            assert_eq!(Visual::from_status(Some(&invalid)),Visual::Disconnected);
        }
        assert_eq!(Visual::from_status(None),Visual::Disconnected);
        assert_eq!(Visual::from_status(Some(&json!({"visualState":"connected"}))),Visual::Disconnected);
        assert_eq!(Visual::from_status(Some(&json!({"visualState":"new-state"}))),Visual::Disconnected);
    }
    #[test]
    fn all_five_states_and_transition_endpoints_are_real_assets() {
        let cases=[
            (json!({"visualState":"stopped","wallOnline":false}),Visual::Stopped),
            (json!({"visualState":"unlinked","wallOnline":true,"ok":true,"Enrolled":false}),Visual::Unlinked),
            (json!({"visualState":"disconnected","wallOnline":true,"ok":true}),Visual::Disconnected),
            (json!({"visualState":"dormant","wallOnline":true,"ok":true,"Enrolled":true,"connected":false}),Visual::Dormant),
        ];
        for (value,want) in cases { assert_eq!(Visual::from_status(Some(&value)),want); }
        for from in [Visual::Stopped,Visual::Unlinked,Visual::Disconnected,Visual::Dormant,Visual::Connected] {
            assert!(from.rgba().chunks_exact(4).any(|p|p[3]>0));
            assert!(from.rgba().chunks_exact(4).any(|p|p[3]==0));
            for to in [Visual::Stopped,Visual::Unlinked,Visual::Disconnected,Visual::Dormant,Visual::Connected] {
                assert_eq!(transition(from,to,0),from.rgba().as_slice());
                assert_eq!(transition(from,to,5),to.rgba().as_slice());
                assert_eq!(transition(from,to,u16::MAX),to.rgba().as_slice());
                for step in 1..5 { assert_eq!(transition(from,to,step).len(),4096); }
            }
        }
    }
}
