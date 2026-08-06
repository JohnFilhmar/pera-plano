export const ENV = {
  /** Server base URL. Set per EAS profile / .env as EXPO_PUBLIC_API_URL. */
  API_URL: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
} as const;
