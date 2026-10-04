# False writing-change error during note opening

The shared editor called Tiptap `setEditable(editable)` when loading or a document action changed its read-only input. The installed Tiptap implementation defaults `emitUpdate` to true and emits an update even when the document has not changed. Maple's update handler serialized the note and emitted `changed`; the note service correctly treated that event as writing and rejected the late open response. Unlocking could emit another false edit.

The shared editor now calls `setEditable(editable, false)`. This fixes both Today and managed notebooks without weakening revision, generation, or real-edit protection. No files, dates, drafts, or processing state were rewritten for this repair.

Regression coverage uses the actual shared Tiptap editor connected to TodayDocumentService, rather than an editor stub. Both same-note and different-day opens failed before the fix and pass after it. Tests cover lock/unlock during actions and loading, unchanged Markdown/editVersion, no spurious draft or commit, successful navigation, and legitimate editing afterward. Existing late-writing, failed-save, cancellation, and stale-response tests remain enabled.

Validation: 360 Angular tests, 453 core tests, 30 companion transport tests, and 79 Mac/Xcode tests passed. Logs are `.build/opening-{angular-tests,core-tests,mac-tests}.log`. CLI and fresh signed Mac build results are recorded in `.build/opening-{cli-build,mac-build}.log`.

Both builds passed. Strict deep signature verification passed for `.build/xcode/Build/Products/Debug/Just Maple.app`, preserving bundle `com.just.maple.JapaneseMaple` and development team `QREP66JW5U`.

Read-only inspection confirmed the reported live state: the route requested October 3 while the preserved editor remained on September 30 with this error. The running writing session is left open; it must load the new bundle on a normal relaunch to use this repair.
