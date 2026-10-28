//
//  ComposeLinksTests.swift
//  JapaneseMapleTests
//
//  Drafted replies: the web view hands Messages and Mail compose links to the system,
//  and keeps every other link (the app's own pages) to itself.
//

import Foundation
import Testing

@testable import JapaneseMaple

struct ComposeLinksTests {
    @Test func messagesAndMailLinksOpenOutsideTheWebView() throws {
        let links = [
            "sms:+15185550100&body=see%20you%20saturday",
            "sms:/open?addresses=+15185550100,+15185550199&body=hi",
            "mailto:jen@example.com?subject=Re%3A%20Dinner&body=Thursday%20works.",
            "MAILTO:jen@example.com",
            "imessage:jen@example.com",
        ]
        for link in links {
            #expect(ComposeLinks.isCompose(try #require(URL(string: link))), "\(link)")
        }
    }

    @Test func everythingElseStaysInTheWebView() throws {
        let links = [
            "https://justmaple.app/notebook/1",
            "maple://app/index.html",
            "about:blank",
            "javascript:alert(1)",
            "file:///etc/hosts",
            "tel:+15185550100",
        ]
        for link in links {
            #expect(!ComposeLinks.isCompose(try #require(URL(string: link))), "\(link)")
        }
    }
}
