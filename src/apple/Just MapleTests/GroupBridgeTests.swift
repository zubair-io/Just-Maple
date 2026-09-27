import Foundation
import Testing
@testable import Just_Maple
struct GroupBridgeTests {
    @Test func malformedWindowNeverSilentlyDisablesSuggestions()throws {
        #expect(try decodeGroupingWindow(nil)==nil)
        #expect(try decodeGroupingWindow(NSNull())==nil)
        #expect(try decodeGroupingWindow(NSNumber(value:3600))==3600)
        for value:Any in ["3600",true,0,-1,Double.infinity] {#expect(throws:Error.self){try decodeGroupingWindow(value)}}
    }
}
