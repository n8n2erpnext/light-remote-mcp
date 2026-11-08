import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

// macOS AX semantic snapshots. Disabled until the owner grants Accessibility
// to the native helper; never requests or bypasses TCC permissions.
private func axAttribute(_ element:AXUIElement,_ name:String) -> CFTypeRef? {
    var value:CFTypeRef?
    guard AXUIElementCopyAttributeValue(element,name as CFString,&value) == .success else {return nil}
    return value
}
private func axString(_ element:AXUIElement,_ name:String) -> String {
    return axAttribute(element,name) as? String ?? ""
}
private func axBoolean(_ element:AXUIElement,_ name:String,_ fallback:Bool=false) -> Bool {
    return axAttribute(element,name) as? Bool ?? fallback
}
func axRect(_ element:AXUIElement) -> [String:Any] {
    var origin=CGPoint.zero,size=CGSize.zero
    if let raw=axAttribute(element,kAXPositionAttribute), CFGetTypeID(raw)==AXValueGetTypeID() {
        _=AXValueGetValue(unsafeBitCast(raw,to:AXValue.self),.cgPoint,&origin)
    }
    if let raw=axAttribute(element,kAXSizeAttribute), CFGetTypeID(raw)==AXValueGetTypeID() {
        _=AXValueGetValue(unsafeBitCast(raw,to:AXValue.self),.cgSize,&size)
    }
    return ["x":origin.x,"y":origin.y,"width":max(0,size.width),"height":max(0,size.height)]
}
private func axChildren(_ element:AXUIElement) -> [AXUIElement] {
    return axAttribute(element,kAXChildrenAttribute) as? [AXUIElement] ?? []
}
private func frontmostPid() throws -> pid_t {
    guard let app=NSWorkspace.shared.frontmostApplication else {throw RemoteError.invalid("semantic_foreground_missing")}
    return pid_t(app.processIdentifier)
}
func writeFocusedEmptyTextByAX(_ value:String) throws -> Bool {
    guard accessibilityAllowed(),let foreground=NSWorkspace.shared.frontmostApplication else {return false}
    let app=AXUIElementCreateApplication(pid_t(foreground.processIdentifier))
    guard let raw=axAttribute(app,kAXFocusedUIElementAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID() else {return false}
    let el=unsafeBitCast(raw,to:AXUIElement.self)
    let role=axString(el,kAXRoleAttribute)
    guard role=="AXTextField" || role=="AXTextArea" else {return false}
    let subrole=axString(el,kAXSubroleAttribute).lowercased()
    guard !subrole.contains("secure"),axBoolean(el,kAXEnabledAttribute,true) else {return false}
    guard let before=axAttribute(el,kAXValueAttribute) as? String,before.isEmpty else {return false}
    guard AXUIElementSetAttributeValue(el,kAXValueAttribute as CFString,value as CFString) == .success else {return false}
    guard let after=axAttribute(el,kAXValueAttribute) as? String,
          after.precomposedStringWithCanonicalMapping==value.precomposedStringWithCanonicalMapping else {
        throw RemoteError.invalid("macos_ax_text_verification_failed")
    }
    return true
}

// A bounded fingerprint of AX metadata only: NEVER read a text field's value.
private func axSignatures(_ snapshot:[String:Any]) -> [String:String] {
    let nodes=snapshot["nodes"] as? [[String:Any]] ?? []
    var signatures:[String:String]=[:]
    for record in nodes {
        guard let id=record["nodeId"] as? String else {continue}
        let keys=["role","name","enabled","focused","offscreen","bounds","parent"]
        var fingerprint:[String:Any]=[:]
        for key in keys {if let value=record[key] {fingerprint[key]=value}}
        if let data=try? JSONSerialization.data(withJSONObject:fingerprint,options:[.sortedKeys]) {
            signatures[id]=String(decoding:data,as:UTF8.self)
        }
    }
    return signatures
}

struct AXSession {
    let id:String
    let epoch:String
    let scope:String
    let pid:pid_t
    let maxDepth:Int
    let maxNodes:Int
    let attached:Int64
    var stateSeq:Int64=1
    var inputSeq:Int64=0
    var nodes:[String:AXUIElement]=[:]
    var nodeSignatures:[String:String]=[:]
    var eventJournal:[[String:Any]]=[]
    var droppedBeforeSeq:Int64=0
    var lastPolledAt:Int64=0
}
final class SemanticEngine {
    private var sessions:[String:AXSession]=[:]
    var activeSessionCount:Int {sessions.count}
    // Poll-driven, bounded AX delta journal. Does not create a permanent
    // AX observer, retain UI text values or run background OS event hooks.
    private func updateJournal(_ session:inout AXSession,_ snapshot:[String:Any]) {
        let next=axSignatures(snapshot)
        let previous=session.nodeSignatures
        let added=next.keys.filter {previous[$0] == nil}.sorted()
        let removed=previous.keys.filter {next[$0] == nil}.sorted()
        let changed=next.keys.filter {id in
            guard let prior=previous[id],let now=next[id] else {return false}
            return prior != now
        }.sorted()
        session.nodeSignatures=next
        guard !added.isEmpty || !removed.isEmpty || !changed.isEmpty else {return}
        session.stateSeq+=1
        let count=added.count+removed.count+changed.count
        session.eventJournal.append([
            "type":"ax.delta","stateSeq":session.stateSeq,
            "added":Array(added.prefix(80)),
            "removed":Array(removed.prefix(80)),
            "updated":Array(changed.prefix(80)),
            "truncated":count>240,"at":timestamp()
        ])
        if session.eventJournal.count>100 {
            let extra=session.eventJournal.count-100
            let evicted=session.eventJournal[extra-1]
            session.droppedBeforeSeq=evicted["stateSeq"] as? Int64 ?? session.droppedBeforeSeq
            session.eventJournal.removeFirst(extra)
        }
    }
    private func trusted() throws {
        guard accessibilityAllowed() else {throw RemoteError.invalid("macos_accessibility_permission_required")}
    }
    private func root(_ s:AXSession) -> AXUIElement {
        let app=AXUIElementCreateApplication(s.pid)
        if s.scope == "foreground",
           let raw=axAttribute(app,kAXFocusedWindowAttribute),
           CFGetTypeID(raw)==AXUIElementGetTypeID() {
            return unsafeBitCast(raw,to:AXUIElement.self)
        }
        return app
    }
    private func tree(_ session:inout AXSession) -> [String:Any] {
        let seed=root(session)
        var queue:[(AXUIElement,Int,Int,String)]=[(seed,-1,0,"0")]
        var index=0
        var items:[[String:Any]]=[]
        var nodes:[String:AXUIElement]=[:]
        while !queue.isEmpty && items.count<session.maxNodes {
            let (element,parent,depth,key)=queue.removeFirst()
            let nodeId="macax_"+session.epoch+"_"+key
            let role=axString(element,kAXRoleAttribute)
            let title=axString(element,kAXTitleAttribute)
            let description=axString(element,kAXDescriptionAttribute)
            let enabled=axBoolean(element,kAXEnabledAttribute,true)
            let focused=axBoolean(element,kAXFocusedAttribute)
            let secure=role.localizedCaseInsensitiveContains("secure") ||
                        role.localizedCaseInsensitiveContains("password")
            let bounds=axRect(element)
            let bX=bounds["x"] as? CGFloat ?? 0
            let bY=bounds["y"] as? CGFloat ?? 0
            let bW=bounds["width"] as? CGFloat ?? 0
            let bH=bounds["height"] as? CGFloat ?? 0
            let offscreen=bW<=0 || bH<=0
            var actions=["focus"]
            if enabled && !offscreen {actions.append("click")}
            if !secure && enabled {actions.append("invoke")}
            if role.localizedCaseInsensitiveContains("text") && !secure {actions.append("value")}
            let record:[String:Any]=[
              "nodeId":nodeId,"index":index,"parent":parent,"depth":depth,
              "role":role,"name":title.isEmpty ? description : title,
              "automationId":"","className":role,"frameworkId":"macos-ax",
              "processId":Int(session.pid),"nativeWindowHandle":0,
              "enabled":enabled,"offscreen":offscreen,"focused":focused,
              "password":secure,"bounds":bounds,
              "center":["x":bX+bW/2,"y":bY+bH/2],
              "patterns":["Accessibility"],"actions":actions
            ]
            items.append(record);nodes[nodeId]=element
            let parentIndex=index
            index+=1
            if depth<session.maxDepth {
                for (childIndex,child) in axChildren(element).prefix(200).enumerated() {
                    if queue.count+items.count>=session.maxNodes {break}
                    queue.append((child,parentIndex,depth+1,key+"."+String(childIndex)))
                }
            }
        }
        session.nodes=nodes
        return ["rootHwnd":0,"rootTitle":NSRunningApplication(processIdentifier:session.pid)?.localizedName ?? "",
                "nodes":items,"truncated":!queue.isEmpty,"capturedAt":timestamp()]
    }
    func attach(_ request:[String:Any]) throws -> [String:Any] {
        try trusted()
        guard sessions.count<8 else {throw RemoteError.invalid("semantic_session_limit")}
        let scope=string(request["scope"],"foreground")
        let id="sem_"+UUID().uuidString.replacingOccurrences(of:"-",with:"")
        let epoch="epoch_"+UUID().uuidString.replacingOccurrences(of:"-",with:"")
        let s=AXSession(id:id,epoch:epoch,scope:scope,pid:try frontmostPid(),
                        maxDepth:clamp(integer(request["maxDepth"],6),1,12),
                        maxNodes:clamp(integer(request["maxNodes"],500),1,1500),
                        attached:timestamp())
        var row=s
        let snapshot=tree(&row)
        row.nodeSignatures=axSignatures(snapshot)
        row.lastPolledAt=timestamp()
        sessions[id]=row
        return ["semanticSessionId":id,"epoch":epoch,"scope":scope,"rootHwnd":0,
                "rootTitle":snapshot["rootTitle"] ?? "","rootEpoch":1,
                "stateSeq":row.stateSeq,"inputSeq":row.inputSeq,
                "maxDepth":row.maxDepth,"maxNodes":row.maxNodes,
                "attachedAt":row.attached,"snapshot":snapshot]
    }
    func snapshot(_ request:[String:Any]) throws -> [String:Any] {
        try trusted()
        let id=string(request["semanticSessionId"])
        guard var session=sessions[id] else {throw RemoteError.invalid("semantic_session_missing")}
        session.stateSeq+=1
        let result=tree(&session)
        session.nodeSignatures=axSignatures(result)
        session.lastPolledAt=timestamp()
        sessions[id]=session
        return ["semanticSessionId":id,"epoch":session.epoch,
                "stateSeq":session.stateSeq,"inputSeq":session.inputSeq,"scope":session.scope,
                "rootHwnd":0,"rootTitle":result["rootTitle"] ?? "","rootEpoch":1,
                "resyncRecommended":true,"snapshot":result]
    }
    func events(_ request:[String:Any]) throws -> [String:Any] {
        try trusted()
        let id=string(request["semanticSessionId"])
        guard var session=sessions[id] else {throw RemoteError.invalid("semantic_session_missing")}
        if session.scope == "foreground" {
            guard try frontmostPid() == session.pid else {
                throw RemoteError.invalid("semantic_foreground_changed")
            }
        }
        let now=timestamp()
        if now-session.lastPolledAt>=250 {
            let snapshot=tree(&session)
            updateJournal(&session,snapshot)
            session.lastPolledAt=now
        }
        let after=Int64(max(0,integer(request["afterSeq"],0)))
        let limit=clamp(integer(request["limit"],100),1,200)
        let available=session.eventJournal.filter {
            ($0["stateSeq"] as? Int64 ?? 0)>after
        }
        let selected=Array(available.prefix(limit))
        let gap=after<session.droppedBeforeSeq
        let truncated=selected.contains {$0["truncated"] as? Bool ?? false}
        sessions[id]=session
        return ["semanticSessionId":id,"epoch":session.epoch,"stateSeq":session.stateSeq,
                "inputSeq":session.inputSeq,"afterSeq":after,
                "gap":gap,"droppedBeforeSeq":session.droppedBeforeSeq,
                "events":selected,"hasMore":available.count>selected.count,
                "scope":session.scope,"resyncRecommended":gap || truncated,
                "journalMode":"poll-diff"]
    }
    func detach(_ request:[String:Any]) throws -> [String:Any] {
        let id=string(request["semanticSessionId"])
        guard sessions.removeValue(forKey:id) != nil else {throw RemoteError.invalid("semantic_session_missing")}
        return ["semanticSessionId":id,"detached":true]
    }
    func act(_ request:[String:Any]) throws -> [String:Any] {
        try trusted()
        let id=string(request["semanticSessionId"]),nodeId=string(request["nodeId"])
        guard var session=sessions[id],let element=session.nodes[nodeId] else {
            throw RemoteError.invalid("semantic_node_stale_or_not_found")
        }
        let action=string(request["action"]).lowercased()
        // Session must still own the foreground before touching an AX target.
        if session.scope == "foreground" {
            guard try frontmostPid() == session.pid else {throw RemoteError.invalid("semantic_foreground_changed")}
        }
        guard !axString(element,kAXRoleAttribute).localizedCaseInsensitiveContains("secure") else {
            throw RemoteError.invalid("semantic_secure_element_denied")
        }
        let cursorMoved=visualizeRobotSemanticTarget(element,foregroundPid:session.pid)
        let result:AXError
        switch action {
        case "invoke","click":result=AXUIElementPerformAction(element,kAXPressAction as CFString)
        case "focus":
            result=AXUIElementSetAttributeValue(element,kAXFocusedAttribute as CFString,kCFBooleanTrue)
        case "value":
            let value=string(request["value"])
            guard value.utf16.count<=4096 else {throw RemoteError.invalid("semantic_value_too_long")}
            result=AXUIElementSetAttributeValue(element,kAXValueAttribute as CFString,value as CFString)
        default:throw RemoteError.invalid("macos_semantic_action_unsupported")
        }
        guard result == .success else {throw RemoteError.invalid("macos_semantic_action_failed_"+String(result.rawValue))}
        session.inputSeq+=1
        session.stateSeq+=1
        // Record action metadata only, NEVER its text input value.
        session.eventJournal.append([
            "type":"ax.action","stateSeq":session.stateSeq,
            "inputSeq":session.inputSeq,"nodeId":nodeId,
            "action":action,"at":timestamp()
        ])
        if session.eventJournal.count>100 {
            let extra=session.eventJournal.count-100
            let evicted=session.eventJournal[extra-1]
            session.droppedBeforeSeq=evicted["stateSeq"] as? Int64 ?? session.droppedBeforeSeq
            session.eventJournal.removeFirst(extra)
        }
        sessions[id]=session
        return ["applied":true,"nodeId":nodeId,"action":action,"cursorMoved":cursorMoved,
                "semanticSessionId":id,"inputSeq":session.inputSeq]
    }
}
