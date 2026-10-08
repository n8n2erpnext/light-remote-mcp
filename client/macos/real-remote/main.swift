import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Darwin

// Experimental macOS Real Remote V2 companion.
// The published macOS agent stays fail-closed until a user explicitly opts in.
enum RemoteError: Error {
    case invalid(String)
    var message: String { switch self { case .invalid(let s): return s } }
}
func integer(_ value: Any?, _ fallback: Int) -> Int {
    if let n = value as? NSNumber { return n.intValue }
    return fallback
}
func string(_ value: Any?, _ fallback: String = "") -> String {
    return value as? String ?? fallback
}
func clamp(_ number: Int, _ low: Int, _ high: Int) -> Int { return max(low, min(high, number)) }
func timestamp() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
func hash(_ data: Data) -> String {
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
func screenAllowed() -> Bool { return CGPreflightScreenCaptureAccess() }
func accessibilityAllowed() -> Bool { return AXIsProcessTrusted() }
func displays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    var items = [CGDirectDisplayID](repeating: 0, count: 32)
    guard CGGetOnlineDisplayList(32, &items, &count) == .success else { return [] }
    return Array(items.prefix(Int(count)))
}
func topology() -> [String: Any] {
    let items = displays()
    let screens: [[String:Any]] = items.enumerated().map { index, id in
        let b = CGDisplayBounds(id)
        return ["index":index, "displayId":Int(id), "primary":id == CGMainDisplayID(),
                "bounds":["x":Int(b.origin.x),"y":Int(b.origin.y),
                          "width":Int(b.width),"height":Int(b.height)]]
    }
    let text = items.map { id in
        let b=CGDisplayBounds(id)
        return "\(id):\(b.origin.x),\(b.origin.y),\(b.width),\(b.height)"
    }.joined(separator:";")
    return ["displayTopologyId":hash(Data(text.utf8)), "screens":screens, "screenCount":screens.count]
}
func windowList(_ limit: Int) -> [[String: Any]] {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] else { return [] }
    return Array(info.prefix(clamp(limit, 1, 250))).map { row in
        ["title":string(row[kCGWindowName as String]),"owner":string(row[kCGWindowOwnerName as String]),
         "processId":integer(row[kCGWindowOwnerPID as String],0),
         "windowId":integer(row[kCGWindowNumber as String],0),
         "bounds":row[kCGWindowBounds as String] ?? [:]]
    }
}
func snapshot(_ request: [String:Any]) throws -> [String:Any] {
    guard screenAllowed() else { throw RemoteError.invalid("macos_screen_recording_permission_required") }
    let items = displays()
    let index = integer(request["screen"],0)
    guard index >= 0 && index < items.count else { throw RemoteError.invalid("visual_screen_invalid") }
    let id = items[index]
    guard let source = CGDisplayCreateImage(id) else { throw RemoteError.invalid("macos_screen_capture_failed") }
    let maxWidth = clamp(integer(request["maxWidth"],960),160,1280)
    let maxHeight = clamp(integer(request["maxHeight"],540),90,720)
    let quality = clamp(integer(request["quality"],50),25,70)
    let scale = min(1.0,min(Double(maxWidth)/Double(source.width),Double(maxHeight)/Double(source.height)))
    let outWidth = max(1,Int(Double(source.width)*scale))
    let outHeight = max(1,Int(Double(source.height)*scale))
    let image = NSImage(size:NSSize(width:outWidth,height:outHeight))
    image.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    NSBitmapImageRep(cgImage:source).draw(in:NSRect(x:0,y:0,width:outWidth,height:outHeight))
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data:tiff),
          let jpeg = rep.representation(using:.jpeg,properties:[.compressionFactor:NSNumber(value:Double(quality)/100.0)]) else {
        throw RemoteError.invalid("macos_jpeg_encoding_failed")
    }
    guard jpeg.count <= 700 * 1024 else { throw RemoteError.invalid("macos_frame_too_large") }
    let b = CGDisplayBounds(id)
    return ["screen":index,
            "bounds":["x":Int(b.origin.x),"y":Int(b.origin.y),"width":Int(b.width),"height":Int(b.height)],
            "frame":["width":outWidth,"height":outHeight,"quality":quality],
            "displayTopologyId":topology()["displayTopologyId"] ?? "",
            "frameSha256":hash(jpeg), "dataBytes":jpeg.count,
            "mime":"image/jpeg", "data":jpeg.base64EncodedString(),
            "inputMapping":["xOffset":b.origin.x,"yOffset":b.origin.y,
                            "xScale":Double(b.width)/Double(outWidth),"yScale":Double(b.height)/Double(outHeight)]]
}
func coordinate(_ action: [String:Any], _ x: String = "x", _ y: String = "y", _ screenKey: String = "screen") throws -> CGPoint {
    let screen = integer(action[screenKey],integer(action["screen"],0)), all = displays()
    guard screen >= 0 && screen < all.count else { throw RemoteError.invalid("screen_invalid") }
    guard let px=action[x] as? NSNumber,let py=action[y] as? NSNumber else { throw RemoteError.invalid("coordinates_required") }
    let b=CGDisplayBounds(all[screen]), rx=px.doubleValue,ry=py.doubleValue
    guard rx >= 0 && ry >= 0 && rx < b.width && ry < b.height else { throw RemoteError.invalid("coordinates_out_of_bounds") }
    return CGPoint(x:b.origin.x+rx,y:b.origin.y+ry)
}
func postMouse(_ kind: CGEventType,_ point: CGPoint,_ button: CGMouseButton = .left) throws {
    guard let e=CGEvent(mouseEventSource:nil,mouseType:kind,mouseCursorPosition:point,mouseButton:button)
    else { throw RemoteError.invalid("macos_cgevent_unavailable") }
    e.post(tap:.cghidEventTap)
}
func keyCode(_ name: String) -> CGKeyCode? {
    let names: [String:CGKeyCode] = ["enter":36,"return":36,"tab":48,"space":49,"escape":53,
        "backspace":51,"delete":51,"left":123,"right":124,"down":125,"up":126,
        "a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,
        "b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,
        "3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29,
        "o":31,"u":32,"i":34,"p":35,"l":37,"j":38,"k":40,"n":45,"m":46]
    return names[name.lowercased()]
}
func inputAction(_ action:[String:Any]) throws -> [String:Any] {
    guard accessibilityAllowed() else { throw RemoteError.invalid("macos_accessibility_permission_required") }
    let op=string(action["op"])
    if let guardTitle=action["guardTitleContains"] as? String, !guardTitle.isEmpty {
        let foreground=NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
        guard foreground.localizedCaseInsensitiveContains(guardTitle) else { throw RemoteError.invalid("desktop_guard_title_mismatch") }
    }
    switch op {
    case "cursor.move":
        try glideRobotCursor(to:coordinate(action),steps:integer(action["steps"],12),durationMs:integer(action["durationMs"],170))
    case "cursor.click":
        let point=CGEvent(source:nil)?.location ?? .zero
        let button=string(action["button"],"left")
        let right=button == "right"
        let count=clamp(integer(action["count"],1),1,3)
        for _ in 0..<count {
            try postMouse(right ? .rightMouseDown : .leftMouseDown,point,right ? .right : .left)
            try postMouse(right ? .rightMouseUp : .leftMouseUp,point,right ? .right : .left)
        }
    case "cursor.wheel":
        let delta=Int32(clamp(integer(action["delta"],0),-1000,1000))
        guard let e=CGEvent(scrollWheelEvent2Source:nil,units:.line,wheelCount:1,wheel1:delta,wheel2:0,wheel3:0)
        else { throw RemoteError.invalid("macos_scroll_event_unavailable") }
        e.post(tap:.cghidEventTap)
    case "cursor.drag":
        let start=try coordinate(action,"fromX","fromY"),end=try coordinate(action,"toX","toY","toScreen")
        let steps=try dragRobotCursor(from:start,to:end,
            requestedSteps:integer(action["steps"],16),
            requestedDurationMs:integer(action["durationMs"],350))
        return ["applied":true,"op":op,"dragSteps":steps,"dragTimed":true]
    case "key.press","key.hotkey":
        let name=string(action["key"])
        guard let key=keyCode(name) else { throw RemoteError.invalid("macos_key_unsupported") }
        let mods=(action["modifiers"] as? [String] ?? []).map { $0.lowercased() }
        var flags:CGEventFlags = []
        if mods.contains("command") || mods.contains("cmd") || mods.contains("meta") { flags.insert(.maskCommand) }
        if mods.contains("ctrl") || mods.contains("control") { flags.insert(.maskControl) }
        if mods.contains("shift") { flags.insert(.maskShift) }
        if mods.contains("alt") || mods.contains("option") { flags.insert(.maskAlternate) }
        for down in [true,false] {
            guard let event=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:down) else { throw RemoteError.invalid("macos_key_event_unavailable") }
            event.flags=flags;event.post(tap:.cghidEventTap)
        }
    case "text.write":
        let value=string(action["text"]);guard value.utf16.count <= 4096 else { throw RemoteError.invalid("macos_text_too_long") }
        if try writeFocusedEmptyTextByAX(value) {
            return ["applied":true,"op":op,"textMethod":"ax-verified"]
        }
        // macOS GUI text fields may retain ONLY the final scalar when a whole
        // string is posted as one synthetic CGEvent. Send a key pair per scalar;
        // preserve surrogate pairs (e.g. emoji) inside one event.
        for scalar in value.unicodeScalars {
            var units=Array(String(scalar).utf16)
            for down in [true,false] {
                guard let event=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down) else { throw RemoteError.invalid("macos_text_event_unavailable") }
                event.keyboardSetUnicodeString(stringLength:units.count,unicodeString:&units)
                event.post(tap:.cghidEventTap)
            }
            usleep(1200)
        }
        return ["applied":true,"op":op,"textMethod":"cgevent-unverified"]
    default:throw RemoteError.invalid("macos_input_operation_unsupported")
    }
    return ["applied":true,"op":op]
}
struct VisualLease {
    let id:String
    let token:String
    let epoch:String
    let owner:String
    let topology:String
    let screen:Int
    let width:Int
    let height:Int
    let quality:Int
    let created:Int64
    var seq:Int=0
    var leaseMs:Int=30000
    var expires:Int64
}
final class Helper {
    private var sessions:[String:VisualLease]=[:]
    private let semantic=SemanticEngine()
    private let cursorOverlay=RobotCursorOverlayController()
    private let started=timestamp()
    deinit { cursorOverlay.hide() }
    func dispatch(_ request:[String:Any]) throws -> Any {
        let op=string(request["op"])
        switch op {
        case "ping": return ["pong":true,"pid":Int(getpid())]
        case "status","desktop.status":
            return ["runtime":"real-remote-v2-macos","pid":Int(getpid()),"uptimeMs":timestamp()-started,
                    "screenRecording":screenAllowed(),"accessibility":accessibilityAllowed(),
                    "topology":topology(),"visualSessions":sessions.count,"cursorOverlayActive":cursorOverlay.active]
        case "desktop.windows":return windowList(integer(request["maxWindows"],100))
        case "desktop.frame":return try snapshot(request)
        case "desktop.input","desktop.run":
            if op == "desktop.run", !string(request["nodeId"]).isEmpty {
                return try semantic.act(request)
            }
            let events=request["actions"] as? [[String:Any]] ?? []
            guard !events.isEmpty && events.count<=64 else {throw RemoteError.invalid("macos_actions_required")}
            if let expected=request["displayTopologyId"] as? String {
                guard expected == topology()["displayTopologyId"] as? String else {throw RemoteError.invalid("display_topology_mismatch")}
            }
            return ["applied":true,"results":try events.map { try inputAction($0) }]
        case "desktop.visual.attach":
            guard screenAllowed() else {throw RemoteError.invalid("macos_screen_recording_permission_required")}
            sessions=sessions.filter{$0.value.expires>timestamp()}
            guard sessions.count<4 else {throw RemoteError.invalid("visual_session_limit")}
            let index=integer(request["screen"],0),all=displays()
            guard index>=0 && index<all.count else {throw RemoteError.invalid("visual_screen_invalid")}
            let id="vis_"+UUID().uuidString.replacingOccurrences(of:"-",with:"")
            let ms=clamp(integer(request["leaseMs"],30000),1000,900000)
            let now=timestamp()
            let lease=VisualLease(id:id,token:"vlease_"+UUID().uuidString,epoch:"vepoch_"+UUID().uuidString,
                owner:string(request["owner"]),topology:string(topology()["displayTopologyId"]),screen:index,
                width:clamp(integer(request["maxWidth"],960),160,1280),
                height:clamp(integer(request["maxHeight"],540),90,720),
                quality:clamp(integer(request["quality"],50),25,70),
                created:now,leaseMs:ms,expires:now+Int64(ms))
            sessions[id]=lease
            let indicator=cursorOverlay.show(expiresAt:lease.expires)
            return ["cursorOverlayActive":indicator,"visualSessionId":lease.id,"leaseToken":lease.token,"epoch":lease.epoch,
                    "displayTopologyId":lease.topology,"screen":index,"frameSeq":0,
                    "maxWidth":lease.width,"maxHeight":lease.height,"quality":lease.quality,
                    "expiresAt":lease.expires,"leaseMs":lease.leaseMs,"attachedAt":now,"owner":lease.owner]
        case "desktop.visual.frame","desktop.visual.resume","desktop.visual.keepalive","desktop.visual.detach":
            let id=string(request["visualSessionId"]), token=string(request["leaseToken"])
            guard var row=sessions[id],row.expires>timestamp() else {throw RemoteError.invalid("visual_session_missing_or_expired")}
            guard !token.isEmpty && row.token == token else {throw RemoteError.invalid("visual_lease_invalid")}
            guard row.topology == topology()["displayTopologyId"] as? String else {throw RemoteError.invalid("visual_topology_changed")}
            if op == "desktop.visual.detach" {
                sessions.removeValue(forKey:id)
                if !sessions.values.contains(where:{$0.expires>timestamp()}) && semantic.activeSessionCount==0 {cursorOverlay.hide()}
                return ["visualSessionId":id,"detached":true,"finalFrameSeq":row.seq,"displayTopologyId":row.topology,"epoch":row.epoch]
            }
            row.expires=timestamp()+Int64(row.leaseMs);sessions[id]=row
            _=cursorOverlay.show(expiresAt:row.expires)
            if op != "desktop.visual.frame" {
                return ["visualSessionId":id,"expiresAt":row.expires,"frameSeq":row.seq,"resumed":op == "desktop.visual.resume"]
            }
            row.seq += 1;sessions[id]=row
            return ["visualSessionId":id,"epoch":row.epoch,"displayTopologyId":row.topology,
                    "frameSeq":row.seq,"expiresAt":row.expires,
                    "frame":try snapshot(["screen":row.screen,"maxWidth":row.width,"maxHeight":row.height,"quality":row.quality])]
        case "desktop.semantic.attach":
            let result=try semantic.attach(request)
            _=cursorOverlay.show(expiresAt:timestamp()+120000)
            return result
        case "desktop.semantic.snapshot":
            let result=try semantic.snapshot(request)
            _=cursorOverlay.show(expiresAt:timestamp()+120000)
            return result
        case "desktop.semantic.events":return try semantic.events(request)
        case "desktop.semantic.detach":
            let result=try semantic.detach(request)
            if semantic.activeSessionCount==0 && !sessions.values.contains(where:{$0.expires>timestamp()}) {
                cursorOverlay.hide()
            }
            return result
        case "desktop.semantic.act":
            let result=try semantic.act(request)
            _=cursorOverlay.show(expiresAt:timestamp()+120000)
            return result
        case "desktop.browser.attach","desktop.browser.snapshot","desktop.browser.events","desktop.browser.detach":
            throw RemoteError.invalid("macos_browser_cdp_backend_not_yet_implemented")
        default:throw RemoteError.invalid("macos_operation_not_supported")
        }
    }
}
func send(_ fd:Int32,_ value:[String:Any]) {
    guard let payload=try? JSONSerialization.data(withJSONObject:value,options:[.fragmentsAllowed]) else {return}
    var bytes=[UInt8](payload);bytes.append(10)
    bytes.withUnsafeBytes { raw in
        var sent=0
        while sent<raw.count {
            let result=Darwin.write(fd,raw.baseAddress!.advanced(by:sent),raw.count-sent)
            if result<=0{return}
            sent+=result
        }
    }
}
func serve(_ fd:Int32) {
    let helper=Helper()
    send(fd,["type":"event","eventName":"robot.ready","at":timestamp(),"pid":Int(getpid())])
    var pending=[UInt8]()
    var incoming=[UInt8](repeating:0,count:8192)
    while true {
        let n=Darwin.read(fd,&incoming,incoming.count)
        if n<=0 {break}
        pending.append(contentsOf:incoming.prefix(n))
        if pending.count>8*1024*1024 {break}
        while let idx=pending.firstIndex(of:10) {
            let line=Data(pending[..<idx])
            pending.removeFirst(idx+1)
            guard let raw=(try? JSONSerialization.jsonObject(with:line)) as? [String:Any] else {continue}
            let id=string(raw["id"])
            guard !id.isEmpty else {continue}
            do {
                let data=try helper.dispatch(raw)
                send(fd,["type":"response","id":id,"ok":true,"data":data])
            } catch {
                let message=(error as? RemoteError)?.message ?? String(describing:error)
                send(fd,["type":"response","id":id,"ok":false,"error":message])
            }
        }
    }
}
func run() throws {
    let args=CommandLine.arguments
    // Only an explicit owner-launched command requests a TCC system prompt.
    // Never request screen permission from --self-test, status or a remote job.
    if args.contains("--cursor-overlay") {
        try runRobotCursorOverlay(args:args)
        return
    }
    if args.contains("--request-screen-recording") {
        let granted=CGRequestScreenCaptureAccess()
        let value:[String:Any]=["ok":granted,"permission":"screenRecording",
                               "ownerActionRequired":!granted]
        let data=try JSONSerialization.data(withJSONObject:value)
        FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10]))
        return
    }
    // Owner-initiated opt-in only. The system prompt is asynchronous and the
    // result is the current trust state, not a promise that consent was granted.
    // Normal remote operations and --self-test never request TCC permission.
    if args.contains("--request-accessibility") {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        let value:[String:Any]=["ok":true,"permission":"accessibility",
                               "trusted":trusted,"promptRequested":!trusted,
                               "ownerActionRequired":!trusted]
        let data=try JSONSerialization.data(withJSONObject:value)
        FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10]))
        return
    }
    if args.contains("--self-test") {
        let value:[String:Any]=["ok":true,"runtime":"real-remote-v2-macos","arch":"darwin",
                               "screenRecording":screenAllowed(),"accessibility":accessibilityAllowed()]
        let data=try JSONSerialization.data(withJSONObject:value)
        FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10]))
        return
    }
    guard let index=args.firstIndex(of:"--socket"),index+1<args.count else {throw RemoteError.invalid("socket_path_required")}
    let address=args[index+1]
    // No external listening ports; random short name, owner-only UNIX socket.
    guard address.hasPrefix("/tmp/lightremote-rmv2-") && address.hasSuffix(".sock") &&
          address.utf8.count<100 && !address.contains("..") else {throw RemoteError.invalid("socket_path_invalid")}
    let fd=Darwin.socket(AF_UNIX,SOCK_STREAM,0)
    guard fd>=0 else {throw RemoteError.invalid("socket_create_failed")}
    defer { Darwin.close(fd);unlink(address) }
    var sock=sockaddr_un()
    sock.sun_family=sa_family_t(AF_UNIX)
    sock.sun_len=UInt8(MemoryLayout<sockaddr_un>.size)
    address.withCString { pointer in
        withUnsafeMutablePointer(to:&sock.sun_path) { tuple in
            tuple.withMemoryRebound(to:CChar.self,capacity:104) { strlcpy($0,pointer,104) }
        }
    }
    let ok=withUnsafePointer(to:&sock) { ptr in
        ptr.withMemoryRebound(to:sockaddr.self,capacity:1) { Darwin.bind(fd,$0,socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard ok==0 else {throw RemoteError.invalid("socket_bind_failed")}
    chmod(address,0o600)
    guard Darwin.listen(fd,1)==0 else {throw RemoteError.invalid("socket_listen_failed")}
    let peer=Darwin.accept(fd,nil,nil)
    guard peer>=0 else {throw RemoteError.invalid("socket_accept_failed")}
    defer { Darwin.close(peer) }
    serve(peer)
}
do {try run()} catch {
    fputs("macos_real_remote_error: "+String(describing:error)+"\n",stderr)
    exit(1)
}
