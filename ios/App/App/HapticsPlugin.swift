import Capacitor
import UIKit

/// A tap of the Taptic Engine, for checking something off and starting or
/// stopping a recording (src/lib/native-app.ts haptic()). On a Mac it does
/// nothing.
@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "Haptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise)
    ]

    @objc func impact(_ call: CAPPluginCall) {
        let style: UIImpactFeedbackGenerator.FeedbackStyle
        switch call.getString("style") {
        case "heavy": style = .heavy
        case "medium": style = .medium
        default: style = .light
        }
        DispatchQueue.main.async {
            let generator = UIImpactFeedbackGenerator(style: style)
            generator.prepare()
            generator.impactOccurred()
            call.resolve()
        }
    }
}
