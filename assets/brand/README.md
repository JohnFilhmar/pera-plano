# PeraPlano brand assets

This directory is the single source of truth for the brand SVGs and the web
favicon/PWA icon set. `mobile/assets/brand/` holds a **copy** of exactly one
file from here today (see "What's copied into the app" below) — everything
else in this tree is consumed by the web front end only, with one
exception: `peraplano-logo-layered.svg`, a web/native handoff asset that
legitimately lives at top level but is not what the mobile app's Reanimated
port animates — see "The SMIL fact" below for why.

The original designer handoff note is kept, unmodified, at
[`README.txt`](./README.txt) alongside this file. Read on for the same
information plus the one fact `README.txt` couldn't have known it needed to
say: how these files behave once they leave the browser.

## Layout

```
assets/brand/
  README.md                    this file
  README.txt                   original designer handoff note (verbatim)
  peraplano-bg-planes.svg      1600x900 background, 7 planes on mixed routes
  peraplano-idle-logo.svg      logo idling in place, infinite
  peraplano-idle-loop.svg      loading / busy spinner, infinite
  peraplano-launch.svg         one-shot takeoff for a click action
  peraplano-logo-static.svg    the resting logo (use as the button face) — CANONICAL copy
  peraplano-logo-animated.svg  CSS-animated logo, web only
  peraplano-logo-layered.svg   web/native handoff asset; NOT the mobile Reanimated source — see below
  nav/                         8-direction pagination icons
    nav-n.svg  nav-ne.svg  nav-e.svg  nav-se.svg
    nav-s.svg  nav-sw.svg  nav-w.svg  nav-nw.svg
  favicon/                     web favicon and PWA manifest icons
    favicon.ico
    favicon-16x16.png  favicon-32x32.png
    apple-touch-icon.png
    android-chrome-192x192.png  android-chrome-512x512.png
    site.webmanifest
    favicon_io.zip              the original favicon.io export, unextracted
    peraplano-favicon.svg
    peraplano-logo-static.svg   duplicate of the root file — see "Duplicate static file" below
```

## The SMIL fact — read this before you spend a day on it

Every animated file in this delivery animates with **SMIL**
(`<animate>` / `<animateTransform>` elements inside the SVG itself), which is
how `README.txt` can correctly say these files "need no CSS and no
JavaScript" — a browser's `<img>`, background-image, or inline SVG renderer
plays SMIL natively.

`react-native-svg`, the library this app uses to put an SVG on screen,
**does not implement SMIL**. It is not a partial or buggy implementation —
the `<animate>` element is simply not in its supported tag set. When one of
these files is imported through `react-native-svg-transformer` (the Metro
transform this repo wires up in `mobile/metro.config.js`), the SMIL elements
are dropped during parsing. The rest of the SVG renders fine. The practical
effect: **the file renders its first frame, silently — no error, no
warning, no crash.** Nothing in the render path tells you the animation
didn't happen. You only find out by looking at the screen and noticing
nothing moves.

That silent failure is the reason this task exists: it is cheap to lose a
day chasing "why won't this idle loop spin" before realizing the file was
never going to spin on this platform at all.

The files affected — everything below is SMIL-animated and will freeze to
its first frame if rendered through `react-native-svg`:

- `nav/nav-n.svg`, `nav-ne.svg`, `nav-e.svg`, `nav-se.svg`, `nav-s.svg`,
  `nav-sw.svg`, `nav-w.svg`, `nav-nw.svg`
- `peraplano-bg-planes.svg`
- `peraplano-idle-logo.svg`
- `peraplano-idle-loop.svg`
- `peraplano-launch.svg`

`peraplano-logo-static.svg` has no `<animate>` elements — it is already a
still frame, so freezing changes nothing. That is what makes it safe to
bring into the app as-is, and it's why it's the file `mobile/` copies.

`peraplano-logo-animated.svg` and `peraplano-logo-layered.svg` also use no
SMIL, but for opposite reasons. `peraplano-logo-animated.svg` is animated in
the browser via CSS on the web front end — a web-only technique, not
something `react-native-svg` can drive either. `peraplano-logo-layered.svg`
is deliberately inert — its own `<desc>` says "No CSS/SMIL — animate parts
natively," meaning it was drawn so a *native* animation runtime (Reanimated)
could drive its individually-tagged parts (`#background`, `#trail`,
`#airplane_body`, `#airplane_wing`, `#airplane_hull`) directly. That was the
project's own design intent, not a guess: `docs/10-web-design-prompt.md`
lines 85-86 record it —

> The layered static variant (stable ids: `airplane_body`, `trail`,
> `background`) is the one the mobile app animates with Reanimated —
> `react-native-svg` does not play SMIL/CSS animations, which is why the
> prompt demands both variants.

**That intent did not survive the toolchain.** The Reanimated port has since
shipped — `BrandMark`'s `idle`, `launch`, and `loading` variants — and it
does not read `peraplano-logo-layered.svg`. The reasoning lives in
`mobile/components/ui/brand_mark.tsx`'s header comment ("WHICH ARTWORK
MOVES") rather than being restated here, on purpose: writing the same
explanation in two files is exactly how they drift apart again — which is
the failure this README edit exists to stop. In short:
`react-native-svg-transformer` compiles a `.svg` into one opaque component,
so nothing in JS can reach a `<g id="trail">` or any other inner id once the
file has passed through Metro — the layered file's stable ids are
addressable on the web and unreachable on React Native. Every animated
`BrandMark` variant instead animates the *static* mark
(`peraplano-logo-static.svg`) as a rigid body.

`peraplano-logo-layered.svg` still belongs at top level. It remains the
web/native handoff asset `docs/10-web-design-prompt.md` describes, and the
web front end can still address its ids directly — it is just not the
mobile Reanimated source.

## What's copied into the app

`mobile/assets/brand/peraplano-logo-static.svg` is a copy of this
directory's (canonical) `peraplano-logo-static.svg`, and it remains the
**only** SVG file from this delivery that ships inside the Android app.
Every `BrandMark` variant — `static`, `idle`, `launch`, `loading` — renders
this one file; Reanimated drives its transform, nothing imports a second
SVG. It was chosen as the file to copy because it's the one static-frame
file — every other animated asset would silently freeze if rendered the
same way, per the SMIL fact above.

The idle, launch, and loading motion has since shipped:
`mobile/components/ui/brand_mark.tsx` gives `BrandMark` a `variant` prop
(`"static" | "idle" | "launch" | "loading"`) and a `playToken` to replay the
one-shot `launch`. The motion is not read from any SVG at runtime, though —
it is hand-transcribed, ahead of time, out of this directory's
`peraplano-idle-logo.svg`, `peraplano-launch.svg`, and
`peraplano-idle-loop.svg` into keyframe data in
`mobile/components/ui/brand_mark_motion.ts`. See the next section for what
that transcription means for anyone who touches those three files.

`assets/brand/` at the repo root stays the source of truth rather than
`mobile/` reaching out to it directly (a symlink, or a Metro
`watchFolders` entry above the project root): Metro resolving outside the
project root is a known Windows/junction hazard this repo already routes
around in `mobile/metro.config.js` (see the `fs.realpathSync` comment
there), and one 440-byte file isn't worth reopening that. If the source
file changes, re-copy it by hand.

## The three files that are now specifications

`peraplano-idle-logo.svg`, `peraplano-launch.svg`, and
`peraplano-idle-loop.svg` are no longer just delivered artwork sitting in
this folder — they are the source of truth for
`mobile/components/ui/brand_mark_motion.ts`, which transcribes their SMIL
`keyTimes`, `keySplines`, and translate/rotate/scale values as literal
numbers, and for
`mobile/components/ui/__tests__/brand_mark_motion.test.tsx`, which asserts
those same numbers as literals right back.

That means editing any of these three SVGs — a retimed loop, a redrawn
launch arc, a different idle drift — does **not** propagate automatically,
and critically, it does **not** fail CI. The test suite asserts the OLD
transcription against itself; it has no way to notice the source moved
underneath it, so it stays green while the on-device animation quietly goes
stale. If you touch one of these three files, you must also hand-update
`brand_mark_motion.ts`'s corresponding constants and
`brand_mark_motion.test.tsx`'s corresponding assertions in the same
change — nothing in this repo will catch the drift for you.

## Duplicate static file

`peraplano-logo-static.svg` exists twice in this delivery:
`assets/brand/peraplano-logo-static.svg` (440 bytes) and
`assets/brand/favicon/peraplano-logo-static.svg` (445 bytes). Diffed, they
are the identical artwork — the byte difference is CRLF vs LF line endings,
not two different marks. The root copy is **canonical** and is the one
`mobile/` copies from (see above); the `favicon/` copy is kept only so that
delivery folder stays intact, per the no-deletion rule. Don't edit one
without the other going stale.

## Web-only: `favicon/` and `nav/`

Everything in `favicon/` is consumed by the web front end and by browser/PWA
chrome — favicon tabs, "Add to Home Screen" icons, `site.webmanifest`. The
Android app has its own, unrelated icon pipeline: `mobile/assets/icon.png`,
`mobile/assets/adaptive-icon.png`, and `mobile/assets/splash-icon.png` are
generated separately for Expo/Android and are not derived from anything in
this directory. In particular, **`android-chrome-192x192.png` and
`android-chrome-512x512.png` are PWA (web) icons, not Android app icons** —
the "android-chrome" name refers to Chrome-on-Android reading the web
manifest, not to the native Android app. Don't wire them into
`app.json`/`android/`.

`nav/` (the 8-direction pagination icons) has no current consumer on
mobile either. It's here for the web front end's use; if a native nav
control needs equivalent icons later, that's a separate design pass —
these are SMIL-animated (see above) and would freeze if imported as-is.

## Brand hexes

From `README.txt`:

- Light face: `#22C55E`
- Shadow face: `#15803D`

## Replaying a one-shot animation (web only)

Also from `README.txt` — relevant to `peraplano-launch.svg`, which is a
one-shot takeoff rather than a loop:

- As an `<img>`: bust the cache to restart the SMIL timeline —
  `img.src = 'peraplano-launch.svg?' + Date.now()`
- Inlined in the DOM: call `svg.setCurrentTime(0)` on the inlined
  `<svg>` element.

Neither trick applies to `react-native-svg` — see the SMIL fact above.
