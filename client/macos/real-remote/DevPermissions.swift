import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import WebKit

// Local, owner-operated permission window for UNSIGNED development builds.
// Never changes macOS privacy settings; the OS owns approval decisions.
final class RobotDevPermissionsController: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var isDevelopment = true
    private var requestRow: NSStackView?
    private var screenButton: NSButton?
    private var accessibilityButton: NSButton?
    private var window: NSWindow?
    private var agentAccessWindow: NSWindow?
    private let captureState = NSTextField(labelWithString: "")
    private let axState = NSTextField(labelWithString: "")
    private let intro = NSTextField(wrappingLabelWithString:
        "This is a local development Robot, separate from Light Remote production. " +
        "Use Apple's permission dialogs below. No capture or remote actions are performed here.")
    private var refreshTimer: Timer?

    private func button(_ title:String,action:Selector)->NSButton {
        let control = NSButton(title:title,target:self,action:action)
        control.bezelStyle = .rounded
        control.translatesAutoresizingMaskIntoConstraints = false
        return control
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let app = NSApplication.shared
        // Embedded helper is a background/accessory app: no second Dock icon.
        app.setActivationPolicy(isDevelopment ? .regular : .accessory)

        let frame = NSRect(x:0,y:0,width:660,height:290)
        let win = NSWindow(contentRect:frame,
                           styleMask:[.titled,.closable,.miniaturizable],
                           backing:.buffered,defer:false)
        win.title = isDevelopment ? "Light Remote Robot — Development Permissions"
                                  : "Light Remote — Real Remote Permissions"
        if !isDevelopment {
            intro.stringValue = "Real Remote needs Apple Screen Recording and Accessibility permission. " +
                "Approval belongs to this Light Remote Robot helper. Permissions are only requested " +
                "when you press a button below; closing Settings does not change them."
        }
        win.center()
        win.isReleasedWhenClosed = false
        win.delegate = self

        let container = NSStackView()
        container.orientation = .vertical
        container.alignment = .leading
        container.distribution = .gravityAreas
        container.spacing = 13
        container.translatesAutoresizingMaskIntoConstraints = false
        intro.maximumNumberOfLines = 4
        intro.lineBreakMode = .byWordWrapping
        intro.translatesAutoresizingMaskIntoConstraints = false
        container.addArrangedSubview(intro)

        captureState.font = NSFont.monospacedSystemFont(ofSize:13,weight:.medium)
        axState.font = NSFont.monospacedSystemFont(ofSize:13,weight:.medium)
        container.addArrangedSubview(captureState)
        container.addArrangedSubview(axState)

        let screenControl = button("Request Screen Recording",action:#selector(requestScreen))
        let axControl = button("Request Accessibility",action:#selector(requestAX))
        screenButton = screenControl
        accessibilityButton = axControl
        let reqRow = NSStackView(views:[screenControl,axControl])
        reqRow.orientation = .horizontal
        reqRow.spacing = 8
        requestRow = reqRow
        container.addArrangedSubview(reqRow)

        let navRow = NSStackView(views:[
            button("Refresh Status",action:#selector(refresh)),
            button("Agent Access",action:#selector(openAgentAccess)),
            button("Open Privacy Settings",action:#selector(openPrivacy)),
            button(isDevelopment ? "Quit Dev Robot" : "Close Settings",action:#selector(quitApp))
        ])
        navRow.orientation = .horizontal
        navRow.spacing = 8
        container.addArrangedSubview(navRow)

        let content = NSView(frame:frame)
        content.addSubview(container)
        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:24),
            container.trailingAnchor.constraint(lessThanOrEqualTo:content.trailingAnchor,constant:-18),
            container.topAnchor.constraint(equalTo:content.topAnchor,constant:22),
            intro.widthAnchor.constraint(lessThanOrEqualToConstant:490)
        ])
        win.contentView = content
        window = win
        refresh(nil)
        win.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps:true)

        // Read-only refresh: updates labels, never triggers permission requests.
        refreshTimer = Timer.scheduledTimer(withTimeInterval:2.0,repeats:true){ [weak self] _ in
            self?.refresh(nil)
        }
    }

    @objc private func requestScreen(_ sender:Any?) {
        _ = CGRequestScreenCaptureAccess()
        refresh(nil)
    }
    @objc private func requestAX(_ sender:Any?) {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        refresh(nil)
    }
    @objc private func refresh(_ sender:Any?) {
        let screen = CGPreflightScreenCaptureAccess()
        let ax = AXIsProcessTrusted()
        captureState.stringValue = "Screen Recording: "+(screen ? "GRANTED" : "NOT GRANTED")
        axState.stringValue = "Accessibility:       "+(ax ? "GRANTED" : "NOT GRANTED")
        captureState.textColor = screen ? .systemGreen : .systemOrange
        axState.textColor = ax ? .systemGreen : .systemOrange
        // Owner sees plain status when both already GRANTED; no redundant
        // request controls until an Apple permission is missing.
        screenButton?.isHidden = screen
        accessibilityButton?.isHidden = ax
        requestRow?.isHidden = screen && ax
    }
    // The owner can review both Apple's TCC grants and local Agent policy
    // from Robot. WKWebView does not bypass Local Wall authentication/CSRF.
    @objc private func openAgentAccess(_ sender:Any?) {
        if let existing=agentAccessWindow, existing.isVisible {
            existing.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps:true)
            return
        }
        guard let url=URL(string:"http://127.0.0.1:5491/permissions") else { return }
        let panel=NSWindow(contentRect:NSRect(x:0,y:0,width:930,height:680),
                           styleMask:[.titled,.closable,.resizable,.miniaturizable],
                           backing:.buffered,defer:false)
        panel.title="Light Remote Robot — Agent Access"
        panel.center()
        panel.isReleasedWhenClosed=false
        let browser=WKWebView(frame:NSRect(x:0,y:0,width:930,height:680))
        browser.navigationDelegate=self
        browser.load(URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData))
        panel.contentView=browser
        agentAccessWindow=panel
        panel.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true)
    }
    // Only the owner-authenticated localhost Wall can render inside Robot.
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,
                 decisionHandler:@escaping (WKNavigationActionPolicy)->Void) {
        guard let url=navigationAction.request.url,
              url.scheme=="http",url.host=="127.0.0.1",url.port==5491 else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
    @objc private func openPrivacy(_ sender:Any?) {
        guard let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") else{return}
        NSWorkspace.shared.open(url)
    }
    func windowWillClose(_ notification: Notification) {
        // The standalone permissions helper must not remain headless.
        // RM transport runs in a different process and is unaffected.
        refreshTimer?.invalidate()
        NSApplication.shared.terminate(nil)
    }
    @objc private func quitApp(_ sender:Any?) {
        NSApplication.shared.terminate(nil)
    }
}

func runRobotPermissions(isDevelopment:Bool) {
    let app = NSApplication.shared
    let controller = RobotDevPermissionsController()
    controller.isDevelopment = isDevelopment
    app.delegate = controller
    app.run()
}
