import Foundation

/// Monitors iCloud Drive for changes to `.md` recording files and triggers store reloads.
/// Uses `NSMetadataQuery` scoped to the ubiquitous documents directory.
final class ICloudSyncMonitor {
    private let store: RecordingStore
    private var query: NSMetadataQuery?
    private var debounceWorkItem: DispatchWorkItem?

    init(store: RecordingStore) {
        self.store = store
    }

    func startMonitoring() {
        guard query == nil else { return }

        let metadataQuery = NSMetadataQuery()
        metadataQuery.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        metadataQuery.predicate = NSPredicate(format: "%K LIKE '*.md'", NSMetadataItemFSNameKey)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(queryDidUpdate(_:)),
            name: .NSMetadataQueryDidFinishGathering,
            object: metadataQuery
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(queryDidUpdate(_:)),
            name: .NSMetadataQueryDidUpdate,
            object: metadataQuery
        )

        metadataQuery.start()
        query = metadataQuery
    }

    func stopMonitoring() {
        query?.stop()
        query = nil
        debounceWorkItem?.cancel()
        debounceWorkItem = nil
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func queryDidUpdate(_ notification: Notification) {
        debounceWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.store.loadRecordings()
        }
        debounceWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
    }

    deinit {
        stopMonitoring()
    }
}
