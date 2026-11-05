#!/usr/bin/env python3
"""
Builds Capacitor for the Mac (Mac Catalyst) and packages it with Capacitor's
own iPhone binaries, as ios/vendor/capacitor-swift-pm.

Why: Capacitor ships its iOS frameworks as binaries (the capacitor-swift-pm
package), and those have iPhone and Simulator slices only, so the app can't
be built for the Mac from them. This script:

  1. downloads the official Capacitor.xcframework and Cordova.xcframework for
     the version in node_modules/@capacitor/ios (the same files Swift
     Package Manager downloads), checking them against the checksums in
     that release's Package.swift;
  2. builds the two frameworks for Mac Catalyst from the source that ships in
     node_modules/@capacitor/ios (a small Xcode project generated below,
     with the same headers, module maps and resources as Capacitor's own
     build);
  3. puts each official xcframework back together with the Mac slice added,
     next to a Package.swift with the same name and products as
     capacitor-swift-pm;
  4. signs both xcframeworks with your own Apple Development or Distribution
     certificate. Apple lists Capacitor and Cordova as commonly used SDKs,
     and the App Store refuses a build whose copy of one is unsigned
     (ITMS-91065: Missing signature). Adding the Mac slice drops Ionic's own
     signature, so ours has to replace it.

The app's Xcode project references ios/vendor/capacitor-swift-pm as a local
package, which Xcode uses in place of the GitHub one everywhere (the app and
its Capacitor plugins). The iPhone and Simulator slices are Capacitor's own,
byte for byte, so the iPhone app is built exactly as before.

Run it again after upgrading @capacitor/ios:

    python3 ios/scripts/build-capacitor-catalyst.py

It signs with the first Apple Development (or Distribution) identity in your
keychain; set CAPACITOR_SIGN_IDENTITY to pick another. To sign the vendored
copies again without rebuilding them:

    python3 ios/scripts/build-capacitor-catalyst.py --sign-only
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CAP_IOS = os.path.join(ROOT, "node_modules", "@capacitor", "ios")
BUILD = os.path.join(ROOT, "ios", "build", "capacitor-catalyst")
VENDOR = os.path.join(ROOT, "ios", "vendor", "capacitor-swift-pm")


def run(*args, **kwargs):
    print("+", " ".join(args), flush=True)
    subprocess.run(args, check=True, **kwargs)


def fetch(url, dest=None):
    """curl, which uses the system's certificates (python.org builds may have none)."""
    args = ["curl", "-fsSL", "--retry", "3", url]
    if dest:
        subprocess.run(args + ["-o", dest], check=True)
        return None
    return subprocess.run(args, check=True, capture_output=True).stdout.decode()


def version():
    with open(os.path.join(CAP_IOS, "package.json")) as f:
        return json.load(f)["version"]


# ---------------------------------------------------------------------------
# 1. The official binaries, checked against the release's own checksums.
# ---------------------------------------------------------------------------

def official_xcframeworks(ver, into):
    manifest_url = f"https://raw.githubusercontent.com/ionic-team/capacitor-swift-pm/{ver}/Package.swift"
    manifest = fetch(manifest_url)
    targets = re.findall(r'name:\s*"(\w+)",\s*url:\s*"([^"]+)",\s*checksum:\s*"([0-9a-f]{64})"', manifest)
    if {t[0] for t in targets} != {"Capacitor", "Cordova"}:
        sys.exit(f"Unexpected capacitor-swift-pm {ver} manifest")
    paths = {}
    for name, url, checksum in targets:
        zip_path = os.path.join(into, f"{name}.xcframework.zip")
        print(f"Downloading {url}", flush=True)
        fetch(url, zip_path)
        with open(zip_path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        if digest != checksum:
            sys.exit(f"{name}.xcframework.zip checksum mismatch: {digest} != {checksum}")
        # ditto keeps the framework's symlinks and permissions.
        run("ditto", "-x", "-k", zip_path, into)
        paths[name] = os.path.join(into, f"{name}.xcframework")
    return paths


# ---------------------------------------------------------------------------
# 2. The Mac Catalyst slice, from source.
# ---------------------------------------------------------------------------

_ids = iter(range(1, 10_000))


def oid():
    return f"CA7A1157{next(_ids):016X}"


def plist_list(items):
    """An OpenStep list: (a, b, ) or ( ) when empty."""
    return "(" + "".join(f"{i}, " for i in items) + ")"


def q(value):
    if re.fullmatch(r"[A-Za-z0-9_$./]+", value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def generate_project(path):
    cordova_dir = os.path.join(CAP_IOS, "CapacitorCordova", "CapacitorCordova")
    capacitor_dir = os.path.join(CAP_IOS, "Capacitor", "Capacitor")

    def files(base, exts):
        out = []
        for dirpath, _, names in os.walk(base):
            for n in sorted(names):
                if os.path.splitext(n)[1] in exts:
                    out.append(os.path.join(dirpath, n))
        return sorted(out)

    objects = []
    file_refs = {}

    def file_ref(p):
        if p not in file_refs:
            i = oid()
            ext = os.path.splitext(p)[1]
            kind = {
                ".swift": "sourcecode.swift",
                ".m": "sourcecode.c.objc",
                ".h": "sourcecode.c.h",
                ".js": "sourcecode.javascript",
                ".xcprivacy": "text.xml",
            }.get(ext, "text")
            objects.append(f"{i} = {{isa = PBXFileReference; lastKnownFileType = {kind}; path = {q(p)}; sourceTree = \"<absolute>\"; }};")
            file_refs[p] = i
        return file_refs[p]

    def build_file(ref, attributes=None):
        i = oid()
        settings = f" settings = {{ATTRIBUTES = {plist_list(attributes)}; }};" if attributes else ""
        objects.append(f"{i} = {{isa = PBXBuildFile; fileRef = {ref};{settings} }};")
        return i

    def phase(isa, build_files):
        i = oid()
        objects.append(f"{i} = {{isa = {isa}; buildActionMask = 2147483647; files = {plist_list(build_files)}; runOnlyForDeploymentPostprocessing = 0; }};")
        return i

    def config_list(settings_by_config):
        configs = []
        for name, settings in settings_by_config.items():
            i = oid()
            body = " ".join(f"{k} = {q(v) if isinstance(v, str) else plist_list(q(x) for x in v)};" for k, v in settings.items())
            objects.append(f"{i} = {{isa = XCBuildConfiguration; buildSettings = {{ {body} }}; name = {name}; }};")
            configs.append(i)
        i = oid()
        objects.append(f"{i} = {{isa = XCConfigurationList; buildConfigurations = {plist_list(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
        return i

    common = {
        "SDKROOT": "iphoneos",
        "SUPPORTS_MACCATALYST": "YES",
        "IPHONEOS_DEPLOYMENT_TARGET": "15.0",
        "TARGETED_DEVICE_FAMILY": "1,2",
        "DEFINES_MODULE": "YES",
        "BUILD_LIBRARY_FOR_DISTRIBUTION": "YES",
        "SKIP_INSTALL": "NO",
        "CODE_SIGNING_ALLOWED": "NO",
        "CODE_SIGN_IDENTITY": "",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "CLANG_ENABLE_MODULES": "YES",
        "SWIFT_VERSION": "5.0",
        "MACH_O_TYPE": "mh_dylib",
        "DYLIB_INSTALL_NAME_BASE": "@rpath",
        "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks"],
        "VERSIONING_SYSTEM": "apple-generic",
        "CURRENT_PROJECT_VERSION": "1",
        "MARKETING_VERSION": "1.0",
        "GENERATE_INFOPLIST_FILE": "NO",
        "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
        "GCC_WARN_INHIBIT_ALL_WARNINGS": "YES",
        "SWIFT_SUPPRESS_WARNINGS": "YES",
    }

    targets = {}
    products = {}
    for name, src, bundle_id in [
        ("Cordova", cordova_dir, "com.getcapacitor.ios.CapacitorCordova"),
        ("Capacitor", capacitor_dir, "com.capacitorjs.ios.Capacitor"),
    ]:
        product = oid()
        objects.append(f"{product} = {{isa = PBXFileReference; explicitFileType = wrapper.framework; includeInIndex = 0; path = {name}.framework; sourceTree = BUILT_PRODUCTS_DIR; }};")
        products[name] = product

        headers = []
        for h in files(src, {".h"}):
            rel = os.path.relpath(h, src)
            if name == "Cordova":
                attrs = ["Public"] if rel.startswith("Classes/Public/") or rel == "CapacitorCordova.h" else None
            else:
                attrs = (
                    ["Private"] if rel == "CAPBridgedJSTypes.h"
                    else None if rel == "CAPBridgeViewController+CDVScreenOrientationDelegate.h"
                    else ["Public"]
                )
            headers.append(build_file(file_ref(h), attrs))
        sources = [build_file(file_ref(s)) for s in files(src, {".m", ".swift"})]
        resource_paths = [os.path.join(src, "PrivacyInfo.xcprivacy")]
        if name == "Capacitor":
            resource_paths.append(os.path.join(src, "assets", "native-bridge.js"))
        resources = [build_file(file_ref(r)) for r in resource_paths]
        link = [build_file(products["Cordova"])] if name == "Capacitor" else []

        settings = {
            **common,
            "PRODUCT_NAME": name,
            "PRODUCT_BUNDLE_IDENTIFIER": bundle_id,
            "INFOPLIST_FILE": os.path.join(src, "Info.plist"),
            "MODULEMAP_FILE": os.path.join(src, "Capacitor.modulemap" if name == "Capacitor" else "CapacitorCordova.modulemap"),
            "OTHER_LDFLAGS": ["$(inherited)", "-framework", "WebKit"],
        }
        cfg = config_list({"Release": settings, "Debug": settings})
        phases = [
            phase("PBXHeadersBuildPhase", headers),
            phase("PBXSourcesBuildPhase", sources),
            phase("PBXResourcesBuildPhase", resources),
            phase("PBXFrameworksBuildPhase", link),
        ]
        target = oid()
        targets[name] = (target, cfg, phases, product)

    # Capacitor builds after Cordova.
    proxy = oid()
    dependency = oid()
    project = oid()
    objects.append(f"{proxy} = {{isa = PBXContainerItemProxy; containerPortal = {project}; proxyType = 1; remoteGlobalIDString = {targets['Cordova'][0]}; remoteInfo = Cordova; }};")
    objects.append(f"{dependency} = {{isa = PBXTargetDependency; target = {targets['Cordova'][0]}; targetProxy = {proxy}; }};")
    for name, (target, cfg, phases, product) in targets.items():
        deps = [dependency] if name == "Capacitor" else []
        objects.append(
            f"{target} = {{isa = PBXNativeTarget; buildConfigurationList = {cfg}; buildPhases = {plist_list(phases)}; buildRules = ( ); "
            f"dependencies = {plist_list(deps)}; name = {name}; productName = {name}; productReference = {product}; "
            f"productType = \"com.apple.product-type.framework\"; }};"
        )

    products_group = oid()
    main_group = oid()
    objects.append(f"{products_group} = {{isa = PBXGroup; children = {plist_list(products.values())}; name = Products; sourceTree = \"<group>\"; }};")
    objects.append(f"{main_group} = {{isa = PBXGroup; children = {plist_list(list(file_refs.values()) + [products_group])}; sourceTree = \"<group>\"; }};")
    project_cfg = config_list({"Release": {"SDKROOT": "iphoneos"}, "Debug": {"SDKROOT": "iphoneos"}})
    objects.append(
        f"{project} = {{isa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = 1; LastUpgradeCheck = 2700; }}; buildConfigurationList = {project_cfg}; "
        f"compatibilityVersion = \"Xcode 14.0\"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, ); mainGroup = {main_group}; "
        f"productRefGroup = {products_group}; projectDirPath = \"\"; projectRoot = \"\"; targets = {plist_list(t[0] for t in targets.values())}; }};"
    )

    os.makedirs(os.path.join(path, "project.xcworkspace"), exist_ok=True)
    with open(os.path.join(path, "project.pbxproj"), "w") as f:
        f.write("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n")
        for o in objects:
            f.write(f"\t\t{o}\n")
        f.write(f"\t}};\n\trootObject = {project};\n}}\n")

    schemes = os.path.join(path, "xcshareddata", "xcschemes")
    os.makedirs(schemes, exist_ok=True)
    target_id, _, _, _ = targets["Capacitor"]
    with open(os.path.join(schemes, "Capacitor.xcscheme"), "w") as f:
        f.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2700" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "NO" buildForRunning = "YES" buildForProfiling = "NO" buildForArchiving = "YES" buildForAnalyzing = "NO">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{target_id}" BuildableName = "Capacitor.framework" BlueprintName = "Capacitor" ReferencedContainer = "container:CapacitorCatalyst.xcodeproj"/>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "NO"/>
</Scheme>
""")


def build_catalyst_slice():
    project = os.path.join(BUILD, "CapacitorCatalyst.xcodeproj")
    shutil.rmtree(BUILD, ignore_errors=True)
    os.makedirs(BUILD)
    generate_project(project)
    archive = os.path.join(BUILD, "Catalyst.xcarchive")
    run(
        "xcodebuild", "archive",
        "-project", project,
        "-scheme", "Capacitor",
        "-destination", "generic/platform=macOS,variant=Mac Catalyst",
        "-archivePath", archive,
        "-derivedDataPath", os.path.join(BUILD, "DerivedData"),
        "SKIP_INSTALL=NO",
        "BUILD_LIBRARY_FOR_DISTRIBUTION=YES",
        "-quiet",
    )
    frameworks = os.path.join(archive, "Products", "Library", "Frameworks")
    if not os.path.isdir(frameworks):
        frameworks = os.path.join(archive, "Products", "usr", "local", "lib")
    return {name: os.path.join(frameworks, f"{name}.framework") for name in ("Capacitor", "Cordova")}


# ---------------------------------------------------------------------------
# 3. Put each xcframework back together with the Mac slice.
# ---------------------------------------------------------------------------

def assemble(official, catalyst, ver):
    shutil.rmtree(VENDOR, ignore_errors=True)
    os.makedirs(VENDOR)
    for name in ("Capacitor", "Cordova"):
        xc = official[name]
        args = ["xcodebuild", "-create-xcframework"]
        for slice_dir in sorted(os.listdir(xc)):
            fw = os.path.join(xc, slice_dir, f"{name}.framework")
            if os.path.isdir(fw):
                args += ["-framework", fw]
        args += ["-framework", catalyst[name], "-output", os.path.join(VENDOR, f"{name}.xcframework")]
        run(*args)
    with open(os.path.join(VENDOR, "Package.swift"), "w") as f:
        f.write(f"""// swift-tools-version:5.3
// Capacitor {ver} (capacitor-swift-pm), with a Mac Catalyst slice added.
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
""")
    with open(os.path.join(VENDOR, "VERSION"), "w") as f:
        f.write(ver + "\n")


# 4. Sign both xcframeworks.
# ---------------------------------------------------------------------------

def signing_identity():
    chosen = os.environ.get("CAPACITOR_SIGN_IDENTITY", "").strip()
    if chosen:
        return chosen
    found = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning"], capture_output=True, text=True).stdout
    for kind in ("Apple Development", "Apple Distribution"):
        match = re.search(rf'"({kind}: [^"]+)"', found)
        if match:
            return match.group(1)
    sys.exit(
        "No Apple Development or Distribution certificate in the keychain. The App Store refuses\n"
        "unsigned Capacitor and Cordova xcframeworks (ITMS-91065), so sign in to Xcode with the\n"
        "developer account (Settings > Accounts > Manage Certificates) and run this again."
    )


def sign():
    identity = signing_identity()
    for name in ("Capacitor", "Cordova"):
        xc = os.path.join(VENDOR, f"{name}.xcframework")
        # A secure timestamp, like the one on Ionic's own release.
        run("codesign", "--force", "--timestamp", "--sign", identity, xc)
        run("codesign", "--verify", "--strict", "--verbose=2", xc)
    print(f"Signed with {identity}")


def main():
    if "--sign-only" in sys.argv[1:]:
        sign()
        return
    ver = version()
    with tempfile.TemporaryDirectory() as tmp:
        official = official_xcframeworks(ver, tmp)
        catalyst = build_catalyst_slice()
        assemble(official, catalyst, ver)
    sign()
    print(f"Capacitor {ver} with Mac Catalyst: {os.path.relpath(VENDOR, ROOT)}")


if __name__ == "__main__":
    main()
