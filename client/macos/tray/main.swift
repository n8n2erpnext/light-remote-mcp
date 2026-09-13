import Cocoa

final class TrayDelegate: NSObject, NSApplicationDelegate {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let stateItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let connectItem = NSMenuItem(title: "Connect", action: #selector(toggleConnection), keyEquivalent: "")
    var timer: Timer?
    let root = ProcessInfo.processInfo.environment["LIGHT_REMOTE_ROOT"] ?? "/Library/Application Support/Light Remote"
    var node: String { root + "/current/runtime/node" }
    var agent: String { root + "/current/device-agent/operator-agent.mjs" }
    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = statusItem.button { button.title = "LR"; button.toolTip = "Light Remote" }
        let menu = NSMenu(); stateItem.isEnabled = false; menu.addItem(stateItem); menu.addItem(.separator())
        menu.addItem(NSMenuItem(title:"Open Local Wall",action:#selector(openWall),keyEquivalent:"")); menu.addItem(connectItem)
        menu.addItem(NSMenuItem(title:"Restart Light Remote",action:#selector(restartAgent),keyEquivalent:"")); menu.addItem(NSMenuItem(title:"Check for updates",action:#selector(checkUpdates),keyEquivalent:"")); menu.addItem(NSMenuItem(title:"Stop Light Remote",action:#selector(stopAgent),keyEquivalent:"")); menu.addItem(.separator()); menu.addItem(NSMenuItem(title:"Quit tray",action:#selector(quitTray),keyEquivalent:""))
        for item in menu.items { item.target = self }; statusItem.menu = menu; refresh(); timer = Timer.scheduledTimer(withTimeInterval:5,repeats:true){[weak self]_ in self?.refresh()}
    }
    func run(_ launch:String,_ args:[String])->(Int32,String,String){let p=Process();p.executableURL=URL(fileURLWithPath:launch);p.arguments=args;let o=Pipe(),e=Pipe();p.standardOutput=o;p.standardError=e;do{try p.run();p.waitUntilExit()}catch{return(-1,"",error.localizedDescription)};return(p.terminationStatus,String(data:o.fileHandleForReading.readDataToEndOfFile(),encoding:.utf8) ?? "",String(data:e.fileHandleForReading.readDataToEndOfFile(),encoding:.utf8) ?? "")}
    func agentRun(_ args:[String])->(Int32,String,String){run(node,[agent]+args)}
    func status()->[String:Any]{let r=agentRun(["status"]);guard r.0==0,let d=r.1.data(using:.utf8),let j=try? JSONSerialization.jsonObject(with:d) as? [String:Any] else{return ["error":r.2]};return j}
    func refresh(){let s=status(),enrolled=(s["enrolled"] as? Bool) ?? false,desired=(s["cloudDesiredConnected"] as? Bool) ?? false,cloud=(s["cloudState"] as? String) ?? "dormant",connected=desired && cloud=="connected",plan=((s["connectionPlan"] as? String) ?? "").uppercased();let label=s["error"] != nil ? "Status unavailable" : !enrolled ? "Running · not linked" : connected ? "Connected"+(plan.isEmpty ? "" : " · \(plan)") : "Running · dormant";stateItem.title=label;connectItem.title=connected ? "Disconnect" : "Connect";connectItem.isEnabled=enrolled;statusItem.button?.toolTip="Light Remote — \(label)"}
    @objc func openWall(){NSWorkspace.shared.open(URL(string:"http://127.0.0.1:5491/")!)}
    @objc func toggleConnection(){let s=status(),connected=((s["cloudDesiredConnected"] as? Bool) ?? false)&&((s["cloudState"] as? String)=="connected");DispatchQueue.global().async{_ = self.agentRun([connected ? "disconnect":"connect"]);DispatchQueue.main.async{self.refresh()}}}
    func launchctl(_ args:[String]){DispatchQueue.global().async{_ = self.run("/bin/launchctl",args);DispatchQueue.main.asyncAfter(deadline:.now()+0.7){self.refresh()}}}
    @objc func restartAgent(){let uid=getuid();launchctl(["enable","gui/\(uid)/com.lightremote.agent"]);launchctl(["kickstart","-k","gui/\(uid)/com.lightremote.agent"])}
    @objc func stopAgent(){let uid=getuid();launchctl(["disable","gui/\(uid)/com.lightremote.agent"]);launchctl(["kill","SIGTERM","gui/\(uid)/com.lightremote.agent"])}
    @objc func checkUpdates(){let script="do shell script \"/bin/launchctl kickstart -k system/com.lightremote.updater\" with administrator privileges";_ = run("/usr/bin/osascript",["-e",script])}
    @objc func quitTray(){timer?.invalidate();statusItem.isVisible=false;NSApp.terminate(nil)}
}
let app=NSApplication.shared;let delegate=TrayDelegate();app.delegate=delegate;app.setActivationPolicy(.accessory);app.run()
