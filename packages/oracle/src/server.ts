/**
 * Oracle server entry point.
 *
 * Binds the Express app to the configured port.
 * Run via: pnpm --filter @aegis/oracle start
 */

import { loadEnv } from "@aegis/shared";
import { createApp } from "./app.js";

const env = loadEnv();
const app = createApp();

const port = env.ORACLE_PORT;

app.listen(port, () => {
  process.stdout.write(
    JSON.stringify({
      level: "info",
      service: "oracle",
      msg: "Oracle server started",
      port,
      facilitator: env.X402_FACILITATOR,
      oraclePriceMotes: env.ORACLE_PRICE_MOTES.toString(),
    }) + "\n"
  );
});
