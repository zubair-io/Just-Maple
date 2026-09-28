# Just Maple

A local-first living notebook for Mac and iPhone. Each day opens to an editable note of writing, tasks and incoming context. Clear a block when it no longer needs attention, recover it in history, or move it to tomorrow. Existing connectors and evidence-backed intelligence maintain context behind the note. The app never automatically sends replies.

This is an early development build. See [the daily-note direction](docs/product/LIVING-DAILY-NOTE.md), [the implementation plan](plans/living-daily-note/plan.mdx), [the earlier product requirements](docs/product/PRD-JUST-MAPLE.md), [implementation status](docs/product/DAILY-ACTIONS-DELIVERY.md) and [open review findings](docs/reviews/PRE-PR-REVIEW-2026-09-23.md).

## Structure

- `src/apple/Just Maple.xcodeproj`: native Mac and iPhone hybrid applications.
- `src/apple/Packages/MapleCore`: local SQLite intelligence, notebook storage, encrypted companion transport and CLI.
- `src/web`: shared Angular interface and Maple UI components.
- `src/providers`: local provider process adapters.
- `docs/product`: product contracts and synthetic design review material.

## Development

Use macOS with Xcode and the Swift 6 toolchain, plus Node.js/npm and Python 3.8+ for fetching build assets.

```sh
npm run setup
npm run setup:laya # one-time ~805 MiB pinned model download
npm test
npm run test:core
npm run test:providers
swift build --package-path src/apple/Packages/MapleCore
npm run test:apple
```

Open `src/apple/Just Maple.xcodeproj` in Xcode and select the Mac or iPhone scheme. The Mac build bundles Angular and the native Laya model, tokenizer and calibration assets; subsequent builds verify the local cache without downloading. Laya remains an experimental provider behind a model/adapter quality gate; Jev stays the default until validation passes. See [the measured Laya evaluation](docs/evaluations/LAYA-COREML.md). Device installation requires appropriate Apple signing access; contributors must use their own development credentials. Existing application identity is intentional.

## Credentials and data

Supply your own service credentials locally. `.env.example` contains empty placeholders only; `.env`, OAuth client-secret downloads, signing keys, databases, private evaluations and build outputs are ignored. Never add production credentials or personal source content to this public repository. The Mac owns local SQLite; companion delivery uses the user's private iCloud account.

Model processing uses the existing rolling 30-day evidence policy; older sources can remain indexed locally. Synthetic tests validate implementation, not live model accuracy.
