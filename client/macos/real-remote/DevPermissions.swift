import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Local, owner-operated permission window for UNSIGNED development builds.
// Never changes macOS privacy settings; the OS owns approval decisions.
final class RobotDevPermissionsController: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
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
        app.setActivationPolicy(.regular)

        let frame = NSRect(x:0,y:0,width:550,height:280)
        let win = NSWindow(contentRect:frame,
                           styleMask:[.titled,.closable,.miniaturizable],
                           backing:.buffered,defer:false)
        win.title = "Light Remote Robot — Development Permissions"
        win.center()
        win.isReleasedWhenClosed = false

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

        let reqRow = NSStackView(views:[
            button("Request Screen Recording",action:#selector(requestScreen)),
            button("Request Accessibility",action:#selector(requestAX))
        ])
        reqRow.orientation = .horizontal
        reqRow.spacing = 8
        container.addArrangedSubview(reqRow)

        let navRow = NSStackView(views:[
            button("Refresh Status",action:#selector(refresh)),
            button("Open Privacy Settings",action:#selector(openPrivacy)),
            button("Quit Dev Robot",action:#selector(quitApp))
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
    }
    @objc private func openPrivacy(_ sender:Any?) {
        guard let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") else{return}
        NSWorkspace.shared.open(url)
    }
    @objc private func quitApp(_ sender:Any?) {
        NSApplication.shared.terminate(nil)
    }
}

func runRobotDevPermissions() {
    let app = NSApplication.shared
    let controller = RobotDevPermissionsController()
    app.delegate = controller
    app.run()
}
