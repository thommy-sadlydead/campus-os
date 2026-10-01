import AVFoundation
import Capacitor
import UIKit

/// Records lectures natively, so recording keeps going with the screen
/// locked or another app open (UIBackgroundModes "audio"), which a web
/// page's recorder can't do. The finished recording goes into the shared
/// inbox, and the web app uploads it the same way as one shared from Voice
/// Memos.
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

    private let audioQueue = DispatchQueue(label: "com.campusos.recorder")
    // Everything below is only touched on audioQueue.
    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var title = "Lecture"
    private var meterTimer: DispatchSourceTimer?
    private var pausedByInterruption = false
    private var appIsActive = true

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance())
        center.addObserver(self, selector: #selector(appBecameActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appResignedActive),
                           name: UIApplication.willResignActiveNotification, object: nil)
    }

    @objc private func appBecameActive() { audioQueue.async { self.appIsActive = true } }
    @objc private func appResignedActive() { audioQueue.async { self.appIsActive = false } }

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
        if recorder != nil {
            call.reject("Already recording.", "busy")
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let url = try SharedInbox.newAudioURL(fileExtension: "m4a")
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            guard recorder.record() else {
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                call.reject("Couldn't start the microphone. Make sure no other app is using it, then try again.", "failed")
                return
            }
            self.recorder = recorder
            self.title = title
            startedAt = Date()
            pausedByInterruption = false
            startMeter()
            call.resolve(statusObject())
        } catch {
            call.reject("Couldn't start recording.", "failed", error)
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        audioQueue.async {
            self.recorder?.pause()
            call.resolve(self.statusObject())
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        audioQueue.async {
            guard let recorder = self.recorder else {
                call.reject("Not recording.", "idle")
                return
            }
            try? AVAudioSession.sharedInstance().setActive(true)
            self.pausedByInterruption = false
            if recorder.record() {
                call.resolve(self.statusObject())
            } else {
                call.reject("Couldn't resume recording.", "failed")
            }
        }
    }

    /// Finishes the file and puts it in the inbox; resolves with its id.
    @objc func stop(_ call: CAPPluginCall) {
        audioQueue.async {
            guard let recorder = self.recorder else {
                call.reject("Not recording.", "idle")
                return
            }
            let duration = recorder.currentTime
            let url = recorder.url
            let startedAt = self.startedAt
            let title = self.title
            recorder.stop()
            self.finishSession()
            do {
                let item = try SharedInbox.commit(
                    audioAt: url,
                    title: title,
                    contentType: "audio/mp4",
                    recordedAt: startedAt,
                    durationSeconds: duration,
                    source: "recorder"
                )
                call.resolve(["id": item.id, "durationSeconds": duration, "size": Double(item.size)])
            } catch {
                call.reject("Couldn't save the recording.", "failed", error)
            }
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        audioQueue.async {
            if let recorder = self.recorder {
                recorder.stop()
                recorder.deleteRecording()
            }
            self.finishSession()
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        audioQueue.async { call.resolve(self.statusObject()) }
    }

    private func statusObject() -> JSObject {
        guard let recorder = recorder else { return ["state": "idle", "elapsedSeconds": 0] }
        return [
            "state": recorder.isRecording ? "recording" : "paused",
            "elapsedSeconds": recorder.currentTime,
            "interrupted": pausedByInterruption
        ]
    }

    private func finishSession() {
        meterTimer?.cancel()
        meterTimer = nil
        recorder = nil
        startedAt = nil
        pausedByInterruption = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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

    /// A phone call or alarm pauses the recording. Pick it back up when
    /// the system says it's fine to; otherwise it stays paused and the page
    /// shows Resume.
    @objc private func handleInterruption(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let optionsRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        audioQueue.async {
            guard let recorder = self.recorder else { return }
            switch type {
            case .began:
                self.pausedByInterruption = true
            case .ended:
                if AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    if recorder.record() { self.pausedByInterruption = false }
                }
            @unknown default:
                return
            }
            self.notifyListeners("stateChange", data: self.statusObject())
        }
    }

    public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        notifyListeners("stateChange", data: ["state": "error", "message": error?.localizedDescription ?? "Recording failed."])
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
