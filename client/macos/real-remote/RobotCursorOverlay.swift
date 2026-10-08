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
    app.finishLaunching()
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

    // A separate process owns the OS cursor hide/show. The helper is still
    // its parent watchdog: when parent exits, this process restores the arrow.
    let display=CGMainDisplayID()
    let systemCursorHidden = CGDisplayHideCursor(display) == .success
    defer {
        if systemCursorHidden {_=CGDisplayShowCursor(display)}
        panel.orderOut(nil)
    }

    let metadata=CGWindowListCopyWindowInfo([.optionIncludingWindow],CGWindowID(panel.windowNumber)) as? [[String:Any]] ?? []
    fputs("robot_overlay_visible=\(panel.isVisible) cg_window=\(!metadata.isEmpty) system_cursor_hidden=\(systemCursorHidden)\n",stderr)
    var expiry=initialExpiry
    var ticks=0
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
            // stop() returns from app.run() so the defer block restores
            // the real OS cursor even on TTL or owner-process expiry.
            app.stop(nil)
            return
        }
        let pt=NSEvent.mouseLocation
        panel.setFrameOrigin(NSPoint(x:pt.x-25,y:pt.y-64))
        indicator.pulse=CGFloat(0.5+0.5*sin(Double(ticks)*0.085))
    }
    RunLoop.main.add(tick,forMode:.common)
    app.run()
    tick.invalidate()
}

// The parent publishes a monotonically extended, bounded local lease. The
// indicator process observes this file instead of being killed/restarted on
// each input/frame request. No network endpoint or owner permission is added.
final class RobotCursorOverlayController {
    private var child:Process?
    private var childDeadline:Int64=0
    private let leasePath="/tmp/lightremote-rmv2-cursor-\(getpid())-\(UUID().uuidString).lease"
    var active:Bool {child?.isRunning ?? false}

    private func publishLease(_ expiry:Int64) -> Bool {
        guard expiry>timestamp(),expiry<=timestamp()+900_000 else {return false}
        do {
            try Data(String(expiry).utf8).write(to:URL(fileURLWithPath:leasePath),options:.atomic)
            guard chmod(leasePath,0o600)==0 else {return false}
            childDeadline=expiry
            return true
        } catch {return false}
    }
    @discardableResult
    func show(expiresAt:Int64) -> Bool {
        let desired=max(expiresAt,timestamp()+120000)
        guard publishLease(desired) else {return false}
        if active {return true}
        let process=Process()
        process.executableURL=URL(fileURLWithPath:CommandLine.arguments[0])
        process.arguments=["--cursor-overlay",String(getpid()),String(desired),leasePath]
        process.standardInput=FileHandle.nullDevice
        process.standardOutput=FileHandle.nullDevice
        process.standardError=FileHandle.standardError
        do {
            try process.run()
            child=process
            return true
        } catch {
            child=nil
            try? FileManager.default.removeItem(atPath:leasePath)
            return false
        }
    }
    func hide() {
        try? FileManager.default.removeItem(atPath:leasePath)
        if let proc=child,proc.isRunning {proc.terminate()}
        child=nil
        childDeadline=0
    }
    deinit {hide()}
}
