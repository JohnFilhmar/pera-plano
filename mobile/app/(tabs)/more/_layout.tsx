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

/**
 * The same anchor, for the same reason, as app/(tabs)/plan/_layout.tsx: a link
 * straight to `more/listener_health` would otherwise mount this Stack with that
 * screen as its only entry and strand the More tab on it. Home pushes here from
 * its tracking banner. See that file for the full reasoning and for why the
 * push sites carry `withAnchor` as well.
 */
export const unstable_settings = {
  initialRouteName: "index",
};

export default function MoreLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
