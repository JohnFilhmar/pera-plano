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

module.exports = ({ config }) => ({
  ...config,
  name,
  android: {
    ...config.android,
    package: androidPackage,
  },
});
