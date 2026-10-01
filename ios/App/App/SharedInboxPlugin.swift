import Foundation
import Capacitor

/// Lets the web app list recordings waiting in the inbox, read one in
/// pieces (to hand it to the same upload code the website uses), and
/// remove it once it's uploaded.
@objc(SharedInboxPlugin)
public class SharedInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharedInboxPlugin"
    public let jsName = "SharedInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    /// Big enough to keep the number of calls low, small enough that one
    /// piece never strains memory on either side of the bridge.
    private let maxChunkBytes = 2 * 1024 * 1024

    @objc func list(_ call: CAPPluginCall) {
        let formatter = ISO8601DateFormatter()
        let items: [JSObject] = SharedInbox.list().map { item in
            var object: JSObject = [
                "id": item.id,
                "title": item.title,
                "fileName": item.fileName,
                "contentType": item.contentType,
                "size": Double(item.size),
                "addedAt": formatter.string(from: item.addedAt),
                "source": item.source
            ]
            if let recordedAt = item.recordedAt { object["recordedAt"] = formatter.string(from: recordedAt) }
            if let duration = item.durationSeconds { object["durationSeconds"] = duration }
            return object
        }
        call.resolve(["items": items])
    }

    @objc func readChunk(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let item = SharedInbox.item(id: id),
              let url = SharedInbox.audioURL(for: item) else {
            call.reject(InboxError.missing.localizedDescription, "missing")
            return
        }
        let offset = UInt64(max(0, call.getDouble("offset") ?? 0))
        let length = min(maxChunkBytes, max(1, call.getInt("length") ?? maxChunkBytes))
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: offset)
            let data = try handle.read(upToCount: length) ?? Data()
            call.resolve([
                "data": data.base64EncodedString(),
                "bytes": data.count,
                "done": offset + UInt64(data.count) >= UInt64(item.size)
            ])
        } catch {
            call.reject("Couldn't read the recording.", "read-failed", error)
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id.")
            return
        }
        SharedInbox.remove(id: id)
        call.resolve()
    }
}
