// Dynamic Expo config: layers build-variant identity on top of the static app.json.
//
// Expo reads app.json first and passes it in as `config`; this function overrides
// only the fields that must differ per build so the three variants install side by
// side on one device:
//
//   APP_VARIANT=development -> PeraPlano(Dev)   com.filldev.peraplano.dev
//   APP_VARIANT=preview     -> PeraPlano(Prev)  com.filldev.peraplano.prev
//   (unset) / production    -> PeraPlano        com.filldev.peraplano
//
// Driving the Android package from here (instead of a hand-edited applicationIdSuffix
// in the gitignored android/ project) means `expo prebuild` regenerates it every time,
// so the suffix can no longer be dropped on a --clean.

const VARIANT = process.env.APP_VARIANT;

// Unset means production, so an unrecognised value is the one dangerous case:
// it would silently fall back to the production name and package, and the build
// would install straight over the real app instead of alongside it. `prev` for
// `preview` is the obvious typo. Fail the build instead.
const KNOWN_VARIANTS = ['development', 'preview', 'production'];
if (VARIANT !== undefined && VARIANT !== '' && !KNOWN_VARIANTS.includes(VARIANT)) {
  throw new Error(
    `APP_VARIANT="${VARIANT}" is not a known build variant. ` +
      `Expected one of ${KNOWN_VARIANTS.join(', ')}, or unset for production.`,
  );
}

const IS_DEV = VARIANT === 'development';
const IS_PREVIEW = VARIANT === 'preview';

const BASE_PACKAGE = 'com.filldev.peraplano';

const name = IS_DEV ? 'PeraPlano(Dev)' : IS_PREVIEW ? 'PeraPlano(Prev)' : 'PeraPlano';
const androidPackage = IS_DEV
  ? `${BASE_PACKAGE}.dev`
  : IS_PREVIEW
    ? `${BASE_PACKAGE}.prev`
    : BASE_PACKAGE;

// The same value the fields above are derived from, normalised once so the app
// can read it at runtime. Unset and empty both mean production, exactly as they
// do for the package name -- see the KNOWN_VARIANTS check above, which has
// already rejected anything else by the time this runs.
const resolvedVariant = VARIANT === undefined || VARIANT === '' ? 'production' : VARIANT;

module.exports = ({ config }) => ({
  ...config,
  name,
  android: {
    ...config.android,
    package: androidPackage,
  },
  // WHY THE VARIANT HAS TO REACH THE RUNNING APP AT ALL: app/_layout.tsx turns
  // Android's FLAG_SECURE on for the whole app, and development builds are
  // deliberately exempt so screenshots stay available for the on-device
  // verification walkthrough and for bug reports. Nothing else in the app may
  // branch on this -- it is a build identity, not a feature flag, and a second
  // reader of it would be the beginning of a debug-only code path shipping to
  // users. `__DEV__` is not the same question: it tracks the JS bundle mode,
  // and a release-mode bundle of the dev package would still need capture.
  extra: {
    ...config.extra,
    appVariant: resolvedVariant,
  },
});
