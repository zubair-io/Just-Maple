# Just Maple releases

Adapted from [Sugar-Maple's release system](https://github.com/zubair-io/Sugar-Maple/blob/af218238927f770470c95390aecac2926fad0cd1/docs/development/releases.md)
at revision `af218238927f770470c95390aecac2926fad0cd1`.

## Version and build numbers

The product marketing version lives in
`apps/apple/JapaneseMaple.xcodeproj/project.pbxproj`. All twelve Debug/Release
configurations (app, Watch app, and tests) must use the same stable
`MAJOR.MINOR.PATCH` value. The initial migration normalizes `1.0` to `1.0.0`.
The monorepo's JavaScript package versions are independent package metadata.

Xcode Cloud assigns increasing build numbers. Marketing-version bumps must not
reset Cloud's build counter. The pre-build hook rejects inconsistent target
versions and tags that differ from the committed version; it never silently
rewrites a tagged commit's version.

## Apple delivery

App Store Connect app: `6756770987`; bundle: `com.just.maple.JapaneseMaple`;
team: `QREP66JW5U`; scheme: `JapaneseMaple`;
project: `apps/apple/JapaneseMaple.xcodeproj`.

[Xcode Cloud workflows](https://appstoreconnect.apple.com/teams/69a6de75-017c-47e3-e053-5b8c7c11a4d1/xcode-cloud/products/48D7F462-432F-4EC7-8170-E46C50AA2D4D/workflows):

- **Default** (`6DF933A5-306A-48CE-8751-8FFD1E06931C`) retains main-branch
  builds when `apps/apple` changes, with iOS and macOS archives distributed to
  the internal **Maple** TestFlight group.
- **prod** (`8e59470e-0137-4fa9-a765-0abc8206aa3b`) watches tags beginning
  with `v`, with any-file changes, clean builds, latest release Xcode/macOS,
  iOS and macOS archives prepared for **App Store Connect**, and **Notarize –
  macOS** on the same Mac archive. Editing is restricted to Admins/App Managers.
  The existing internal TestFlight post-actions also use these archives.

The Watch app remains embedded in the iOS archive. Production tags must be
stable `vMAJOR.MINOR.PATCH`. Production scripts use Cloud's Developer ID export;
they do not compile or re-sign a second Mac app. The signed app is checked for
bundle/team, hardened runtime, marketing version and universal architecture,
notarized and stapled, then packaged into a notarized/stapled DMG. Gatekeeper
assesses the app from the final mounted DMG.

Configure these **secret, prod-only** Xcode Cloud environment variables:

| Variable         | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `AC_KEY_ID`      | Developer-role App Store Connect API key ID                |
| `AC_ISSUER_ID`   | Apple API issuer ID                                        |
| `AC_PRIVATE_KEY` | That key's P8 contents for notarization                    |
| `GITHUB_TOKEN`   | Just-Maple-only token with Contents write for draft assets |

Do not put credentials into source, logs, artifacts or shared PR/development
variables. Apple team API keys cover the team's apps; use Developer rather
than Admin access. App Store Connect distribution preparation does not submit
the app for public review or publish it to the App Store.

## GitHub setup

Before the first version-sync dispatch:

1. Merge these workflows onto main.
2. Enable repository auto-merge with rebase merging.
3. Configure a strict, up-to-date main ruleset requiring
   `release-handoff-complete`, `Release readiness`, `build-and-test`,
   `e2e-tests`, `apple-macos`, `apple-ios`, and `Release tooling`.
   Preserve any existing stronger protection. A rule requiring human approvals
   still requires a human to approve the next-version PR.
4. Store `VERSION_SYNC_TOKEN` as an encrypted repository Actions secret: a
   fine-grained token restricted to Just-Maple with Contents, Pull requests and
   Issues write, and Actions read. The ordinary Actions `GITHUB_TOKEN` suppresses
   downstream tag/PR workflows and cannot replace this token.
5. Configure the prod-only Cloud secrets above. Rotate tokens before expiry.

The controller refuses release creation without the required protection and
successful validation of the exact dispatch revision.

## Release the tested version, then advance development

1. Dispatch **version-sync** on **main**. Leave `next_version` blank for a patch
   increment or specify a greater stable version.
2. The complete reusable CI, Apple builds, and release-tool tests validate the
   pinned revision. Main must still point to that revision and have green push
   CI; movement or failure prevents tagging.
3. The controller creates/reuses a tracking issue and durable
   `release/next-vCURRENT` branch containing only the next marketing-version
   change. It sets the handoff gate on open PRs and publishes an annotated
   `vCURRENT` tag on tested main.
4. The tag starts Cloud prod and GitHub's **release** workflow. Cloud uploads
   `JustMaple-macOS-VERSION.dmg`, `SHA256SUMS.txt`, and
   `release-metadata.json` to a draft GitHub release. GitHub waits for the exact
   Cloud archive, downloads and verifies all three, then publishes. Missing or
   mismatched assets leave the draft unpublished. Published assets are never
   overwritten.
5. A version-only PR advances development; release readiness waits for CI,
   Apple, and Release tooling on its exact head. During handoff, only the
   validated version bump can pass the handoff gate. Rebase auto-merge remains
   subject to branch protection. Merging it starts the next TestFlight version
   and does not create a release tag.

Rerunning a dispatch reuses its issue, branch, tag and PR. A completed handoff is
a no-op. Never move released tags. Use `advance_only` to repair an already-tagged
version that remained on main without creating another release. The
`pull_request_target` handoff workflow executes trusted main code and reads PR
changes only as Git objects; it never checks out or executes PR source.

## Validation

```sh
python3 -m unittest discover -s tools -p 'test_release_*.py'
python3 -m unittest discover -s apps/apple/ci_scripts -p 'test_*.py'
shellcheck apps/apple/ci_scripts/*.sh
actionlint .github/workflows/{apple,version-sync,release-handoff,release-tools,release,ci}.yml
```

The Apple workflow compiles Release for generic macOS and iOS devices without
distribution credentials, including the embedded Watch target for iOS. Xcode
Cloud handles signed archives and delivery. Tests exercise local Git remotes,
tag races, retry/repair behavior, version-only enforcement, tampered artifacts,
foreign provenance, failed notarization, and publication timeouts.

Passing these checks does not prove processed TestFlight delivery, signed
production archives or public DMG delivery. Verify those after the first
intentional release. Do not generate a production tag merely to test setup.
