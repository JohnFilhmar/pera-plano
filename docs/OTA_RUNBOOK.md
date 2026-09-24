# OTA runbook

**Over-the-air updates are OFF.** `mobile/app.json` sets `updates.enabled: false`, and a test in
`mobile/modules/notification_listener/__tests__/app_plugin.test.ts` fails if that changes. Ship
through the store.

This file exists because the flag is one word and the reasons behind it are not.

## Why it is off

`expo-updates` is a dependency and `updates.url` is set, but nothing in this app has ever called
`Updates.*`. Enabled with no `checkAutomatically`, the library default has the update client contact
`u.expo.dev` on **every launch**, carrying the runtime version, platform, channel and an EAS client
identifier.

Two things made that unacceptable rather than merely untidy:

1. **It is egress with a persistent identifier**, from a library rather than from any call site this
   repository controls. `docs/07-privacy-and-compliance.md` §4 presents its lifecycle table as the
   complete list of what leaves the device, and `mobile/services/device_info.ts` promises that the
   app's own requests carry nothing correlatable. Neither statement could survive an unlisted
   per-launch ping with a client id attached.
2. **It routes around the re-declaration discipline** (`docs/07` §3.1 rule 6): a release that changes
   what the listener touches re-triggers an internal policy review before submission. An OTA publish
   reaches installed devices without a submission, so a JS-only change could alter what a
   notification-reading app reads *after* the review that approved it.

All three build variants share `version: 0.1.0` and `runtimeVersion.policy: "appVersion"`, so an
update published to a channel would reach every build on that channel. That is a wide blast radius
for a mechanism nothing was using.

## Shipping a fix

Build and distribute through EAS and the store. For a tester-only fix, build the `preview` profile
(`eas.json` pins the `preview` channel) and install it; for everyone, the `production` profile.

Yes, this is slower than an OTA push. That is the trade that was made, with the beta cohort small
enough for it to be affordable.

## If OTA is ever turned back on

Do not flip the flag alone. All of the following, or the two problems above come back with it:

- [ ] Set `updates.checkAutomatically` **explicitly**. Do not leave it to the default. `NEVER` keeps
      the system wired with no automatic egress; `ON_ERROR_RECOVERY` only fetches after a crash loop,
      which means a healthy-but-wrong install never receives the fix; `ON_LOAD` is the every-launch
      ping described above.
- [ ] Add a lifecycle row to `docs/07` §4 for the update check: what is sent, that the recipient is
      Expo, retention per their terms, and that there is no opt-out while the app is installed.
- [ ] Amend the header of `mobile/services/device_info.ts`, which currently states that the flag
      being off is what keeps its promise true of the whole app.
- [ ] Amend `docs/07` §3.1 rule 6, which currently gives this flag as the reason the rule is
      enforceable.
- [ ] Add the publish, verify and rollback steps: `eas update --channel <channel>`, verification on a
      real preview device before the production channel, and `eas update:republish` pointing at the
      last known-good update as the rollback.
- [ ] Add the gate that makes rule 6 survive: **does this update change what the listener reads,
      stores or sends?** If yes, it goes through the store, not over the air.
