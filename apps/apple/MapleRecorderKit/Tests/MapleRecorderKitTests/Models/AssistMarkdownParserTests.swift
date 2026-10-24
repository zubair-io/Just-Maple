import Testing
@testable import MapleRecorderKit

struct AssistMarkdownParserTests {
    @Test func parsesHeadingsListsAndFencedCode() {
        let markdown = """
        ## Components

        1. **Navbar Component**
        - Reusable post

        ```javascript
        function Navbar() {
          return <nav>App Name</nav>;
        }
        ```
        """

        #expect(
            AssistMarkdownParser.parse(markdown) == [
                .heading(level: 2, text: "Components"),
                .orderedListItem(number: 1, text: "**Navbar Component**"),
                .unorderedListItem("Reusable post"),
                .code(
                    language: "javascript",
                    content: "function Navbar() {\n  return <nav>App Name</nav>;\n}"
                ),
            ]
        )
    }

    @Test func preservesUnclosedCodeFence() {
        let markdown = """
        Before

        ```swift
        let value = 42
        """

        #expect(
            AssistMarkdownParser.parse(markdown) == [
                .paragraph("Before"),
                .code(language: "swift", content: "let value = 42"),
            ]
        )
    }
}
