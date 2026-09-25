# Automatic classification and History inbox

## Problem and behavior

Jev previously processed one observation, then awaited fact extraction, task extraction, connector polling, and a three-second sleep. A large telemetry backlog and slow downstream requests delayed new email before classification began.

Classification now runs in its own app task with two bounded workers. Fact/task extraction and connector polling run independently. SQLite records connector service order atomically with each lease: connectors rotate, with three newest eligible observations followed by one oldest per connector. Retry deadlines, lease tokens, the 30-day model window, and transactional decision application remain enforced. No queue records are deleted or reclassified with fixture answers.

History now presents source observations as an inbox with sender, subject, preview, time, processing status, and learned activity tags. Lightweight cursor pages and virtual scrolling avoid transferring and rendering entire decision contexts. Source inspection is on demand. Global diagnostic snapshots are bounded to 30 recent decisions and 100 recent queue rows, while aggregate processing counts remain complete.

## Verification

Regression coverage checks connector fairness, old-work progress, scoped retries, concurrent leases, and classification while downstream extraction is busy. History tests cover paging and status projection. Final checks passed: 169 core tests, 28 transport tests, 71 Angular tests, 44 macOS native tests, and the CLI build. History includes a regression ensuring 1,000 loaded rows render fewer than 50 DOM rows.

A live app restart activated the new scheduler. Gmail's completed classification count increased from 319 to 342 during live verification; 14 of the original 50 pasted messages had completed classification at that check, with recorded service across multiple connectors. This is evidence of restored queue progress, not a throughput guarantee or extraction-quality benchmark. The existing backlog still needs time to drain.
