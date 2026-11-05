// swift-tools-version:5.3
// Capacitor 8.5.2 (capacitor-swift-pm), with a Mac Catalyst slice added.
// Made by ios/scripts/build-capacitor-catalyst.py; don't edit by hand. The
// iPhone and Simulator slices are Capacitor's own release binaries.

import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
