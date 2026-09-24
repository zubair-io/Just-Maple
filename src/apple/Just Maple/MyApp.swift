import SwiftUI
import MapleCore

@main
struct JustMapleApp: App {
    @State private var model = AppModel()
    var body: some Scene {
        Window("Just Maple", id: "main") {
            WebShell(model: model)
                .frame(minWidth: 940, minHeight: 680)
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing") else { return }
                    if ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics") {
                        let results = await CloudAccessDiagnostic.run()
                        if let data = try? JSONEncoder().encode(results), let text = String(data: data, encoding: .utf8) {
                            print("MAPLE_CLOUD_DIAGNOSTICS=" + text)
                            fflush(stdout)
                        }
                        NSApplication.shared.terminate(nil)
                        return
                    }
                    if ProcessInfo.processInfo.arguments.contains("--screening-evaluation") {
                        do {
                            guard let key = try KeyStore.read(allowAuthentication: false) else { throw MapleError.invalid("No saved Jev credential is available.") }
                            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Just Maple/Evaluations/screening-" + UUID().uuidString)
                            let report = try await MessageScreeningEvaluation.run(classifier: TypeSafeClassifier(apiKey: key), directory: directory)
                            if let data = try? JSONEncoder().encode(report), let text = String(data: data, encoding: .utf8) { print("MAPLE_SCREENING_EVALUATION=" + text) }
                            print("MAPLE_SCREENING_DIRECTORY=" + directory.path)
                        } catch { print("MAPLE_SCREENING_EVALUATION_FAILED: " + error.localizedDescription) }
                        fflush(stdout)
                        NSApplication.shared.terminate(nil)
                        return
                    }
                    await model.start()
                    while !Task.isCancelled {
                        await model.pollMessages()
                        await model.pollApple()
                        await model.pollHome()
                        await model.pollGoogle()
                        try? await Task.sleep(for: .seconds(3))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics"), !ProcessInfo.processInfo.arguments.contains("--screening-evaluation") else {return}
                    while !Task.isCancelled {
                        await model.tick()
                        try? await Task.sleep(for: .seconds(0.25))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics"), !ProcessInfo.processInfo.arguments.contains("--screening-evaluation") else {return}
                    while !Task.isCancelled {
                        await model.extractionTick()
                        try? await Task.sleep(for: .seconds(1))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics"), !ProcessInfo.processInfo.arguments.contains("--screening-evaluation") else {return}
                    while !Task.isCancelled {
                        await model.indexTick()
                        try? await Task.sleep(for:.seconds(1))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics"), !ProcessInfo.processInfo.arguments.contains("--screening-evaluation") else {return}
                    while !Task.isCancelled {
                        await model.stateTick()
                        try? await Task.sleep(for:.seconds(5))
                    }
                }
        }
        .defaultSize(width: 1280, height: 880)
    }
}
