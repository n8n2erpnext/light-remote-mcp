import Foundation
import AppKit
import CoreGraphics
import Darwin

// Isolated macOS Robot cursor indicator. Click-through and non-activating.
// The system pointer is intentionally NEVER hidden; if the helper crashes,
// the owner's cursor cannot get stranded invisible. It uses no private APIs.
final class RobotCursorIndicatorView: NSView {
    override func draw(_ dirtyRect:NSRect) {
        super.draw(dirtyRect)
        let halo=NSBezierPath(ovalIn:NSRect(x:17,y:17,width:29,height:29))
        halo.lineWidth=5
        NSColor(calibratedRed:0.06,green:0.73,blue:0.98,alpha:0.2).setStroke()
        halo.stroke()
        let ring=NSBezierPath(ovalIn:NSRect(x:17,y:17,width:29,height:29))
        ring.lineWidth=1.8
        NSColor(calibratedRed:0.3,green:0.87,blue:1.0,alpha:0.94).setStroke()
        ring.stroke()
        let dot=NSBezierPath(ovalIn:NSRect(x:40,y:39,width:17,height:17))
        NSColor(calibratedRed:0.02,green:0.16,blue:0.23,alpha:0.96).setFill()
        dot.fill()
        NSColor.white.withAlphaComponent(0.9).setStroke()
        dot.lineWidth=1
        dot.stroke()
        let label=NSAttributedString(string:"AI",attributes:[
            .font:NSFont.systemFont(ofSize:9,weight:.semibold),
            .foregroundColor:NSColor.white])
        label.draw(at:NSPoint(x:42,y:42))
    }
    override var isOpaque:Bool {false}
}

func runRobotCursorOverlay(args:[String]) throws {
    guard args.count >= 4,
          let rawPid=Int32(args[2]),rawPid>1,
          let deadline=Int64(args[3]) else {throw RemoteError.invalid("cursor_overlay_args_invalid")}
    let now=timestamp()
    guard deadline>now && deadline<=now+900_000 else {throw RemoteError.invalid("cursor_overlay_deadline_invalid")}
    let app=NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let panel=NSPanel(contentRect:NSRect(x:0,y:0,width:64,height:64),
                      styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
    panel.isOpaque=false
    panel.backgroundColor = .clear
    panel.hasShadow=false
    panel.ignoresMouseEvents=true
    panel.hidesOnDeactivate=false
    panel.level = .statusBar
    panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]
    panel.contentView=RobotCursorIndicatorView(frame:NSRect(x:0,y:0,width:64,height:64))
    panel.orderFrontRegardless()
    // Keep the marker beside the real pointer; do not steal focus.
    let tick=Timer(timeInterval:0.035,repeats:true) { _ in
        if timestamp()>deadline || (kill(rawPid,0) != 0 && errno == ESRCH) {
            app.terminate(nil)
            return
        }
        let pt=NSEvent.mouseLocation
        panel.setFrameOrigin(NSPoint(x:pt.x-18,y:pt.y-44))
    }
    RunLoop.main.add(tick,forMode:.common)
    app.run()
    tick.invalidate()
    panel.orderOut(nil)
}

final class RobotCursorOverlayController {
    private var child:Process?
    private var childDeadline:Int64=0
    var active:Bool {child?.isRunning ?? false}
    @discardableResult
    func show(expiresAt:Int64) -> Bool {
        let now=timestamp()
        guard expiresAt>now else {return false}
        // Extend only near expiry; normal attach/frame/AX calls never flicker.
        if active && childDeadline-now>20000 {return true}
        if active {hide()}
        let process=Process()
        process.executableURL=URL(fileURLWithPath:CommandLine.arguments[0])
        process.arguments=["--cursor-overlay",String(getpid()),String(expiresAt)]
        process.standardInput=FileHandle.nullDevice
        process.standardOutput=FileHandle.nullDevice
        process.standardError=FileHandle.nullDevice
        do {
            try process.run()
            child=process
            childDeadline=expiresAt
            return true
        } catch {
            child=nil
            return false
        }
    }
    func hide() {
        if let proc=child,proc.isRunning {proc.terminate()}
        child=nil
        childDeadline=0
    }
    deinit {hide()}
}
