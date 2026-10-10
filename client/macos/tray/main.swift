import Cocoa
import UserNotifications

enum TrayVisualState { case unavailable, unlinked, dormant, connected }

final class TrayDelegate: NSObject, NSApplicationDelegate {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let stateItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let accountItem = NSMenuItem(title: "Sign in / Link device…", action: #selector(accountAction), keyEquivalent: "")
    let connectItem = NSMenuItem(title: "Connect", action: #selector(toggleConnection), keyEquivalent: "")
    let openFleetItem = NSMenuItem(title: "Open Fleet", action: #selector(openFleet), keyEquivalent: "")
    private var fleetURL: URL?
    var timer: Timer?
    let announcementReceiptKey = "LightRemoteLastAnnouncementReceipt"
    var onboardingInFlight = false
    var enrollmentPollInFlight = false
    let onboardingKey = "LightRemoteDidPresentAccountOnboarding"
    let root = ProcessInfo.processInfo.environment["LIGHT_REMOTE_ROOT"] ?? "/Library/Application Support/Light Remote"
    let accountPortal = "https://light-remote.thaiduy.digital/account"
    var node: String { root + "/current/runtime/node" }
    var agent: String { root + "/current/device-agent/operator-agent.mjs" }
    var brandIcon: String { root + "/current/assets/branding/light-remote-mark-256.png" }
    let appIcon = "/Applications/Light Remote.app/Contents/Resources/LightRemote.icns"
    // The Robot bundle is part of the main installer but keeps its own
    // macOS Screen Recording / Accessibility consent identity.
    let robotPreferencesApp = "/Applications/Light Remote.app/Contents/Helpers/Light Remote Robot.app"

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = statusItem.button { button.imagePosition = .imageOnly; button.imageScaling = .scaleProportionallyDown; button.title = ""; button.toolTip = "Light Remote" }; statusItem.isVisible = true
        let menu = NSMenu(); stateItem.isEnabled = false
        menu.addItem(stateItem); menu.addItem(.separator()); menu.addItem(accountItem)
        menu.addItem(NSMenuItem(title: "Relink this Mac…", action: #selector(relinkAccount), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Open Local Wall", action: #selector(openWall), keyEquivalent: ""))
        openFleetItem.isHidden = true
        openFleetItem.isEnabled = false
        menu.addItem(openFleetItem)
        menu.addItem(connectItem)
        menu.addItem(NSMenuItem(title: "Announcements", action: #selector(openAnnouncements), keyEquivalent: ""))
        let settings = NSMenuItem(title: "Settings", action: nil, keyEquivalent: "")
        let settingsMenu = NSMenu(title: "Settings")
        let privacy = NSMenuItem(title: "Real Remote → Privacy & Permissions…",
                                 action: #selector(openRealRemotePermissions), keyEquivalent: "")
        privacy.target = self
        settingsMenu.addItem(privacy)
        settings.submenu = settingsMenu
        menu.addItem(settings)
        menu.addItem(NSMenuItem(title: "Restart Light Remote", action: #selector(restartAgent), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Check for updates", action: #selector(checkUpdates), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Stop Light Remote", action: #selector(stopAgent), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Uninstall Light Remote…", action: #selector(uninstallLightRemote), keyEquivalent: ""))
        menu.addItem(.separator()); menu.addItem(NSMenuItem(title: "Quit tray", action: #selector(quitTray), keyEquivalent: ""))
        for item in menu.items { item.target = self }; statusItem.menu = menu
        refresh(); timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func run(_ launch: String, _ args: [String], environment: [String: String] = [:]) -> (Int32, String, String) {
        let p = Process(); p.executableURL = URL(fileURLWithPath: launch); p.arguments = args
        if !environment.isEmpty { p.environment = ProcessInfo.processInfo.environment.merging(environment) { _, replacement in replacement } }
        let o = Pipe(), e = Pipe(); p.standardOutput = o; p.standardError = e
        do { try p.run(); p.waitUntilExit() } catch { return (-1, "", error.localizedDescription) }
        return (p.terminationStatus,
                String(data: o.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
                String(data: e.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
    }
    // Open only on a deliberate owner click, never at client/agent startup.
    // LaunchServices uses Robot's stable bundle identity for Apple TCC.
    @objc func openRealRemotePermissions() {
        let binary = robotPreferencesApp + "/Contents/MacOS/LightRemoteRealRemote"
        guard FileManager.default.isExecutableFile(atPath: binary) else {
            showAlert("Real Remote permissions unavailable",
                      "The Robot companion is not installed. Update Light Remote before configuring Real Remote.")
            return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.arguments = ["--permissions-ui"]
        // Accessory Robot can survive after its Settings window is closed.
        // Reusing that headless process leaves the owner with no window.
        // Always create a fresh owner-visible Settings instance.
        config.createsNewApplicationInstance = true
        config.activates = true
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: robotPreferencesApp),
                                           configuration: config) { [weak self] _, error in
            guard let error else { return }
            DispatchQueue.main.async {
                self?.showAlert("Unable to open Real Remote settings", error.localizedDescription)
            }
        }
    }
    func agentRun(_ args: [String]) -> (Int32, String, String) {
        // Tray-launched enrollment must advertise the same packaged Robot as
        // the always-on Agent. Otherwise Relink silently loses desktop grants.
        let robotBinary = robotPreferencesApp + "/Contents/MacOS/LightRemoteRealRemote"
        let guiEnvironment: [String: String] = FileManager.default.isExecutableFile(atPath: robotBinary) ? [
            "LIGHT_REMOTE_REAL_REMOTE": "1",
            "LIGHT_REMOTE_MACOS_GUI_SIDECAR": "1",
            "LIGHT_REMOTE_MACOS_GUI_APP": robotPreferencesApp
        ] : [:]
        return run(node, [agent] + args, environment: guiEnvironment)
    }
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
        let base = NSImage(contentsOfFile: brandIcon) ?? NSImage(contentsOfFile: appIcon)
        let size = NSSize(width: 18, height: 18), image = NSImage(size: size)
        image.lockFocus()
        if let base {
            base.draw(in: NSRect(origin: .zero, size: size))
        } else {
            NSColor.black.setFill(); NSBezierPath(ovalIn: NSRect(x: 1, y: 1, width: 16, height: 16)).fill()
            let text = NSString(string: "LR")
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 7), .foregroundColor: NSColor.white]
            text.draw(at: NSPoint(x: 4, y: 5), withAttributes: attrs)
        }
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
        if let button = statusItem.button { button.image = trayIcon(visual); button.imageScaling = .scaleProportionallyDown; button.toolTip = "Light Remote — \(label)" }; statusItem.isVisible = true
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
    @objc func relinkAccount() {
        if onboardingInFlight { return }
        let s = status(), enrolled = (s["enrolled"] as? Bool) ?? false
        if !enrolled { beginAccountOnboarding(force: true); return }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Relink this Mac to another account?"
        alert.informativeText = "A new one-time device code will be issued. The existing device identity is preserved. The account link changes only after you sign in and approve this Mac in the browser."
        alert.addButton(withTitle: "Relink this Mac")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            beginAccountOnboarding(force: true, relink: true)
        }
    }
    func beginAccountOnboarding(force: Bool = false, relink: Bool = false) {
        if onboardingInFlight { return }
        if !force {
            let defaults = UserDefaults.standard
            if defaults.bool(forKey: onboardingKey) { return }
            defaults.set(true, forKey: onboardingKey)
        }
        onboardingInFlight = true; accountItem.isEnabled = false
        DispatchQueue.global().async {
            let result = relink ? self.agentRun(["login", "--reenroll", "--no-wait"]) : self.agentRun(["login", "--no-wait"])
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
        let label = !available ? "Status unavailable" : pendingId != nil ? "Waiting for account approval" : !enrolled ? "Sign in required · not linked" : connected ? "Connected" + (plan.isEmpty ? "" : " · \(plan)") : "Running · dormant"
        let visual: TrayVisualState = !available ? .unavailable : !enrolled ? .unlinked : connected ? .connected : .dormant
        stateItem.title = label; connectItem.title = connected ? "Disconnect" : "Connect"; connectItem.isEnabled = enrolled
        accountItem.title = enrolled ? "Account / Logout…" : pendingId == nil ? "Sign in / Link device…" : "Sign in / Approve device…"
        accountItem.isEnabled = !onboardingInFlight
        fleetURL = available ? healthyFleetURL(s) : nil
        openFleetItem.isHidden = fleetURL == nil
        openFleetItem.isEnabled = fleetURL != nil
        setVisual(visual, label: label)
        deliverNewAnnouncement(s)
        if available && !enrolled && pendingId == nil { beginAccountOnboarding() }
        if available && pendingId != nil { pollEnrollmentIfNeeded(pendingId) }
    }

    // Match the Windows tray: only offer Fleet while this enrolled device has a
    // healthy Fleet Wall, never merely because the account is Fleet-eligible.
    func healthyFleetURL(_ status: [String: Any]) -> URL? {
        guard (status["enrolled"] as? Bool) == true,
              let fleet = status["fleetWall"] as? [String: Any],
              (fleet["healthy"] as? Bool) == true else { return nil }
        let published = (fleet["publicUrl"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let port = (fleet["port"] as? Int).flatMap { (1024...65535).contains($0) ? $0 : nil } ?? 5492
        let target = published.isEmpty ? "http://127.0.0.1:\(port)/" : published
        guard let url = URL(string: target),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
    @objc func openAnnouncements() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:5491/announcements")!)
    }
    func deliverNewAnnouncement(_ status: [String: Any]) {
        guard let announcements=status["announcements"] as? [String: Any],
              let entries=announcements["items"] as? [[String: Any]],
              let latest=(announcements["latest"] as? [String:Any]) ?? entries.first,
              let id=latest["id"] as? String,
              let updatedAt=latest["updatedAt"] as? String else { return }
        let key=id+"|"+updatedAt
        guard UserDefaults.standard.string(forKey: announcementReceiptKey) != key else { return }
        UserDefaults.standard.set(key,forKey:announcementReceiptKey)
        let title=String((latest["title"] as? String ?? "Light Remote").prefix(110))
        let body=String((latest["message"] as? String ?? "New announcement").prefix(400))
        let center=UNUserNotificationCenter.current()
        func send() {
            let notice=UNMutableNotificationContent()
            notice.title=title;notice.body=body
            let request=UNNotificationRequest(identifier:id,content:notice,trigger:nil)
            center.add(request,withCompletionHandler:nil)
        }
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized,.provisional: send()
            case .notDetermined:
                center.requestAuthorization(options:[.alert,.badge]) { allowed,_ in if allowed { send() } }
            default: break
            }
        }
    }
    @objc func openFleet() {
        guard let url = fleetURL else { return }
        NSWorkspace.shared.open(url)
    }
    func wallReachable() -> Bool { run("/usr/bin/curl", ["-fsS", "--max-time", "1", "http://127.0.0.1:5491/"]).0 == 0 }
    @objc func openWall() {
        DispatchQueue.global().async {
            var ready = self.wallReachable()
            if !ready {
                self.restartAgentNow()
                for _ in 0..<20 {
                    if self.wallReachable() { ready = true; break }
                    Thread.sleep(forTimeInterval: 0.25)
                }
            }
            DispatchQueue.main.async {
                if ready { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:5491/")!) }
                else { self.showAlert("Local Wall unavailable", "Light Remote Agent could not restore Local Wall on 127.0.0.1:5491. Use Restart Light Remote and check the Agent service.") }
            }
        }
    }
    @objc func toggleConnection() {
        let s = status(), connected = ((s["cloudDesiredConnected"] as? Bool) ?? false) && ((s["cloudState"] as? String) == "connected")
        DispatchQueue.global().async { _ = self.agentRun([connected ? "disconnect" : "connect"]); DispatchQueue.main.async { self.refresh() } }
    }
    func launchctl(_ args: [String]) {
        DispatchQueue.global().async { _ = self.run("/bin/launchctl", args); DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.refresh() } }
    }
    @objc func restartAgent() {
        DispatchQueue.global().async { self.restartAgentNow(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.refresh() } }
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
