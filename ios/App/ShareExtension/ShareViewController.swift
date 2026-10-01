import AVFoundation
import UIKit
import UniformTypeIdentifiers
import UserNotifications

/// "Campus OS" in the share sheet of Voice Memos, Files and other apps that
/// share audio. Copies the recording into the app's inbox; the app then asks
/// which class it's for, with the class already picked from the student's
/// schedule by when it was recorded. A share extension can't open its app,
/// so it also posts a notification that does.
final class ShareViewController: UIViewController {
    private let card = UIView()
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        buildInterface()
        Task { await importAttachments() }
    }

    // MARK: - Import

    private func importAttachments() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
            .filter { audioType(of: $0) != nil }

        var added: [InboxItem] = []
        var failed = false
        for provider in providers {
            do {
                added.append(try await importAudio(from: provider))
            } catch {
                failed = true
            }
        }

        await MainActor.run {
            spinner.stopAnimating()
            if added.isEmpty {
                titleLabel.text = "Couldn't add that recording"
                detailLabel.text = failed
                    ? "Campus OS couldn't read the file. Try sharing it again, or upload it from the Record page."
                    : "There's no audio in what was shared."
            } else {
                titleLabel.text = added.count == 1 ? "Added to Campus OS" : "Added \(added.count) recordings"
                detailLabel.text = "Open Campus OS to choose the class. If your schedule shows a class at that time, it's already picked."
                notifyReady(added)
            }
            doneButton.isHidden = false
        }
    }

    private func audioType(of provider: NSItemProvider) -> String? {
        provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .audio) == true }
    }

    private func importAudio(from provider: NSItemProvider) async throws -> InboxItem {
        guard let typeIdentifier = audioType(of: provider) else { throw InboxError.missing }
        let type = UTType(typeIdentifier)
        let (destination, originalName): (URL, String) = try await withCheckedThrowingContinuation { continuation in
            // The file only exists while this callback runs, so copy it now.
            _ = provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                guard let url = url else {
                    continuation.resume(throwing: error ?? InboxError.missing)
                    return
                }
                do {
                    let ext = url.pathExtension.isEmpty ? (type?.preferredFilenameExtension ?? "m4a") : url.pathExtension
                    let destination = try SharedInbox.newAudioURL(fileExtension: ext)
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: (destination, url.deletingPathExtension().lastPathComponent))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        let asset = AVURLAsset(url: destination)
        let duration = try? await asset.load(.duration).seconds
        var recordedAt: Date?
        if let creation = try? await asset.load(.creationDate) {
            recordedAt = try? await creation.load(.dateValue)
        }

        // Voice Memos names the shared item after the recording; Files
        // doesn't, so fall back to the original file's name.
        let name = provider.suggestedName?.nonEmpty ?? originalName
        let title = (name as NSString).deletingPathExtension.nonEmpty ?? "Recording"
        do {
            return try SharedInbox.commit(
                audioAt: destination,
                title: title,
                contentType: type?.preferredMIMEType ?? "audio/mp4",
                recordedAt: recordedAt,
                durationSeconds: duration.flatMap { $0.isFinite ? $0 : nil },
                source: "share"
            )
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    /// A tap on this opens Campus OS on the Record page. Only shown if the
    /// student has allowed Campus OS notifications.
    private func notifyReady(_ items: [InboxItem]) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let content = UNMutableNotificationContent()
            content.title = items.count == 1 ? "Ready to add to a class" : "\(items.count) recordings ready"
            content.body = items.count == 1
                ? "Tap to choose the class for “\(items[0].title)”."
                : "Tap to choose their classes."
            content.userInfo = ["cap_extra": ["route": "/record"]]
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    // MARK: - Interface

    private func buildInterface() {
        view.backgroundColor = .systemBackground

        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        titleLabel.text = "Adding to Campus OS…"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = .secondaryLabel
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0

        spinner.startAnimating()

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        doneButton.isHidden = true
        doneButton.addTarget(self, action: #selector(done), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [spinner, titleLabel, detailLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 300),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20)
        ])
    }

    @objc private func done() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
