import Foundation
import AppKit
import CoreGraphics
import Darwin

// macOS RM V2 — Codex-inspired pointer, continuous owner-visible AI lease.
// The pointer is never a clickable window and never activates its application.
// Unlike the previous halo, the actual OS arrow is temporarily hidden while
// this independent watchdog app shows the replacement. Its hide count is
// restored on normal detach, TTL expiry or parent loss.
private var robotCursorStopRequested: sig_atomic_t = 0
private func robotCursorStopSignal(_ signal: Int32) {
    robotCursorStopRequested = 1
}

final class RobotCursorIndicatorView: NSView {
    var pulse: CGFloat = 0 { didSet { needsDisplay=true } }
    var drawsCustomArrow = false { didSet { if oldValue != drawsCustomArrow { needsDisplay=true } } }
    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSGraphicsContext.current?.imageInterpolation = .high
        // An asymmetric, layered glow, not a circular tracking ring.
        // Amber is the Light Remote brand; cyan/violet keeps the pointer
        // visible on both dark and light windows without looking neon-heavy.
        let breath = CGFloat(0.87 + Double(pulse) * 0.13)
        for (rect, color, alpha) in [
            (NSRect(x:7,y:39,width:48,height:43),NSColor(calibratedRed:0.16,green:0.78,blue:1.0,alpha:1),CGFloat(0.045)),
            (NSRect(x:12,y:44,width:37,height:35),NSColor(calibratedRed:0.49,green:0.37,blue:0.99,alpha:1),CGFloat(0.07)),
            (NSRect(x:17,y:48,width:27,height:27),NSColor(calibratedRed:1.0,green:0.73,blue:0.18,alpha:1),CGFloat(0.14)),
            (NSRect(x:21,y:53,width:15,height:16),NSColor(calibratedRed:0.34,green:0.99,blue:0.86,alpha:1),CGFloat(0.19))
        ] {
            color.withAlphaComponent(alpha*breath).setFill()
            NSBezierPath(ovalIn:rect).fill()
        }

        if drawsCustomArrow {
        // Same pointed arrow geometry/hotspot as the Windows RM V2 cursor.
        // AppKit Y points up, so the Windows path is vertically mirrored.
        let pointer = NSBezierPath()
        pointer.move(to:NSPoint(x:25,y:64))           // physical tip / hotspot
        pointer.line(to:NSPoint(x:27.4,y:43.75))
        pointer.line(to:NSPoint(x:32.35,y:48.1))
        pointer.line(to:NSPoint(x:37.1,y:38.95))
        pointer.line(to:NSPoint(x:40.9,y:40.75))
        pointer.line(to:NSPoint(x:35.9,y:49.9))
        pointer.line(to:NSPoint(x:43.15,y:50.35))
        pointer.close()
        pointer.lineJoinStyle = .round

        let shadow=pointer.copy() as! NSBezierPath
        var shift=AffineTransform(translationByX:1.3,byY:-1.5)
        shadow.transform(using:shift)
        NSColor.black.withAlphaComponent(0.30).setFill()
        shadow.fill()

        NSColor(calibratedRed:0.055,green:0.075,blue:0.12,alpha:0.99).setFill()
        pointer.fill()
        pointer.lineWidth=3.6
        NSColor(calibratedRed:0.3,green:0.95,blue:0.84,alpha:0.62).setStroke()
        pointer.stroke()
        pointer.lineWidth=1.15
        NSColor.white.withAlphaComponent(0.97).setStroke()
        pointer.stroke()
        }

        // Small glass-like AI label retained from the accepted Windows-style
        // user experience; the label stays offset from the arrow hotspot.
        let badge=NSBezierPath(roundedRect:NSRect(x:43,y:23,width:30,height:20),xRadius:10,yRadius:10)
        NSColor(calibratedRed:0.07,green:0.10,blue:0.17,alpha:0.94).setFill()
        badge.fill()
        badge.lineWidth=1.1
        NSColor(calibratedRed:0.98,green:0.77,blue:0.22,alpha:0.9).setStroke()
        badge.stroke()
        NSAttributedString(string:"AI",attributes:[
            .font:NSFont.systemFont(ofSize:10,weight:.bold),
            .foregroundColor:NSColor.white
        ]).draw(at:NSPoint(x:51,y:27))
    }
}

// Optional DEV-ONLY compatibility probe. This is undocumented WindowServer
// SPI and must remain disabled for release/notarization builds. Missing
// symbols or a rejected property fail closed to the stock macOS cursor.
// The macOS SDK removed the direct Swift declaration for this old Quartz
// diagnostic. Resolve it optionally at runtime; nil means unknown, not hidden.
private func observedOSCursorVisibility() -> Bool? {
    typealias CursorVisibleFn = @convention(c) () -> Int32
    guard let handle=UnsafeMutableRawPointer(bitPattern:-2),
          let symbol=dlsym(handle,"CGCursorIsVisible") else {return nil}
    return unsafeBitCast(symbol,to:CursorVisibleFn.self)() != 0
}

private func setBackgroundCursorExperiment(_ enabled: Bool) -> Bool {
    typealias ConnectionFn = @convention(c) () -> Int32
    typealias PropertyFn = @convention(c) (Int32, Int32, CFString, CFTypeRef) -> Int32
    guard let handle=UnsafeMutableRawPointer(bitPattern:-2),
          let connectionSym=dlsym(handle,"CGSMainConnectionID"),
          let propertySym=dlsym(handle,"CGSSetConnectionProperty")
    else {return false}
    let connection=unsafeBitCast(connectionSym,to:ConnectionFn.self)()
    let propertyFn=unsafeBitCast(propertySym,to:PropertyFn.self)
    let value:CFBoolean = enabled ? kCFBooleanTrue : kCFBooleanFalse
    return propertyFn(connection,connection,"SetsCursorInBackground" as CFString,value) == 0
}

func runRobotCursorOverlay(args:[String]) throws {
    guard args.count>=5,
          let rawPid=Int32(args[2]),rawPid>1,
          let initialExpiry=Int64(args[3]),
          args[4].hasPrefix("/tmp/lightremote-rmv2-cursor-"),
          args[4].hasSuffix(".lease")
    else {throw RemoteError.invalid("cursor_overlay_args_invalid")}
    let leasePath=args[4]
    let now=timestamp()
    guard initialExpiry>now && initialExpiry<=now+900_000
    else {throw RemoteError.invalid("cursor_overlay_deadline_invalid")}

    robotCursorStopRequested=0
    _=Darwin.signal(SIGTERM,robotCursorStopSignal)
    _=Darwin.signal(SIGINT,robotCursorStopSignal)
    let app=NSApplication.shared
    app.setActivationPolicy(.accessory)
    // macOS menu-bar RM activity indicator: same RM V2 logo as Windows,
    // visible only during an owned, live remote-control cursor lease.
    // No Dock activation, menu-bar popover or mouse interception.
    let rmStatusItem=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
    // App bundle first; an installed RM helper may be a standalone binary
    // inside a versioned package rather than its own .app. Both share the
    // same Windows RM V2 logo, never the ordinary Light Remote tray icon.
    let binaryDirectory=(Bundle.main.executableURL
        ?? URL(fileURLWithPath:CommandLine.arguments[0])).deletingLastPathComponent()
    let embeddedIcon=Bundle.main.url(forResource:"LightRemoteRM",withExtension:"icns")
    let siblingLogo=binaryDirectory.appendingPathComponent("LightRemoteRM-256.png")
    let iconImage=embeddedIcon.flatMap { NSImage(contentsOf:$0) }
        ?? NSImage(contentsOf:siblingLogo)
    if let icon=iconImage {
        icon.size=NSSize(width:18,height:18)
        icon.isTemplate=false // preserve the Windows RM yellow/black palette
        rmStatusItem.button?.image=icon
    } else {
        rmStatusItem.button?.title="RM"
    }
    rmStatusItem.button?.toolTip="Light Remote RM · Agent đang điều khiển"
    // The indicator cannot start/stop remote control; the authorized session
    // and lease remain the only authority. Removing it is guaranteed on exit.
    // Let app.run() finish launching before the async orderFront request.
    let panel=NSPanel(contentRect:NSRect(x:0,y:0,width:88,height:88),
                      styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
    panel.isOpaque=false
    panel.backgroundColor = .clear
    panel.hasShadow=false
    panel.ignoresMouseEvents=true
    panel.hidesOnDeactivate=false
    panel.level = .screenSaver
    panel.title = "Light Remote AI Cursor"
    panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]
    let indicator=RobotCursorIndicatorView(frame:NSRect(x:0,y:0,width:88,height:88))
    panel.contentView=indicator
    let initial=NSEvent.mouseLocation
    panel.setFrameOrigin(NSPoint(x:initial.x-25,y:initial.y-64))
    panel.orderFrontRegardless()
    panel.displayIfNeeded()
    // WindowServer may not register an accessory panel until NSApp.run().
    // Request ordering again from the live main runloop without activation.
    DispatchQueue.main.asyncAfter(deadline:.now() + .milliseconds(100)) {
        panel.orderFrontRegardless()
        panel.displayIfNeeded()
    }

    // NEVER hide the real OS pointer until the replacement is actually
    // registered as a visible window. Otherwise a headless helper would
    // make the owner's pointer vanish without drawing the AI arrow.
    let display=CGMainDisplayID()
    // Explicit canary opt-in only. The private SPI must not be enabled by
    // published clients because macOS may change or reject it.
    let backgroundCursorOptIn=ProcessInfo.processInfo.environment["LIGHT_REMOTE_RM_DEV_CURSOR_SPI"] == "1"
    let backgroundHideEnabled=backgroundCursorOptIn && setBackgroundCursorExperiment(true)
    var systemCursorHidden=false
    var suppressionAttempts=0
    func windowPresented() -> Bool {
        let windows=CGWindowListCopyWindowInfo([.optionIncludingWindow],CGWindowID(panel.windowNumber)) as? [[String:Any]] ?? []
        return panel.isVisible && !windows.isEmpty
    }
    var expiry=initialExpiry
    var ticks=0
    let diagnosticsPath=FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Caches/LightRemote-RMV2-Experimental/cursor-overlay.status.json")
    func publishStatus(_ active:Bool) {
        // Local-only diagnostics. The overlay itself reports actual window
        // visibility, OS cursor state and frames, not a guessed RPC success.
        let point=NSEvent.mouseLocation
        let report:[String:Any]=["active":active,"pid":Int(getpid()),
            "visible":active && panel.isVisible,"windowListed":windowPresented(),
            "systemCursorHidden":active && systemCursorHidden,
            "osCursorActuallyVisible":observedOSCursorVisibility() as Any? ?? NSNull(),
            "backgroundCursorSPIEnabled":backgroundHideEnabled,
            "cursorSuppressionAttempts":suppressionAttempts,
            "renderTicks":ticks,
            "mouseX":point.x,"mouseY":point.y,"expiresAtMs":expiry,
            "updatedAtMs":timestamp()]
        if let bytes=try? JSONSerialization.data(withJSONObject:report,options:[.sortedKeys]),
           (try? bytes.write(to:diagnosticsPath,options:[.atomic])) != nil {
            _=chmod(diagnosticsPath.path,0o600)
        }
    }
    publishStatus(true)
    var cursorRestored=false
    func restoreSystemCursor() {
        guard !cursorRestored else {return}
        cursorRestored=true
        if systemCursorHidden {_=CGDisplayShowCursor(display);systemCursorHidden=false}
        if backgroundHideEnabled {_=setBackgroundCursorExperiment(false)}
        indicator.drawsCustomArrow=false
        panel.orderOut(nil)
        NSStatusBar.system.removeStatusItem(rmStatusItem)
        publishStatus(false)
    }
    defer {restoreSystemCursor()}

    fputs("robot_overlay_visible=\(panel.isVisible) cg_window=\(windowPresented()) system_cursor_hidden=\(systemCursorHidden)\n",stderr)
    var previousPoint=initial
    let tick=Timer(timeInterval:0.035,repeats:true) { _ in
        ticks += 1
        if ticks % 8 == 0 {
            // Atomic, mode-0600 heartbeat from the native helper. A missing
            // lease always expires rather than leaving a hidden OS cursor.
            if let data=try? Data(contentsOf:URL(fileURLWithPath:leasePath)),
               let newDeadline=Int64(String(decoding:data,as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines)),
               newDeadline>timestamp() && newDeadline<=timestamp()+900_000 {
                expiry=newDeadline
            } else { expiry=0 }
        }
        if robotCursorStopRequested != 0 || timestamp()>expiry ||
           (kill(rawPid,0) != 0 && errno == ESRCH) {
            // NSApplication.stop alone can leave a headless overlay's
            // event loop alive indefinitely. Restore first, then terminate.
            // This also covers SIGTERM, owner death and expiry.
            restoreSystemCursor()
            app.terminate(nil)
            return
        }
        if ticks % 7 == 0 {
            if !panel.isVisible {
                panel.orderFrontRegardless()
                panel.displayIfNeeded()
            }
            let presented=windowPresented()
            let foregroundOwner=NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid()
            let canSuppress=foregroundOwner || backgroundHideEnabled
            if presented && canSuppress && !systemCursorHidden && suppressionAttempts<3 {
                suppressionAttempts += 1
                let result=CGDisplayHideCursor(display)
                if result == .success {
                    if observedOSCursorVisibility() == false {
                        systemCursorHidden=true
                    } else {
                        // Background cursor hide wasn't honored. Balance its
                        // hide count immediately and keep the native arrow.
                        _=CGDisplayShowCursor(display)
                    }
                }
            }
            if systemCursorHidden && (!presented || observedOSCursorVisibility() != false) {
                _=CGDisplayShowCursor(display)
                systemCursorHidden=false
            }
            // Never show two arrowheads. If Quartz cannot suppress the system
            // cursor, keep its native hotspot and draw only glow + AI badge.
            indicator.drawsCustomArrow=systemCursorHidden
        }
        let pt=NSEvent.mouseLocation
        // Track actual pointer every 35 ms, but avoid redrawing while idle.
        // A slow 7 Hz glow breath costs much less CPU than repainting at 28 Hz.
        if hypot(pt.x-previousPoint.x,pt.y-previousPoint.y)>0.4 {
            panel.setFrameOrigin(NSPoint(x:pt.x-25,y:pt.y-64))
            previousPoint=pt
        }
        if ticks % 4 == 0 {
            indicator.pulse=CGFloat(0.5+0.5*sin(Double(ticks)*0.085))
        }
        if ticks % 28 == 0 {publishStatus(true)}
    }
    RunLoop.main.add(tick,forMode:.common)
    app.run()
    tick.invalidate()
}

// The parent publishes a monotonically extended, bounded local lease. The
// indicator process observes this file instead of being killed/restarted on
// each input/frame request. No network endpoint or owner permission is added.
final class RobotCursorOverlayController {
    private let lock=NSRecursiveLock()
    private var child:Process?
    private var heartbeat:DispatchSourceTimer?
    private var lastOwnerRequest:Int64=0
    private let maxIdleMs:Int64=900_000
    private let leasePath="/tmp/lightremote-rmv2-cursor-\(getpid())-\(UUID().uuidString).lease"
    var active:Bool {
        lock.lock();defer{lock.unlock()}
        return child?.isRunning ?? false
    }

    private func publishLease(_ expiry:Int64) -> Bool {
        guard expiry>timestamp(),expiry<=timestamp()+900_000 else {return false}
        do {
            try Data(String(expiry).utf8).write(to:URL(fileURLWithPath:leasePath),options:.atomic)
            guard chmod(leasePath,0o600)==0 else {return false}
            return true
        } catch {return false}
    }
    private func stopHeartbeatLocked() {
        heartbeat?.setEventHandler {}
        heartbeat?.cancel()
        heartbeat=nil
    }
    private func hideLocked() {
        stopHeartbeatLocked()
        try? FileManager.default.removeItem(atPath:leasePath)
        if let proc=child,proc.isRunning {proc.terminate()}
        child=nil
        lastOwnerRequest=0
    }
    // This timer runs on a background queue even when the native RPC reader
    // blocks waiting for the next message. It cannot keep the arrow hidden
    // indefinitely: owner inactivity >15m, detach, exit and failures restore it.
    private func ensureHeartbeatLocked() {
        guard heartbeat == nil else {return}
        let timer=DispatchSource.makeTimerSource(queue:DispatchQueue.global(qos:.utility))
        timer.schedule(deadline: DispatchTime.now() + .seconds(20), repeating: .seconds(20))
        timer.setEventHandler {[weak self] in
            guard let self else {return}
            self.lock.lock();defer{self.lock.unlock()}
            let now=timestamp()
            guard self.child?.isRunning == true else {self.hideLocked();return}
            if now-self.lastOwnerRequest>=self.maxIdleMs {
                self.hideLocked()
                return
            }
            let desired=min(now+120_000,self.lastOwnerRequest+self.maxIdleMs)
            if desired<=now || !self.publishLease(desired) {self.hideLocked()}
        }
        heartbeat=timer
        timer.resume()
    }
    @discardableResult
    func show(expiresAt:Int64) -> Bool {
        lock.lock();defer{lock.unlock()}
        let now=timestamp()
        let desired=max(expiresAt,now+120_000)
        guard desired>now && desired<=now+maxIdleMs else {return false}
        lastOwnerRequest=now
        guard publishLease(desired) else {return false}
        if child?.isRunning == true {
            ensureHeartbeatLocked()
            return true
        }
        let process=Process()
        process.executableURL=URL(fileURLWithPath:CommandLine.arguments[0])
        process.arguments=["--cursor-overlay",String(getpid()),String(desired),leasePath]
        process.standardInput=FileHandle.nullDevice
        process.standardOutput=FileHandle.nullDevice
        process.standardError=FileHandle.standardError
        do {
            try process.run()
            child=process
            ensureHeartbeatLocked()
            return true
        } catch {
            hideLocked()
            return false
        }
    }
    func hide() {
        lock.lock();defer{lock.unlock()}
        hideLocked()
    }
    deinit {hide()}
}
