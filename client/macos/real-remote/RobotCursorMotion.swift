import Foundation
import AppKit
import CoreGraphics
import Darwin

// macOS-only, bounded visible cursor movement.
// Coordinates are global CoreGraphics screen coordinates (origin top-left).
// No clicks are issued by this function; AX retains responsibility for actions.
@discardableResult
func glideRobotCursor(to end: CGPoint, steps requestedSteps: Int = 12, durationMs requestedDuration: Int = 170) throws -> Int {
    guard end.x.isFinite && end.y.isFinite else {throw RemoteError.invalid("cursor_target_invalid")}
    let start=CGEvent(source:nil)?.location ?? end
    let distance=hypot(end.x-start.x,end.y-start.y)
    if distance < 1.5 {
        try postMouse(.mouseMoved,end)
        return 1
    }
    let steps=clamp(requestedSteps,4,40)
    let durationMs=clamp(requestedDuration,0,550)
    let intervalUs=durationMs>0 ? useconds_t((durationMs * 1000)/steps) : 0
    for index in 1...steps {
        let progress=Double(index)/Double(steps)
        let eased=progress * progress * (3 - 2 * progress)
        let at=CGPoint(x:start.x+(end.x-start.x)*eased,y:start.y+(end.y-start.y)*eased)
        try postMouse(.mouseMoved,at)
        if intervalUs>0 && index<steps {usleep(intervalUs)}
    }
    return steps
}

// For AX actions, a non-interactive visible glide precedes semantic invocation.
// No click or keypress is fabricated, and off-screen/invalid geometry is skipped.
func visualizeRobotSemanticTarget(_ element: AXUIElement, foregroundPid:pid_t) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPid else {return false}
    let bounds=axRect(element)
    let width=bounds["width"] as? CGFloat ?? 0
    let height=bounds["height"] as? CGFloat ?? 0
    let x=bounds["x"] as? CGFloat ?? .nan
    let y=bounds["y"] as? CGFloat ?? .nan
    guard x.isFinite && y.isFinite && width.isFinite && height.isFinite &&
          width>3 && height>3 else {return false}
    let center=CGPoint(x:x+width/2,y:y+height/2)
    let onscreen=displays().contains { id in
        let b=CGDisplayBounds(id)
        return center.x>=b.minX && center.x<b.maxX && center.y>=b.minY && center.y<b.maxY
    }
    guard onscreen else {return false}
    do {try glideRobotCursor(to:center,steps:12,durationMs:165);return true}
    catch {return false}
}
