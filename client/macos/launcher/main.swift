import Foundation
import Darwin

@discardableResult
func run(_ executable: String, _ arguments: [String]) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    } catch {
        return 127
    }
}

let uid = getuid()
let label = "gui/\(uid)/com.lightremote.tray"
_ = run("/bin/launchctl", ["enable", label])
if run("/bin/launchctl", ["kickstart", "-k", label]) != 0 {
    let tray = "/Library/Application Support/Light Remote/current/tray/LightRemoteTray"
    if FileManager.default.isExecutableFile(atPath: tray) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tray)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }
}
