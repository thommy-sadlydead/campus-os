import AVFoundation
import Capacitor
import UIKit
import UserNotifications

/// Records lectures natively, so recording keeps going with the screen
/// locked or another app open (UIBackgroundModes "audio"), which a web
/// page's recorder can't do. The finished recording goes into the shared
/// inbox, and the web app uploads it the same way as one shared from Voice
/// Memos.
///
/// A recording is never thrown away unless the student says so:
/// - The audio session mixes with other apps, so an ad or a video playing
///   elsewhere doesn't interrupt it. A phone call still does.
/// - It's written in two-minute pieces. Anything that interrupts it closes
///   the current piece properly, so it stays playable.
/// - Which pieces belong to the recording is saved as it goes. If iOS closes
///   Campus OS mid-recording, the next launch finds it paused, with
///   everything up to the last piece, and the student can resume or save it.
/// - Stop joins the pieces into one file in the inbox. If that fails, the
///   pieces stay and Stop can be tried again.
///
/// All recorder and audio-session work happens on one serial queue, never
/// the main thread: turning the microphone on can take a moment, and on the
/// main thread that would freeze the whole app.
@objc(NativeRecorderPlugin)
public class NativeRecorderPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate {
    public let identifier = "NativeRecorderPlugin"
    public let jsName = "NativeRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    // AAC, mono, 64 kbps: the same rate as the website's recorder, about
    // 30 MB an hour, plenty for one speaker in a lecture hall.
    private let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
    ]

    /// How long each piece runs. If Campus OS is closed mid-piece, that
    /// piece can't be read, so this is the most a crash can lose.
    private let pieceSeconds: Int = 120

    /// What's saved about a recording in progress (Recording/session.json).
    private struct Piece: Codable {
        var file: String
        /// Set when the piece is closed; nil while it's being recorded.
        var seconds: Double?
    }

    private struct Session: Codable {
        var title: String
        var startedAt: Date
        var pieces: [Piece]
        /// Paused by a call, another app, or iOS, not by the student.
        var interrupted: Bool
        /// Found on launch after Campus OS was closed mid-recording.
        var recovered: Bool
    }

    private let audioQueue = DispatchQueue(label: "com.campusos.recorder")
    // Everything below is only touched on audioQueue.
    private var session: Session?
    private var recorder: AVAudioRecorder?
    private var meterTimer: DispatchSourceTimer?
    private var pieceTimer: DispatchSourceTimer?
    private var appIsActive = true
    /// Stop is joining the pieces; a second tap mustn't save it twice.
    private var saving = false

    override public func load() {
        let center = NotificationCenter.default
        let audio = AVAudioSession.sharedInstance()
        center.addObserver(self, selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification, object: audio)
        center.addObserver(self, selector: #selector(handleMediaServicesReset),
                           name: AVAudioSession.mediaServicesWereResetNotification, object: audio)
        center.addObserver(self, selector: #selector(appBecameActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appResignedActive),
                           name: UIApplication.willResignActiveNotification, object: nil)
        audioQueue.async { self.restoreSession() }
    }

    @objc private func appBecameActive() { audioQueue.async { self.appIsActive = true } }
    @objc private func appResignedActive() { audioQueue.async { self.appIsActive = false } }

    // MARK: - Methods called from the page

    @objc func start(_ call: CAPPluginCall) {
        let title = call.getString("title")?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Lecture"
        requestPermission { [weak self] granted in
            guard let self = self else { return }
            guard granted else {
                call.reject("Campus OS isn't allowed to use the microphone.", "denied")
                return
            }
            self.audioQueue.async { self.begin(call, title: title) }
        }
    }

    private func begin(_ call: CAPPluginCall, title: String) {
        if session != nil {
            call.reject("A recording is already in progress.", "busy")
            return
        }
        session = Session(title: title, startedAt: Date(), pieces: [], interrupted: false, recovered: false)
        do {
            try activateAudioSession()
            try startPiece()
            saveSession()
            startMeter()
            call.resolve(statusObject())
        } catch {
            session = nil
            clearSessionFiles()
            deactivateAudioSession()
            call.reject("Couldn't start the microphone. Make sure no other app is using it, then try again.", "failed", error)
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        audioQueue.async {
            self.closePiece()
            self.session?.interrupted = false
            self.saveSession()
            call.resolve(self.statusObject())
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        audioQueue.async {
            guard self.session != nil else {
                call.reject("Not recording.", "idle")
                return
            }
            if self.recorder?.isRecording == true {
                call.resolve(self.statusObject())
                return
            }
            do {
                try self.activateAudioSession()
                try self.startPiece()
                self.session?.interrupted = false
                self.session?.recovered = false
                self.saveSession()
                self.startMeter()
                call.resolve(self.statusObject())
            } catch {
                call.reject("Couldn't resume recording. Make sure no other app is using the microphone.", "failed", error)
            }
        }
    }

    /// Finishes the recording, joins its pieces into one file in the inbox,
    /// and resolves with its id. On failure everything is kept.
    @objc func stop(_ call: CAPPluginCall) {
        audioQueue.async {
            guard let session = self.session else {
                call.reject("Not recording.", "idle")
                return
            }
            guard !self.saving else {
                call.reject("Already saving.", "busy")
                return
            }
            self.closePiece()
            self.stopTimers()
            self.deactivateAudioSession()
            self.saveSession()
            let pieces = self.readablePieces(of: session)
            guard !pieces.isEmpty else {
                call.reject("Nothing was recorded.", "empty")
                return
            }
            self.saving = true
            let background = UIApplication.shared.beginBackgroundTask(withName: "Save recording")
            self.join(pieces.map(\.url)) { result in
                self.audioQueue.async {
                    defer {
                        self.saving = false
                        UIApplication.shared.endBackgroundTask(background)
                    }
                    switch result {
                    case .success(let url):
                        do {
                            let seconds = pieces.reduce(0) { $0 + $1.seconds }
                            let item = try SharedInbox.commit(
                                audioAt: url,
                                title: session.title,
                                contentType: "audio/mp4",
                                recordedAt: session.startedAt,
                                durationSeconds: seconds,
                                source: "recorder"
                            )
                            self.session = nil
                            self.clearSessionFiles()
                            call.resolve(["id": item.id, "durationSeconds": seconds, "size": Double(item.size)])
                        } catch {
                            call.reject("Couldn't save the recording. It's still here; try Stop and save again.", "failed", error)
                        }
                    case .failure(let error):
                        call.reject("Couldn't save the recording. It's still here; try Stop and save again.", "failed", error)
                    }
                }
            }
        }
    }

    /// Deletes the recording in progress. The page asks the student first.
    @objc func discard(_ call: CAPPluginCall) {
        audioQueue.async {
            self.closePiece()
            self.stopTimers()
            self.session = nil
            self.clearSessionFiles()
            self.deactivateAudioSession()
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        audioQueue.async { call.resolve(self.statusObject()) }
    }

    private func statusObject() -> JSObject {
        guard let session = session else { return ["state": "idle", "elapsedSeconds": 0] }
        let closed = session.pieces.compactMap(\.seconds).reduce(0, +)
        let current = recorder?.currentTime ?? 0
        return [
            "state": recorder?.isRecording == true ? "recording" : "paused",
            "elapsedSeconds": closed + current,
            "interrupted": session.interrupted,
            "recovered": session.recovered,
            "title": session.title
        ]
    }

    // MARK: - Pieces

    private func pieceURL(_ file: String) -> URL? {
        SharedInbox.recordingDirectory?.appendingPathComponent(file)
    }

    /// Starts recording a new piece and starts the timer that rolls it over.
    private func startPiece() throws {
        guard var session = session, let directory = SharedInbox.recordingDirectory else { throw InboxError.unavailable }
        let file = "piece-\(UUID().uuidString).m4a"
        let recorder = try AVAudioRecorder(url: directory.appendingPathComponent(file), settings: settings)
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        guard recorder.record() else { throw InboxError.unavailable }
        session.pieces.append(Piece(file: file, seconds: nil))
        self.session = session
        self.recorder = recorder
        saveSession()
        startPieceTimer()
    }

    /// Closes the piece being recorded, which makes its file playable.
    private func closePiece() {
        pieceTimer?.cancel()
        pieceTimer = nil
        guard let recorder = recorder else { return }
        let seconds = recorder.currentTime
        self.recorder = nil
        recorder.stop()
        if var session = session, let last = session.pieces.indices.last, session.pieces[last].file == recorder.url.lastPathComponent {
            session.pieces[last].seconds = seconds
            self.session = session
        }
        saveSession()
    }

    /// Every couple of minutes: close this piece and go straight on in a new one.
    private func startPieceTimer() {
        pieceTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: audioQueue)
        timer.schedule(deadline: .now() + .seconds(pieceSeconds), repeating: .seconds(pieceSeconds))
        timer.setEventHandler { [weak self] in
            guard let self = self, self.recorder?.isRecording == true else { return }
            self.closePiece()
            do {
                try self.startPiece()
            } catch {
                self.pauseForInterruption()
            }
        }
        timer.resume()
        pieceTimer = timer
    }

    /// The pieces that can be played, with their lengths. A piece cut off
    /// by Campus OS closing can't be read and is left out.
    private func readablePieces(of session: Session) -> [(url: URL, seconds: Double)] {
        session.pieces.compactMap { piece in
            guard let url = pieceURL(piece.file),
                  FileManager.default.fileExists(atPath: url.path),
                  let file = try? AVAudioFile(forReading: url),
                  file.length > 0 else { return nil }
            return (url, Double(file.length) / file.fileFormat.sampleRate)
        }
    }

    /// One file from the pieces, in the inbox's folder.
    private func join(_ urls: [URL], completion: @escaping (Result<URL, Error>) -> Void) {
        do {
            let output = try SharedInbox.newAudioURL(fileExtension: "m4a")
            if urls.count == 1 {
                try FileManager.default.copyItem(at: urls[0], to: output)
                completion(.success(output))
                return
            }
            let composition = AVMutableComposition()
            guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw InboxError.unavailable
            }
            Task {
                do {
                    var cursor = CMTime.zero
                    for url in urls {
                        let asset = AVURLAsset(url: url)
                        guard let source = try await asset.loadTracks(withMediaType: .audio).first else { continue }
                        let duration = try await asset.load(.duration)
                        try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
                        cursor = cursor + duration
                    }
                    self.export(composition, to: output, preset: AVAssetExportPresetPassthrough) { result in
                        if case .success = result { return completion(result) }
                        // Some joins can't be copied as-is; re-encoding always works.
                        try? FileManager.default.removeItem(at: output)
                        self.export(composition, to: output, preset: AVAssetExportPresetAppleM4A, completion: completion)
                    }
                } catch {
                    completion(.failure(error))
                }
            }
        } catch {
            completion(.failure(error))
        }
    }

    private func export(_ asset: AVAsset, to output: URL, preset: String, completion: @escaping (Result<URL, Error>) -> Void) {
        guard let exporter = AVAssetExportSession(asset: asset, presetName: preset) else {
            completion(.failure(InboxError.unavailable))
            return
        }
        exporter.outputURL = output
        exporter.outputFileType = .m4a
        exporter.exportAsynchronously {
            if exporter.status == .completed {
                completion(.success(output))
            } else {
                completion(.failure(exporter.error ?? InboxError.unavailable))
            }
        }
    }

    // MARK: - Saved state

    private var sessionFile: URL? {
        SharedInbox.recordingDirectory?.appendingPathComponent("session.json")
    }

    private func saveSession() {
        guard let file = sessionFile else { return }
        guard let session = session else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(session).write(to: file, options: .atomic)
    }

    /// On launch: a recording that was going when Campus OS closed comes back
    /// paused, with whatever of it can still be played.
    private func restoreSession() {
        guard let file = sessionFile, let data = try? Data(contentsOf: file) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard var saved = try? decoder.decode(Session.self, from: data) else { return }
        let playable = readablePieces(of: saved)
        guard !playable.isEmpty else {
            // Nothing in it can be played, so there's nothing to give back.
            clearSessionFiles()
            return
        }
        saved.pieces = playable.map { Piece(file: $0.url.lastPathComponent, seconds: $0.seconds) }
        saved.interrupted = true
        saved.recovered = true
        session = saved
        saveSession()
    }

    /// Deletes the pieces and the saved state (after Stop or Discard).
    private func clearSessionFiles() {
        guard let directory = SharedInbox.recordingDirectory,
              let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
        for name in names {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    // MARK: - Audio session

    private func activateAudioSession() throws {
        let audio = AVAudioSession.sharedInstance()
        // Mixing with other audio means a video or an ad in another app
        // doesn't interrupt the recording. Calls and Siri still do.
        try audio.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers])
        try audio.setActive(true)
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func stopTimers() {
        meterTimer?.cancel()
        meterTimer = nil
        pieceTimer?.cancel()
        pieceTimer = nil
    }

    /// Sends the input level about ten times a second for the level meter,
    /// only while the app is on screen.
    private func startMeter() {
        meterTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: audioQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in
            guard let self = self, self.appIsActive, let recorder = self.recorder, recorder.isRecording else { return }
            recorder.updateMeters()
            let level = pow(10, Double(recorder.averagePower(forChannel: 0)) / 20)
            self.notifyListeners("level", data: ["level": level])
        }
        timer.resume()
        meterTimer = timer
    }

    // MARK: - Interruptions

    /// Closes the current piece so it's safe, marks the recording paused,
    /// tells the page, and, with Campus OS in the background, tells the
    /// student.
    private func pauseForInterruption() {
        guard session != nil else { return }
        closePiece()
        session?.interrupted = true
        saveSession()
        notifyListeners("stateChange", data: statusObject())
        if !appIsActive { postPausedNotification() }
    }

    /// A call (or another app that won't share the audio) pauses the
    /// recording. It picks back up when the system says it's fine to;
    /// otherwise it stays paused and the page shows Resume.
    @objc private func handleInterruption(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let optionsRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        audioQueue.async {
            guard let session = self.session else { return }
            switch type {
            case .began:
                if self.recorder != nil { self.pauseForInterruption() }
            case .ended:
                guard session.interrupted, self.recorder == nil,
                      AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume) else { return }
                if (try? self.activateAudioSession()) != nil, (try? self.startPiece()) != nil {
                    self.session?.interrupted = false
                    self.saveSession()
                    self.startMeter()
                    self.notifyListeners("stateChange", data: self.statusObject())
                }
            @unknown default:
                return
            }
        }
    }

    /// iOS restarted its audio system: the recorder is gone. Keep what's
    /// recorded and wait for Resume.
    @objc private func handleMediaServicesReset() {
        audioQueue.async {
            guard self.session != nil else { return }
            self.recorder = nil
            self.pauseForInterruption()
        }
    }

    /// The system stopped a piece on its own (not Stop, Pause or a rollover).
    public func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        audioQueue.async {
            guard recorder === self.recorder else { return }
            self.pauseForInterruption()
        }
    }

    public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        audioQueue.async {
            guard recorder === self.recorder else { return }
            self.pauseForInterruption()
        }
    }

    private func postPausedNotification() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let content = UNMutableNotificationContent()
            content.title = "Recording paused"
            content.body = "A call or another app interrupted your lecture recording. What's recorded so far is safe. Open Campus OS to keep recording."
            content.sound = .default
            center.add(UNNotificationRequest(identifier: "recording-paused", content: content, trigger: nil))
        }
    }

    private func requestPermission(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: completion)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(completion)
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
