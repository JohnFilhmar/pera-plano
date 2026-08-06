module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      ["babel-plugin-inline-import", { extensions: [".sql"] }],
      // Strip console.* from production bundles.
      ...(process.env.NODE_ENV === "production" ? [["transform-remove-console"]] : []),
    ],
  };
};
