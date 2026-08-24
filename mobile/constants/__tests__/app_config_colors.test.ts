import { palette } from "../colors";
import appConfig from "../../app.json";

type SplashScreenPluginConfig = {
  backgroundColor: string;
  dark: { backgroundColor: string };
};

function findSplashScreenPluginConfig(): SplashScreenPluginConfig {
  const plugins = appConfig.expo.plugins as Array<string | [string, unknown]>;
  const entry = plugins.find(
    (p): p is [string, SplashScreenPluginConfig] => Array.isArray(p) && p[0] === "expo-splash-screen",
  );
  if (!entry) {
    throw new Error("expo-splash-screen plugin entry not found in app.json");
  }
  return entry[1];
}

test("android adaptive icon background matches palette.bg", () => {
  expect(appConfig.expo.android.adaptiveIcon.backgroundColor).toBe(palette.bg);
});

test("expo-splash-screen plugin colors match palette.bg / palette.bg-dark", () => {
  const splashScreenConfig = findSplashScreenPluginConfig();
  expect(splashScreenConfig.backgroundColor).toBe(palette.bg);
  expect(splashScreenConfig.dark.backgroundColor).toBe(palette["bg-dark"]);
});
