import XCTest

final class Just_Maple_iPhoneUITests: XCTestCase {
    @MainActor func testBundledAngularLoadsAndCapturePersists()throws {
        let app=XCUIApplication();app.launchArguments=["--companion-ui-test"];app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout:20))
        XCTAssertTrue(app.webViews.staticTexts["Your overview."].waitForExistence(timeout:20))
        XCTAssertFalse(app.webViews.buttons["Use iCloud"].exists)
        XCTAssertFalse(app.webViews.buttons["Pause connection"].exists)
        app.webViews.buttons["Capture"].tap()
        let field=app.webViews.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout:20))
        let note="Synthetic UI capture "+UUID().uuidString
        field.tap();field.typeText(note)
        let save=app.webViews.buttons["Save on iPhone"]
        XCTAssertTrue(save.waitForExistence(timeout:5));save.tap()
        XCTAssertTrue(app.webViews.staticTexts["Saved on this iPhone."].waitForExistence(timeout:5))
        app.terminate();app.launch()
        XCTAssertTrue(app.webViews.buttons["Capture"].waitForExistence(timeout:20))
        app.webViews.buttons["Capture"].tap()
        XCTAssertTrue(app.webViews.staticTexts[note].waitForExistence(timeout:20))
        XCTAssertFalse(app.webViews.buttons["Use a pairing code"].exists)
        app.webViews.buttons["Notebooks"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Notes & notebooks"].waitForExistence(timeout:10))
        XCTAssertTrue(app.webViews.buttons["Connect folder"].exists)
        XCTAssertTrue(app.webViews.staticTexts["iCloud Drive is unavailable. Connect a folder from Files to start."].exists)
        let screenshot=XCTAttachment(screenshot:app.screenshot());screenshot.name="Companion screen";screenshot.lifetime = .keepAlways;add(screenshot)
    }
}
