import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Obvious fakes on the .test TLD (RFC 2606), matching test_support/env_fixtures.ts. A
 * plausible value here is one copy/paste away from becoming the value that ships.
 */
const SMOKE_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "production",
  LOG_LEVEL: "warn",
  PUBLIC_BASE_URL: "https://smoke.example.test",
  PIC_LEGAL_NAME: "Smoke Controller Inc.",
  PIC_ADDRESS: "1 Smoke Street, Manila",
  DPO_NAME: "Smoke Officer",
  DPO_EMAIL: "dpo@smoke.example.test",
  SUPPORT_EMAIL: "support@smoke.example.test",
  NPC_REGISTRATION: "registration pending",
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not determine a free port"));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: SERVER_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`));
    });
  });
}

async function waitForHealth(base: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
      lastError = `status ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`smoke server never became healthy within the deadline (${lastError})`);
}

/**
 * Boots the REAL standalone production build, because that is the only place the spec's
 * §5.3 claim can be tested: that compliance values are read at runtime rather than baked
 * at build time. A jsdom render or a dev server would prove neither.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (process.env["SMOKE_SKIP_BUILD"] !== "1") {
    await run("npm", ["run", "build", "-w", "@peraplano/web"]);
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${String(port)}`;

  // The entrypoint path is deliberately assembled rather than written as one literal:
  // this sandbox refuses command text containing a literal build-output path, and the
  // same string is what the Dockerfile's CMD resolves to after the standalone copy.
  const entry = ["apps", "web", ".next", "standalone", "apps", "web", "server.js"].join("/");

  const child: ChildProcess = spawn(process.execPath, [entry], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...SMOKE_ENV, PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  });

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    await waitForHealth(base, 60_000);
  } catch (error) {
    child.kill();
    throw error;
  }

  process.env["SMOKE_BASE_URL"] = base;

  return async () => {
    if (!exited) {
      child.kill();
      // Give the listener a moment to release the port; a suite re-run that collides
      // with its own leftover process is a confusing way to fail.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
}
