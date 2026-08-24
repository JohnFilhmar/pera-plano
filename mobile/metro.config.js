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

module.exports = withNativeWind(config, {
  input: path.join(projectRoot, "global.css"), // absolute, real-path
});
