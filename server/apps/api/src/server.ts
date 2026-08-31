import { buildApp } from "./app.js";

const app = buildApp();

app.listen({ port: app.config.port, host: "0.0.0.0" }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
