import Cocoa

enum TrayVisualState { case unavailable, unlinked, dormant, connected }

final class TrayDelegate: NSObject, NSApplicationDelegate {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let stateItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let accountItem = NSMenuItem(title: "Sign in / Link device…", action: #selector(accountAction), keyEquivalent: "")
    let connectItem = NSMenuItem(title: "Connect", action: #selector(toggleConnection), keyEquivalent: "")
    var timer: Timer?
    var onboardingInFlight = false
    var enrollmentPollInFlight = false
    let onboardingKey = "LightRemoteDidPresentAccountOnboarding"
    let root = ProcessInfo.processInfo.environment["LIGHT_REMOTE_ROOT"] ?? "/Library/Application Support/Light Remote"
    let accountPortal = "https://light-remote-mcp.vercel.app/"
    var node: String { root + "/current/runtime/node" }
    var agent: String { root + "/current/device-agent/operator-agent.mjs" }
    var brandIcon: String { root + "/current/assets/branding/light-remote-mark-256.png" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = statusItem.button { button.imagePosition = .imageOnly; button.title = ""; button.toolTip = "Light Remote" }
        let menu = NSMenu(); stateItem.isEnabled = false
        menu.addItem(stateItem); menu.addItem(.separator()); menu.addItem(accountItem)
        menu.addItem(NSMenuItem(title: "Open Local Wall", action: #selector(openWall), keyEquivalent: "")); menu.addItem(connectItem)
        menu.addItem(NSMenuItem(title: "Restart Light Remote", action: #selector(restartAgent), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Check for updates", action: #selector(checkUpdates), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Stop Light Remote", action: #selector(stopAgent), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Uninstall Light Remote…", action: #selector(uninstallLightRemote), keyEquivalent: ""))
        menu.addItem(.separator()); menu.addItem(NSMenuItem(title: "Quit tray", action: #selector(quitTray), keyEquivalent: ""))
        for item in menu.items { item.target = self }; statusItem.menu = menu
        refresh(); timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func run(_ launch: String, _ args: [String]) -> (Int32, String, String) {
        let p = Process(); p.executableURL = URL(fileURLWithPath: launch); p.arguments = args
        let o = Pipe(), e = Pipe(); p.standardOutput = o; p.standardError = e
        do { try p.run(); p.waitUntilExit() } catch { return (-1, "", error.localizedDescription) }
        return (p.terminationStatus,
                String(data: o.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
                String(data: e.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
    }
    func agentRun(_ args: [String]) -> (Int32, String, String) { run(node, [agent] + args) }
    func status() -> [String: Any] {
        let r = agentRun(["status"])
        guard r.0 == 0, let d = r.1.data(using: .utf8),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return ["error": r.2] }
        return j
    }
    func lineValue(_ text: String, prefix: String) -> String? {
        text.split(separator: "\n").map(String.init).first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces) }
    }

    func trayIcon(_ visual: TrayVisualState) -> NSImage? {
        guard let base = NSImage(contentsOfFile: brandIcon) else { return nil }
        let size = NSSize(width: 18, height: 18), image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus(); base.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1)
        let color: NSColor
        switch visual {
        case .connected: color = .systemGreen
        case .dormant: color = .systemOrange
        case .unlinked: color = .systemGray
        case .unavailable: color = .systemRed
        }
        let dot = NSBezierPath(ovalIn: NSRect(x: 11, y: 0.5, width: 6.5, height: 6.5))
        NSColor.black.withAlphaComponent(0.9).setStroke(); color.setFill(); dot.lineWidth = 1.1; dot.fill(); dot.stroke()
        image.unlockFocus(); image.isTemplate = false; return image
    }
    func setVisual(_ visual: TrayVisualState, label: String) {
        if let button = statusItem.button { button.image = trayIcon(visual); button.toolTip = "Light Remote — \(label)" }
    }
    func showAlert(_ title: String, _ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.addButton(withTitle: "OK"); alert.runModal()
    }
    func restartAgentNow() {
        let label = "gui/\(getuid())/com.lightremote.agent"
        _ = run("/bin/launchctl", ["enable", label]); _ = run("/bin/launchctl", ["kickstart", "-k", label])
    }

    @objc func accountAction() {
        let s = status(), enrolled = (s["enrolled"] as? Bool) ?? false
        if enrolled { if let url = URL(string: accountPortal) { NSWorkspace.shared.open(url) }; return }
        beginAccountOnboarding(force: true)
    }
    func beginAccountOnboarding(force: Bool = false) {
        if onboardingInFlight { return }
        if !force {
            let defaults = UserDefaults.standard
            if defaults.bool(forKey: onboardingKey) { return }
            defaults.set(true, forKey: onboardingKey)
        }
        onboardingInFlight = true; accountItem.isEnabled = false
        DispatchQueue.global().async {
            let result = self.agentRun(["login", "--no-wait"])
            let activation = self.lineValue(result.1, prefix: "Activation URL:")
            let code = self.lineValue(result.1, prefix: "Device code:")
            DispatchQueue.main.async {
                self.onboardingInFlight = false; self.accountItem.isEnabled = true
                guard result.0 == 0, let activation, let code, let url = URL(string: activation) else {
                    self.showAlert("Light Remote sign-in", result.2.isEmpty ? "Unable to start device enrollment." : result.2)
                    return
                }
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string)
                self.showAlert("Sign in to Light Remote", "Your one-time device code is \(code). It has been copied. Sign in in the browser, review permissions, then approve this Mac.")
                NSWorkspace.shared.open(url); self.refresh()
            }
        }
    }

    func pollEnrollmentIfNeeded(_ pendingId: String?) {
        guard pendingId != nil, !enrollmentPollInFlight else { return }
        enrollmentPollInFlight = true
        DispatchQueue.global().async {
            let result = self.agentRun(["poll"])
            var state = ""
            if result.0 == 0, let data = result.1.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { state = (json["state"] as? String) ?? "" }
            if state == "approved" { self.restartAgentNow() }
            DispatchQueue.main.asyncAfter(deadline: .now() + (state == "approved" ? 1.0 : 0.0)) {
                self.enrollmentPollInFlight = false
                if state == "approved" { self.showAlert("Device approved", "This Mac is now linked. Local Wall account protection has been activated."); self.openWall() }
                self.refresh()
            }
        }
    }

    func refresh() {
        let s = status(), available = s["error"] == nil
        let enrolled = (s["enrolled"] as? Bool) ?? false
        let pendingId = s["pendingEnrollmentId"] as? String
        let desired = (s["cloudDesiredConnected"] as? Bool) ?? false
        let cloud = (s["cloudState"] as? String) ?? "dormant", connected = desired && cloud == "connected"
        let plan = ((s["connectionPlan"] as? String) ?? "").uppercased()
        let label = !available ? "Status unavailable" : !enrolled ? (pendingId == nil ? "Sign in required · not linked" : "Waiting for account approval") : connected ? "Connected" + (plan.isEmpty ? "" : " · \(plan)") : "Running · dormant"
        let visual: TrayVisualState = !available ? .unavailable : !enrolled ? .unlinked : connected ? .connected : .dormant
        stateItem.title = label; connectItem.title = connected ? "Disconnect" : "Connect"; connectItem.isEnabled = enrolled
        accountItem.title = enrolled ? "Account / Logout…" : pendingId == nil ? "Sign in / Link device…" : "Sign in / Approve device…"
        accountItem.isEnabled = !onboardingInFlight
        setVisual(visual, label: label)
        if available && !enrolled && pendingId == nil { beginAccountOnboarding() }
        if available && !enrolled { pollEnrollmentIfNeeded(pendingId) }
    }

    @objc func openWall() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:5491/")!) }
    @objc func toggleConnection() {
        let s = status(), connected = ((s["cloudDesiredConnected"] as? Bool) ?? false) && ((s["cloudState"] as? String) == "connected")
        DispatchQueue.global().async { _ = self.agentRun([connected ? "disconnect" : "connect"]); DispatchQueue.main.async { self.refresh() } }
    }
    func launchctl(_ args: [String]) {
        DispatchQueue.global().async { _ = self.run("/bin/launchctl", args); DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.refresh() } }
    }
    @objc func restartAgent() {
        let uid = getuid(); launchctl(["enable", "gui/\(uid)/com.lightremote.agent"]); launchctl(["kickstart", "-k", "gui/\(uid)/com.lightremote.agent"])
    }
    @objc func stopAgent() {
        let uid = getuid(); launchctl(["disable", "gui/\(uid)/com.lightremote.agent"]); launchctl(["kill", "SIGTERM", "gui/\(uid)/com.lightremote.agent"])
    }
    @objc func checkUpdates() {
        let script = "do shell script \"/bin/launchctl kickstart -k system/com.lightremote.updater\" with administrator privileges"
        _ = run("/usr/bin/osascript", ["-e", script])
    }
    @objc func uninstallLightRemote() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert(); alert.messageText = "Uninstall Light Remote?"
        alert.informativeText = "This removes the app, Agent, Local Wall, updater and system launch entries. Device identity is preserved for a safe reinstall."
        alert.addButton(withTitle: "Uninstall"); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let command = "/bin/bash '/Applications/Light Remote.app/Contents/Resources/uninstall.sh' --from-tray"
        let script = "do shell script \"\(command)\" with administrator privileges"
        DispatchQueue.global().async {
            let result = self.run("/usr/bin/osascript", ["-e", script])
            DispatchQueue.main.async {
                if result.0 != 0 { self.showAlert("Uninstall failed", result.2.isEmpty ? result.1 : result.2); return }
                self.timer?.invalidate(); self.statusItem.isVisible = false; NSApp.terminate(nil)
            }
        }
    }

    @objc func quitTray() { timer?.invalidate(); statusItem.isVisible = false; NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = TrayDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
