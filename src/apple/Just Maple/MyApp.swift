import SwiftUI

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
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics") else {return}
                    while !Task.isCancelled {
                        await model.tick()
                        try? await Task.sleep(for: .seconds(0.25))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics") else {return}
                    while !Task.isCancelled {
                        await model.extractionTick()
                        try? await Task.sleep(for: .seconds(1))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics") else {return}
                    while !Task.isCancelled {
                        await model.indexTick()
                        try? await Task.sleep(for:.seconds(1))
                    }
                }
                .task {
                    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil, !ProcessInfo.processInfo.arguments.contains("--testing"), !ProcessInfo.processInfo.arguments.contains("--cloud-diagnostics") else {return}
                    while !Task.isCancelled {
                        await model.stateTick()
                        try? await Task.sleep(for:.seconds(5))
                    }
                }
        }
        .defaultSize(width: 1280, height: 880)
    }
}
