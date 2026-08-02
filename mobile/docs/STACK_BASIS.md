# Expo React Native — Stack & Architecture Basis

> **Not part of the PeraPlano planning docs.** This is a pre-existing, product-agnostic
> engineering reference kept outside the planning documentation set in `docs/`. It is
> **not** a statement of PeraPlano's tech stack — the planning phase deliberately names
> no frameworks, databases, languages, or libraries, and the stack remains undecided.
> Note in particular that an Expo managed workflow ("no ejected native code") does not
> by itself provide the Android `NotificationListenerService` PeraPlano's ingest
> depends on; that requires custom native code this reference does not cover.

A reusable reference for standing up a **new** production mobile app with the same
stack and conventions used here. It is intentionally product-agnostic: replace
`APP_NAME`, `com.example.app`, and endpoint paths with your own. Concrete version
numbers and code skeletons are kept so a new project boots on the same wiring.

> How to use: skim §1–§3 to pin the toolchain, copy the skeletons in §7–§9 and
> §16, then follow the layering rules in §5–§8. Everything here is JS/TS on top of
> Expo managed workflow — no ejected native code required.

---

## 1. Core stack (pinned versions)

| Layer | Choice | Version |
|---|---|---|
| Runtime | Expo SDK | `~54.0` |
| | React Native | `0.81.x` |
| | React | `19.1.x` |
| | Architecture | **New Architecture (Fabric + TurboModules)**, React Compiler ON |
| Language | TypeScript | `~5.9`, `strict: true` |
| Routing | expo-router (file-based) | `~6.0`, typed routes ON |
| Server state | TanStack React Query | `~5.90` + `react-query-persist-client` + `query-async-storage-persister` |
| Local state | React Context | one provider per cross-cutting concern |
| Styling | NativeWind + Tailwind | `nativewind ^4.2`, `tailwindcss ^3.4` |
| Icons | lucide-react-native, @expo/vector-icons | |
| HTTP | axios | `^1.13` |
| Realtime | socket.io-client | `^4.8` (optional) |
| Media | expo-image (mem+disk cache, retry, per-request headers) | `~3.0` |
| Push (optional) | @react-native-firebase/app + /messaging (+ expo-notifications) | `^24` / `~0.32` |
| Calls (optional) | react-native-webrtc + react-native-callkeep + voip-push | see §17 |
| Storage | expo-secure-store (secrets), @react-native-async-storage/async-storage (cache) | |
| Animation | react-native-reanimated `~4.1` + react-native-worklets `0.5.x` | |
| SVG | react-native-svg `^15` + react-native-svg-transformer | |
| Crypto | tweetnacl, tweetnacl-util, expo-crypto | only if E2EE/at-rest encryption needed |
| Nav shell | @react-navigation/native + bottom-tabs `^7` | |
| Keyboard | react-native-keyboard-controller | |
| Build/deploy | EAS Build + EAS Update (OTA) | |
| Test / lint | jest + jest-expo / eslint-config-expo | |

`package.json` `main`: `expo-router/entry` by default. **But** if you must register
native/background handlers *before* the React tree mounts (push-wake, CallKeep, iOS
PushKit — see §17), point `main` at a custom `index.js` that registers them and then
`require("expo-router/entry")` **last**. Path alias `@/*` → project root.

## 2. Expo configuration (`app.json`)

- **Managed / CNG** — do not commit `android/` or `ios/`; regenerate with
  `expo prebuild --clean`. EAS cloud regenerates automatically.
- `userInterfaceStyle: "automatic"` (follow system theme).
- `scheme` for deep links; `experiments: { typedRoutes: true, reactCompiler: true }`.
- Plugins: `expo-router`, `expo-splash-screen` (include a `dark.image` +
  `dark.backgroundColor` so the native splash is themed), `expo-secure-store`,
  `expo-notifications` (icon/color/defaultChannel/sounds) as needed.
- **OTA**: `runtimeVersion: { policy: "appVersion" }` + `updates.url`. JS-only
  changes ship via `eas update`; native/manifest changes need a rebuild.
- **Dynamic config**: keep static keys in `app.json`; layer environment-varying
  keys via `app.config.js` (`export default ({ config }) => ({ ...config, … })`) —
  e.g. a dev bundle-id/`name` suffix, or config plugins applied only when a feature
  is on — switched by an `APP_VARIANT` env set per EAS profile. Both files merge,
  `app.config.js` wins. A clone that copies only `app.json` loses this layer.
- Declare Android `permissions` explicitly.
- Keep `package` / `bundleIdentifier` **identical across environments** — OTA and
  store identity depend on it. Vary environments by EAS channel/env, not app id.

## 3. Build tooling

**`metro.config.js`**
```js
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
```

> Pull in a **native-only** lib (WebRTC, …) or a package that ships uncompiled TS?
> Add a `config.resolver.resolveRequest` — see §15.

**`babel.config.js`**
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      // Strip console.* from production bundles.
      ...(process.env.NODE_ENV === "production" ? [["transform-remove-console"]] : []),
    ],
  };
};
```

**`tailwind.config.ts`** — one token source, absolute content globs:
```ts
import type { Config } from "tailwindcss";
import fs from "fs";
import { palette } from "./constants/colors";

// Absolute real-path globs: relative globs through a junction silently produce
// empty CSS and strip every NativeWind style from the release build.
const root = fs.realpathSync(__dirname).replace(/\\/g, "/");

export default {
  content: [`${root}/app/**/*.{js,jsx,ts,tsx}`, `${root}/components/**/*.{js,jsx,ts,tsx}`],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: { sans: ["AppFont"] },
      colors: {
        bg:      { DEFAULT: palette.bg,      dark: palette["bg-dark"] },
        surface: { DEFAULT: palette.surface, dark: palette["surface-dark"] },
        fg:      { DEFAULT: palette.fg, "2": palette["fg-2"], dark: palette["fg-dark"] },
        brand:   { DEFAULT: palette.brand, soft: palette["brand-soft"], dark: palette["brand-dark"] },
        // …extend per token; every token has a `-dark` sibling.
      },
    },
  },
  plugins: [],
} satisfies Config;
```

**`tsconfig.json`**
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "paths": { "@/*": ["./*"] } },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts", "nativewind-env.d.ts", "svg.d.ts"]
}
```

`global.css` (three lines, imported once in the root layout):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## 4. Styling — the NativeWind approach

- **Single source of design tokens**: `constants/colors.ts` exports a flat
  `palette` map; **every token has a `-dark` sibling**. `tailwind.config.ts` maps
  the palette into color scales → utilities like `bg-bg dark:bg-bg-dark`,
  `text-fg-2`, `bg-brand-soft`.
- Dark mode = NativeWind `dark:` variant, driven by `userInterfaceStyle:
  automatic` + a `useTheme` hook (auto/light/dark, persisted; default = system).
- **App-wide font**: patch `Text`/`TextInput` `defaultProps` once at module load
  (before any render) to inject the loaded font family, instead of setting it on
  every component.
- **Gradients without a native dep**: build them with `react-native-svg`
  (`LinearGradient`), not `expo-linear-gradient`, so they run in the existing dev
  client with no rebuild.
- Static styling → Tailwind `className`. Dynamic/animated values → inline `style`
  (Reanimated).

## 5. Routing — expo-router

File-based under `app/`. Groups organize without adding URL segments:
```
app/index.tsx                 # startup gate: cached-session route decision
app/(auth)/                   # unauthenticated flow
app/(tabs)/                   # bottom-tab main app
app/[resource]/[id].tsx       # dynamic routes
app/_layout.tsx               # root: provider tree + Stack
```
- Root `_layout` `Stack`: `headerShown:false`, and set `contentStyle.backgroundColor`
  to the theme bg + override the navigation container theme, so no white flash on
  screen pop.
- `app/index.tsx` decides the entry route from the **cached** session only — never
  block startup on the network (see §8).

## 6. State management — React Query + Context

- One central `QueryClient`: `staleTime 5m`, `gcTime 30m`, queries `retry 3` w/
  exponential backoff, `refetchOnWindowFocus:false`, `refetchOnReconnect:true`;
  **mutations `retry:0`** (side effects must not auto-replay).
- **Query-key factory** — hierarchical `as const` keys in one file; user-scoped
  queries embed the `userId`:
  ```ts
  export const queryKeys = {
    auth:  { all: ["auth"] as const, user: () => ["auth","user"] as const },
    chats: {
      all: ["chats"] as const,
      list: (f?: object) => ["chats","list",f] as const,
      messages: (id: string) => ["chats","detail",id,"messages"] as const,
    },
  } as const;
  ```
- **Hook layering**: `hooks/queries/*` = one `useQuery` wrapper each;
  `hooks/mutations/*` = one `useMutation` each. Thin — wire a `queryKey` + a
  service fn, pass options through. Components never call services directly for
  server state; they use hooks.
- **Context** for cross-cutting client state only (auth session, device contacts,
  a shared modal). Server state stays in React Query.

**Offline persistence + account isolation** (multi-account apps):
- Persist the cache to AsyncStorage via `createAsyncStoragePersister`
  (`maxAge: Infinity`, a `buster` string for format breaks, a whitelist of which
  query families to persist). Encrypt the blob at rest if it can hold private data.
- On every auth boundary (login/logout) run a `resetSessionCaches()` that clears
  React Query, purges the on-disk cache, tears down the socket, and bumps a
  "session epoch". Add an owner-key backstop (`reconcilePersistedAccount(userId)`)
  that wipes a restored cache belonging to a different account.

## 7. API layer — one client, two call styles

`services/api.ts`:
```ts
const apiClient = axios.create({
  baseURL: ENV.API_URL,
  timeout: 30000,
  headers: { Accept: "application/json", "X-Client-Type": "mobile" },
  // Never throw on status — let the interceptor/wrappers decide. Lets business
  // 4xx (e.g. 403 new-device, 404 not-found) be inspected via response.data.
  validateStatus: () => true,
});

// REQUEST: proactively refresh + attach token, add device headers, fix FormData.
apiClient.interceptors.request.use(async (config) => {
  const isPublic = ["/token/refresh","/login","/otp/request","/otp/verify"]
    .some((p) => config.url?.includes(p));
  if (!isPublic) {
    const token = await tokenRefreshManager.refreshIfNeeded();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  Object.assign(config.headers, await getDeviceHeaders());
  if (config.data instanceof FormData) config.headers["Content-Type"] = undefined; // let axios set boundary
  else if (!config.headers["Content-Type"]) config.headers["Content-Type"] = "application/json";
  return config;
});

// RESPONSE: 401 → one silent refresh + replay; 5xx → reject; network → warn+reject{status:0}.
apiClient.interceptors.response.use(
  async (response) => {
    const isPublic = [/* same list */].some((p) => response.config?.url?.includes(p));
    const cfg = response.config as any;
    if (response.status === 401 && !isPublic && !cfg._isRetry) {
      cfg._isRetry = true;
      const fresh = await tokenRefreshManager.refreshIfNeeded();
      if (fresh) { cfg.headers.Authorization = `Bearer ${fresh}`; return apiClient(cfg); }
      return Promise.reject({ status: 401, message: "Session expired." });
    }
    if (response.status >= 500) return Promise.reject({ status: response.status, message: "Server error" });
    return response;
  },
  async (error) => {
    console.warn("[API] Network error:", error.message); // warn, not error (offline is expected)
    return Promise.reject({ status: 0, message: "Network error." });
  },
);
```

Two ways to call:
- `api.get/post/put/patch/delete<T>()` — thin wrappers that **reject on 4xx**; use
  for single-success-path callers.
- `apiClient` **directly** — when the caller must inspect 4xx status codes, merging
  `response.status` into the returned object.

**Layering**: `component → query/mutation hook → service fn → api/apiClient →
interceptors → backend`. Services (`services/<domain>.ts`) normalize to
`{ status, ...body }` or throw a typed error. UI never imports axios.

## 8. Auth & token flow

- **Secrets** (`services/secure-storage.ts`) in `expo-secure-store` on native,
  AsyncStorage fallback on web. Keys: access token, refresh token, session id.
- **`lib/token-refresh.ts`** — a singleton manager:
  - Decode JWT `exp`; refresh a ~30s buffer **early**; fail safe on malformed.
  - **De-dupe concurrent refreshes** via an internal queue so the HTTP interceptor
    and socket never double-refresh.
  - Outcomes: success → store rotated tokens; **401/403 = dead session** → clear
    tokens + emit `"unauthenticated"`; **429 / other / network error =
    transient** → keep tokens, return null, do **not** log out (offline keeps the
    user in-app on cached data). This transient-vs-dead distinction is the single
    most important auth rule — do not collapse it.
- **`lib/auth-events.ts`** — a tiny event bus; the root layout listens for
  `"unauthenticated"` → tear down session caches, redirect to the auth flow.
- **Startup** (`app/index.tsx`): route on token **presence** in storage (→ app,
  else auth); fire the refresh in the **background**. Awaiting it on the splash
  hangs the app on a slow/unreachable server.
- OTP-first pattern: `/login` status discriminates (tokens / new-device→OTP /
  not-found→register); `/otp/request` → `/otp/verify` → token pair; refresh-token
  rotation on `/token/refresh`.

## 9. `lib/token-refresh.ts` skeleton

```ts
class TokenRefreshManager {
  private isRefreshing = false;
  private queue: ((t: string | null) => void)[] = [];
  private BUFFER = 30; // seconds

  isExpired(token: string) {
    const { exp } = decodeJwtPayload<{ exp?: number }>(token) ?? {};
    if (!exp) return false;                         // fail safe
    return exp - Math.floor(Date.now() / 1000) < this.BUFFER;
  }

  async refreshIfNeeded(): Promise<string | null> {
    const current = await getToken();
    if (current && !this.isExpired(current)) return current;
    if (this.isRefreshing) return new Promise((res) => this.queue.push(res));
    this.isRefreshing = true;
    try {
      const rt = await getRefreshToken();
      if (!rt) { this.drain(null); return null; }   // no session — silent, not a failure
      const res = await refreshToken({ refreshToken: rt });
      if (res.status >= 200 && res.status < 300) {
        await storeTokens(res.data); this.drain(res.data.accessToken); return res.data.accessToken;
      }
      if (res.status === 401 || res.status === 403) { await this.fail(); return null; } // dead
      this.drain(null); return null;                // transient (429/etc) — keep session
    } catch { this.drain(null); return null; }      // offline/timeout — keep session
    finally { this.isRefreshing = false; }
  }

  private drain(t: string | null) { this.queue.forEach((r) => r(t)); this.queue = []; }
  private async fail() { this.drain(null); await clearAuthTokens(); authEvents.emit("unauthenticated"); }
}
export const tokenRefreshManager = new TokenRefreshManager();
```

## 10. Realtime (optional, socket.io)

- Singleton service, typed `Socket<ServerToClient, ClientToServer>`.
- URL/namespace from `ENV` (derive `ws(s)://` from the API URL); auth via the
  **shared `tokenRefreshManager`**.
- Listener registry = a `Set` per event; `.on()` returns an unsubscribe.
- Optional HTTP **polling fallback** behind a feature flag.
- `disconnect()` on logout — the singleton holds the previous account's token.

## 11. Device identity & headers

`getDeviceHeaders()` spreads onto every request:
- `User-Agent` — a parseable WebView-format UA (so backend parsers get
  OS/vendor/model), overriding the default okhttp UA.
- `X-Device-Token` — a **deterministic** SHA-256 seeded from the OS native id
  (Android `ANDROID_ID` / iOS `identifierForVendor`), namespaced by app id →
  survives reinstall as the same device. Blocklist known-bad ids; use a persisted
  per-install random token (under a **separate** key) only when the OS withholds
  an id, so the device can later upgrade to the deterministic token.
- `X-Device-Model/Brand/OS/OS-Version/Type`, `X-App-Version/Build`.

## 12. Security posture

- Tokens only in `expo-secure-store` (never AsyncStorage on native).
- If the persisted React Query cache can hold private data, **encrypt it at rest**
  (tweetnacl); load the key before the persist provider mounts; bust + purge the
  cache on every auth boundary.
- Refresh-token rotation; strip `console.*` in production; optional force-update
  gate that hides the app below a backend-reported minimum native version and
  **fails open** when its endpoint is unreachable.

## 13. Config management

- **`constants/env.ts`** is the only place env is read: everything from
  `process.env.EXPO_PUBLIC_*` with a `?? default`, typed `as const`. Parse boolean
  flags from `"true"`/`"false"` strings.
- **EAS profiles** (`eas.json`): `development` (dev-client, internal apk),
  `preview` (internal apk, own channel), `production` (store app-bundle,
  `autoIncrement`, `appVersionSource: remote`). Each profile sets a `channel` (OTA
  target), `environment`, and an `APP_VARIANT` env. Keep secrets in EAS env vars,
  not committed `.env`.

## 14. Directory conventions

```
app/            # expo-router routes ONLY (groups: (auth) (tabs) …)
components/     # presentational, grouped by feature + a ui/ primitives folder
hooks/          # queries/  mutations/  + feature hooks
services/       # api client + one module per API domain + secure-storage, websocket, device-info
lib/            # framework-agnostic logic: query-client, token-refresh, jwt, auth-events,
                #   session-epoch, cache-cipher, … + __tests__/
contexts/       # React Context providers
constants/      # colors(palette), env, query-keys, strings
types/          # per-domain type modules (api, auth, …, ui/*)
utils/          # pure helpers
```
Conventions: kebab-case filenames, PascalCase components, one domain per
service/type file, separate request/response types, thin hooks, UI never imports
axios.

## 15. Known gotchas (pre-baked)

- **Windows / junction**: `fs.realpathSync` the root in metro + tailwind; use
  absolute content globs or the release build silently strips all styles.
- **react-native-svg on Fabric**: no animated `transform` on `<G>` — animate an
  `Animated.View` wrapper instead. RN `transformOrigin` must be a **3-value array**
  `[x, y, 0]`.
- **Third-party packages shipping uncompiled TS** (declaring an `index.js` that
  was never built): point Metro at the real `index.ts` via `resolver.resolveRequest`.
- A require cycle like `auth → api → token-refresh → auth` is fine when the shared
  piece is a lazily-constructed singleton.
- **Native-only libs break the WEB bundle**: `eas update --platform all` (and any
  `expo export` that includes web) bundles web too. A native-only package whose
  component calls `requireNativeComponent` at **import** time (e.g. react-native-webrtc)
  throws `requireNativeComponent is not a function` and aborts the **whole** update
  at ~95%. Stub it on web in metro `resolveRequest`:
  `if (platform === "web" && /^the-lib(\/|$)/.test(moduleName)) return { type: "empty" };`.
  Native platforms resolve normally, so the native OTA payload is unchanged.

## 16. Root layout provider tree

```tsx
// app/_layout.tsx — outer → inner
export default function RootLayout() {
  const [fontsLoaded] = useFonts({ AppFont: require("@/assets/fonts/App.ttf") });
  const [cacheReady, setCacheReady] = useState(false);
  useEffect(() => { void ensureCacheKey().finally(() => setCacheReady(true)); }, []);
  if (!fontsLoaded || !cacheReady) return null;           // gate on font + at-rest key

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <KeyboardProvider>
        <ThemeProvider value={navTheme}>
          <AuthProvider>
            <ContactsProvider>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
              <StatusBar style="auto" />
              <ForceUpdateGate />
            </ContactsProvider>
          </AuthProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </PersistQueryClientProvider>
  );
}
```

Mount feature providers (e.g. a `CallProvider`, §17) *inside* your app providers
(after `ContactsProvider`) so they can read auth/contacts state.

## 17. Optional add-ons (mechanisms)

Product-specific, but wired the same way whenever a product needs them:

- **Push (Firebase) + background/native entry.** `@react-native-firebase/app` +
  `/messaging` for FCM (keep `expo-notifications` for local/scheduled + channels).
  To act on a push while the JS app is **killed/backgrounded** (call-wake, data-only
  messages), register the handler at the **JS top level, before the RN tree mounts**:
  set `main` to a custom `index.js` that calls
  `messaging().setBackgroundMessageHandler(...)` (+ any native setup) and then
  `require("expo-router/entry")` **last** (require, not import, so it runs after the
  handler). `require` iOS-only native modules (PushKit) lazily behind
  `Platform.OS === "ios"` so Android/web never resolve them.
- **Remote images**: use `expo-image` (`cachePolicy="memory-disk"`, `transition`,
  `recyclingKey`, an `onError` fallback, optional per-request `headers`) — not RN
  `Image` — for consistent cross-platform caching + retry. RN `Image`'s iOS loader
  does not retry a slow/failed load; a public/CDN image path may also need a header
  (auth token or a proxy skip-warning header).
- **1:1 calls**: react-native-webrtc + react-native-callkeep (+ voip-push on iOS),
  gated behind a build flag. Remember the web-bundle stub (§15) and strip
  camera/mic/telecom permissions via a config plugin when the feature is off (§2).
- **E2EE / at-rest crypto**: tweetnacl(+util) + expo-crypto; load keys **before** the
  persist provider mounts and purge on every auth boundary (§6/§12).

---

*Adapt names/endpoints; keep the layering (component → hook → service → api client),
the transient-vs-dead auth rule (§8/§9), the single-palette styling model (§4), and
the cached-session startup (§5/§8). Those four are what make the app resilient
offline and cheap to extend.*
