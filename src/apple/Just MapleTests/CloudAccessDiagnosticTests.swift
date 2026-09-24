import CloudKit
import Testing
@testable import Just_Maple

@Test func cloudDiagnosticReportsFailuresWithoutPrivateErrorBodies() async {
    let error = CKError(.serverRejectedRequest, userInfo: [NSLocalizedDescriptionKey: "PRIVATE SERVER BODY"])
    let failure = await CloudAccessDiagnostic.inspect("private zone enumeration") { throw error }
    #expect(!failure.succeeded)
    #expect(failure.count == nil)
    #expect(failure.error?.contains("PRIVATE SERVER BODY") == false)
    let success = await CloudAccessDiagnostic.inspect("public default zone") { 1 }
    #expect(success.succeeded)
    #expect(success.count == 1)
    #expect(success.error == nil)
}
