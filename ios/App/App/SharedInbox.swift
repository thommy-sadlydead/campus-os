import Foundation

/// A recording waiting to be added to a class.
struct InboxItem: Codable {
    let id: String
    /// What the student sees, e.g. "Econ lecture" for "Econ lecture.m4a".
    let title: String
    let fileName: String
    let contentType: String
    let size: Int64
    /// When the audio was recorded, if known. The app uses it to pick the
    /// class from the student's schedule.
    let recordedAt: Date?
    let durationSeconds: Double?
    let addedAt: Date
    /// "share" (sent from Voice Memos or another app) or "recorder"
    /// (recorded in Campus OS).
    let source: String
}

enum InboxError: LocalizedError {
    case unavailable
    case missing

    var errorDescription: String? {
        switch self {
        case .unavailable: return "Campus OS couldn't open its shared storage."
        case .missing: return "That recording is no longer on this device."
        }
    }
}

/// Recordings waiting to be uploaded: ones shared into Campus OS from Voice
/// Memos or Files (by the share extension) and ones recorded in the app.
/// They live in the App Group container, which the app and its share
/// extension can both reach, until the web app uploads them and removes
/// them. Used by both targets.
enum SharedInbox {
    static var appGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "CampusOSAppGroup") as? String ?? "group.com.reecebroderick.campusos"
    }

    static var directory: URL? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            return nil
        }
        let directory = container.appendingPathComponent("Inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    /// A new, unused location in the inbox for an audio file. Nothing lists
    /// it until `commit` writes its details.
    static func newAudioURL(fileExtension: String) throws -> URL {
        guard let directory = directory else { throw InboxError.unavailable }
        let ext = fileExtension.isEmpty ? "m4a" : fileExtension.lowercased()
        return directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
    }

    /// Records the details of an audio file already at `newAudioURL`'s
    /// location, which makes it show up in `list()`.
    @discardableResult
    static func commit(
        audioAt url: URL,
        title: String,
        contentType: String,
        recordedAt: Date?,
        durationSeconds: Double?,
        source: String
    ) throws -> InboxItem {
        guard let directory = directory else { throw InboxError.unavailable }
        let id = url.deletingPathExtension().lastPathComponent
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
        let item = InboxItem(
            id: id,
            title: title,
            fileName: url.lastPathComponent,
            contentType: contentType,
            size: size,
            recordedAt: recordedAt,
            durationSeconds: durationSeconds,
            addedAt: Date(),
            source: source
        )
        try encoder.encode(item).write(to: directory.appendingPathComponent("\(id).json"), options: .atomic)
        return item
    }

    /// Everything waiting, newest first.
    static func list() -> [InboxItem] {
        guard let directory = directory,
              let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return [] }
        return names
            .filter { $0.hasSuffix(".json") }
            .compactMap { name -> InboxItem? in
                guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)),
                      let item = try? decoder.decode(InboxItem.self, from: data),
                      FileManager.default.fileExists(atPath: directory.appendingPathComponent(item.fileName).path)
                else { return nil }
                return item
            }
            .sorted { $0.addedAt > $1.addedAt }
    }

    static func item(id: String) -> InboxItem? {
        list().first { $0.id == id }
    }

    static func audioURL(for item: InboxItem) -> URL? {
        directory?.appendingPathComponent(item.fileName)
    }

    static func remove(id: String) {
        guard let directory = directory else { return }
        if let item = item(id: id) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(item.fileName))
        }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json"))
    }
}
