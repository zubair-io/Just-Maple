//
//  ContentView.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @StateObject private var webViewController = WebViewController()

    var body: some View {
        VStack(spacing: 0) {
            WebViewContainer(webViewController: webViewController)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}
