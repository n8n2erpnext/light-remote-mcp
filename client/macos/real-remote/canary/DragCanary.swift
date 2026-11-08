import AppKit
import Foundation
import CoreGraphics

// Isolated graphical drag target. This binary is CI-only and NEVER installed.
// The only side effect is its own temporary synthetic test window/result file.
final class DragTrack: NSView {
    let destination:String
    let origin=NSPoint(x:83,y:125)
    let target=NSPoint(x:348,y:125)
    private var active=false
    private var moved=false
    init(frame:NSRect,destination:String) {
        self.destination=destination
        super.init(frame:frame)
    }
    required init?(coder:NSCoder) { return nil }
    override var acceptsFirstResponder:Bool {true}
    override func draw(_ rect:NSRect) {
        NSColor.windowBackgroundColor.setFill();rect.fill()
        NSColor.systemGray.withAlphaComponent(0.4).setStroke()
        let path=NSBezierPath()
        path.lineWidth=8
        path.move(to:origin);path.line(to:target);path.stroke()
        for (point,color) in [(origin,NSColor.systemBlue),(target,NSColor.systemGreen)] {
            color.setFill()
            NSBezierPath(ovalIn:NSRect(x:point.x-20,y:point.y-20,width:40,height:40)).fill()
        }
        let msg=NSAttributedString(string:"Light Remote Drag Canary — temporary test window",attributes:[.font:NSFont.systemFont(ofSize:13)])
        msg.draw(at:NSPoint(x:36,y:195))
    }
    func publish(_ state:String) {
        guard let window else {return}
        func global(_ local:NSPoint) -> [String:Double] {
            let w=convert(local,to:nil)
            let p=window.convertPoint(toScreen:w)
            let main=NSScreen.screens.first?.frame.maxY ?? 900
            let b=CGDisplayBounds(CGMainDisplayID())
            return ["x":Double(p.x)+Double(b.minX),"y":Double(main-p.y)+Double(b.minY)]
        }
        let obj:[String:Any]=["state":state,"pid":Int(getpid()),
            "start":global(origin),"end":global(target),"windowTitle":window.title]
        if let data=try? JSONSerialization.data(withJSONObject:obj) {
            try? data.write(to:URL(fileURLWithPath:destination),options:[.atomic])
        }
    }
    override func mouseDown(with event:NSEvent) {
        let point=convert(event.locationInWindow,from:nil)
        active=hypot(point.x-origin.x,point.y-origin.y)<24
        moved=false
    }
    override func mouseDragged(with event:NSEvent) {
        if active { moved=true }
    }
    override func mouseUp(with event:NSEvent) {
        if active && moved {
            let point=convert(event.locationInWindow,from:nil)
            if hypot(point.x-target.x,point.y-target.y)<25 {
                publish("PASS")
            } else {publish("DRAG_WRONG_TARGET")}
        } else {publish("DRAG_NOT_RECEIVED")}
        active=false
    }
}
guard CommandLine.arguments.count==2,
      CommandLine.arguments[1].hasPrefix("/tmp/lightremote-drag-") else {exit(2)}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let win=NSWindow(contentRect:NSRect(x:100,y:100,width:460,height:260),
                 styleMask:[.titled,.closable,.miniaturizable],backing:.buffered,defer:false)
win.title="LightRemoteDragCanary"
let view=DragTrack(frame:NSRect(x:0,y:0,width:460,height:260),destination:CommandLine.arguments[1])
win.contentView=view
win.center()
win.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps:true)
DispatchQueue.main.asyncAfter(deadline:.now()+1) {view.publish("READY")}
DispatchQueue.main.asyncAfter(deadline:.now()+25) {app.terminate(nil)}
app.run()
