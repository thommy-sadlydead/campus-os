import AuthenticationServices
import Capacitor

/// Opens a sign-in page in the system's secure browser sheet and returns
/// the URL it finishes on. Google doesn't allow its sign-in inside an app's
/// own web view, so "Connect Gmail" goes through here in the app.
@objc(AuthSessionPlugin)
public class AuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "AuthSessionPlugin"
    public let jsName = "AuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString), url.scheme == "https" else {
            call.reject("A sign-in link is required.")
            return
        }
        let scheme = call.getString("callbackScheme") ?? "campusos"
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("Cancelled.", "cancelled")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in didn't finish.", "failed")
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Couldn't open the sign-in page.", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
