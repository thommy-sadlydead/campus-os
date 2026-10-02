import Capacitor
import StoreKit

/// Apple in-app purchase for the subscription (StoreKit 2). Apple requires
/// it for subscriptions bought inside the app; the website uses Stripe.
/// Every purchase carries the account's appAccountToken, and every result
/// goes back as Apple's signed JWS, which the server verifies before it
/// unlocks anything (src/lib/apple-iap.ts).
@objc(NativeStorePlugin)
public class NativeStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeStorePlugin"
    public let jsName = "NativeStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private var updates: Task<Void, Never>?

    override public func load() {
        // Renewals, refunds and Ask to Buy approvals arrive here, including
        // ones that happened while the app was closed. Apple expects every
        // app to listen for them and finish each transaction.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result else { continue }
                await transaction.finish()
                self?.notifyListeners("transaction", data: ["jws": result.jwsRepresentation])
            }
        }
    }

    deinit {
        updates?.cancel()
    }

    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve([
                    "products": products.map { product in
                        ["id": product.id, "displayName": product.displayName, "displayPrice": product.displayPrice]
                    }
                ])
            } catch {
                call.reject("Couldn't load App Store prices.", "unavailable", error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"),
              let token = call.getString("accountToken").flatMap(UUID.init(uuidString:)) else {
            call.reject("A product and an account token are required.", "invalid")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("That subscription isn't available.", "unavailable")
                    return
                }
                switch try await product.purchase(options: [.appAccountToken(token)]) {
                case .success(let result):
                    guard case .verified(let transaction) = result else {
                        call.reject("The App Store couldn't verify the purchase.", "unverified")
                        return
                    }
                    await transaction.finish()
                    call.resolve(["status": "purchased", "jws": result.jwsRepresentation])
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject("The purchase didn't go through.", "failed", error)
            }
        }
    }

    /// Every subscription this Apple ID currently has, for "Restore purchases".
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            // Asks the App Store for the latest records. Can prompt for the
            // Apple ID password; if that's cancelled, what's on the device
            // still counts.
            try? await AppStore.sync()
            var transactions: [String] = []
            for await result in Transaction.currentEntitlements {
                if case .verified = result {
                    transactions.append(result.jwsRepresentation)
                }
            }
            call.resolve(["transactions": transactions])
        }
    }
}
