// app/(tabs)/more/_layout.tsx — the More tab's own Stack.
//
// Same reason as app/(tabs)/plan/_layout.tsx: without a layout here, every
// route under more/ (settings, privacy, reports, subscriptions, listener
// health, parser diagnostics) is registered as a DIRECT CHILD of the tab
// navigator and gets its own tab button, so the five-tab bar silently grows a
// button per screen.
//
// more/ had no dynamic routes, so its strays were less obvious than plan/'s
// `[id]` labels — which is exactly why it needs the same structural fix rather
// than a hand-maintained list of things to hide.
import { Stack } from "expo-router";

export default function MoreLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
