import Capacitor
import UIKit
import WebKit

/// The app's web view, plus the native features the website uses when it
/// runs inside the app: the recordings inbox, background recording, Gmail
/// sign-in and App Store subscriptions.
class CampusBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SharedInboxPlugin())
        bridge?.registerPluginInstance(NativeRecorderPlugin())
        bridge?.registerPluginInstance(AuthSessionPlugin())
        bridge?.registerPluginInstance(NativeStorePlugin())
    }

    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        // Match the launch screen while the first page loads, instead of
        // flashing white in dark mode.
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        return webView
    }
}
