//
//  ComposeLinksTests.swift
//  JapaneseMapleTests
//
//  Drafted replies: the web view hands Messages and Mail compose links to the system,
//  but only when the person tapped one in the app's own page.
//

import Foundation
import Testing
import WebKit

@testable import JapaneseMaple

struct ComposeLinksTests {
    let app = ComposeLinks.Origin(scheme: "https", host: "justmaple.app", port: nil)
    let sms = URL(string: "sms:+15185550100&body=see%20you%20saturday")!

    func opens(
        _ url: URL,
        _ type: WKNavigationType = .linkActivated,
        mainFrame: Bool = true,
        from source: ComposeLinks.Origin? = nil
    ) -> Bool {
        ComposeLinks.shouldOpenExternally(
            url, navigationType: type, isMainFrame: mainFrame,
            sourceOrigin: source ?? app, appOrigin: app)
    }

    @Test func messagesAndMailLinksAreCompose() throws {
        let links = [
            "sms:+15185550100&body=see%20you%20saturday",
            "sms:/open?addresses=%2B15185550100,%2B15185550199&body=hi",
            "mailto:jen@example.com?subject=Re%3A%20Dinner&body=Thursday%20works.",
            "MAILTO:jen@example.com",
        ]
        for link in links {
            #expect(ComposeLinks.isCompose(try #require(URL(string: link))), "\(link)")
        }
    }

    @Test func everythingElseStaysInTheWebView() throws {
        let links = [
            "https://justmaple.app/notebook/1",
            "imessage:jen@example.com",
            "about:blank",
            "javascript:alert(1)",
            "file:///etc/hosts",
            "tel:+15185550100",
        ]
        for link in links {
            let url = try #require(URL(string: link))
            #expect(!ComposeLinks.isCompose(url), "\(link)")
            #expect(!opens(url), "\(link)")
        }
    }

    @Test func aTapInTheAppsOwnPageOpensIt() throws {
        #expect(opens(sms))
        #expect(opens(try #require(URL(string: "mailto:jen@example.com?body=hi"))))
        // The same origin written differently: case and the default port.
        #expect(opens(sms, from: ComposeLinks.Origin(scheme: "HTTPS", host: "JustMaple.app", port: 443)))
        #expect(
            ComposeLinks.Origin(try #require(URL(string: "http://localhost:4200/x")))
                == ComposeLinks.Origin(scheme: "http", host: "localhost", port: 4200))
    }

    @Test func scriptsRedirectsAndFormsDontOpenIt() {
        let types: [WKNavigationType] = [.other, .formSubmitted, .formResubmitted, .reload, .backForward]
        for type in types {
            #expect(!opens(sms, type), "\(type.rawValue)")
        }
    }

    @Test func framesAndOtherSitesDontOpenIt() {
        #expect(!opens(sms, mainFrame: false))
        #expect(!opens(sms, from: ComposeLinks.Origin(scheme: "https", host: "evil.example", port: nil)))
        #expect(!opens(sms, from: ComposeLinks.Origin(scheme: "http", host: "justmaple.app", port: nil)))
        #expect(!opens(sms, from: ComposeLinks.Origin(scheme: "https", host: "justmaple.app", port: 8443)))
        // No known origin (the offline page has none): nothing opens.
        #expect(
            !ComposeLinks.shouldOpenExternally(
                sms, navigationType: .linkActivated, isMainFrame: true,
                sourceOrigin: nil, appOrigin: app))
        #expect(
            !ComposeLinks.shouldOpenExternally(
                sms, navigationType: .linkActivated, isMainFrame: true,
                sourceOrigin: app, appOrigin: nil))
    }
}
