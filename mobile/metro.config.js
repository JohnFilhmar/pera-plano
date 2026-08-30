const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const fs = require("fs");
const path = require("path");

// realpath the root: needed when building from a junction/symlink (Windows
// MAX_PATH workaround) so Metro emits correct paths and NativeWind resolves.
const projectRoot = fs.realpathSync(__dirname);
const config = getDefaultConfig(projectRoot);

// Import .svg files as React components.
config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer");
config.resolver.assetExts = config.resolver.assetExts.filter((e) => e !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

// THE ON-DEVICE VERIFICATION HARNESS IS EXCLUDED FROM EVERY BUNDLE THAT DID
// NOT ASK FOR IT (docs/13 Part 1). See app/dev_harness.tsx for the whole story;
// the short version is that a `process.env.EXPO_PUBLIC_*` guard inside the
// component is not enough on its own — it lets the minifier drop the JSX, but
// Metro still collects `lib/dev_harness/` as a dependency and its strings still
// land in the shipped Hermes bytecode. Verified by exporting the bundle and
// grepping it, not assumed.
//
// Blocking it at the RESOLVER removes both files from the module graph
// outright, including from the `require.context` expo-router builds over
// `app/`, so the route does not exist in a production build rather than
// existing and rendering null.
if (process.env.EXPO_PUBLIC_DEV_HARNESS !== "1") {
  const harness = /[\\/](app[\\/]dev_harness\.tsx|lib[\\/]dev_harness[\\/].*)$/;
  config.resolver.blockList = config.resolver.blockList
    ? [].concat(config.resolver.blockList, harness)
    : [harness];
}

module.exports = withNativeWind(config, {
  input: path.join(projectRoot, "global.css"), // absolute, real-path
});
