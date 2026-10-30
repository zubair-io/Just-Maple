import XCTest

final class JustMapleUITests: XCTestCase {
    func testBundledEditorAndRecorderLaunch() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.radioButtons["Notes"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.textFields["Server address"].exists)
        app.radioButtons["Recorder"].click()
        XCTAssertTrue(app.buttons["Prepare on-device transcription models"].waitForExistence(timeout: 10))
    }
}
