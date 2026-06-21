#!/usr/bin/env node
/**
 * deploy-testnet.mjs — install the Aegis Vault + Registry to Casper testnet,
 * then seed agent reputation (SC-01, A-018).
 *
 * This script performs REAL on-chain writes. It is intentionally gated:
 *   - `ALLOW_TESTNET_DEPLOY=true` must be set (guardrail against accidental runs).
 *   - `AGENT_PRIVATE_KEY_HEX` must hold a funded testnet ED25519 secret key (hex).
 * Without a funded key the script will fail at submission — by design — but the
 * construction / signing / submission logic itself is real and correct.
 *
 * Flow:
 *   1. Build the two install Transactions from the compiled Odra wasm
 *      (SessionBuilder.installOrUpgrade) with the standard Odra cfg args + the
 *      `init(owner)` constructor arg.
 *   2. Sign with the agent key, submit via JSON-RPC, wait for execution.
 *   3. Read the resulting contract package hashes from the deployer's named keys.
 *   4. Persist hashes + deploy hashes + timestamp to
 *      contracts/deployments/testnet.json.
 *   5. Seed reputation: register_agent(agent), then
 *      update_reputation(agent, +REPUTATION_SEED_SCORE, hash) (A-018).
 *
 * WASM build step (run before this script):
 *   cd contracts && cargo odra build
 * which produces:
 *   contracts/wasm/Vault.wasm
 *   contracts/wasm/Registry.wasm
 * This script also accepts the raw cargo target paths as a fallback:
 *   contracts/target/wasm32-unknown-unknown/release/vault_build_contract.wasm
 *   contracts/target/wasm32-unknown-unknown/release/registry_build_contract.wasm
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Load repo-root `.env` into process.env (does not override existing vars). */
function loadDotEnv() {
  const envPath = path.join(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

// ── Structured logging ──────────────────────────────────────────────────────

function log(level, msg, extra = {}) {
  process.stdout.write(
    JSON.stringify({ level, service: "deploy-testnet", msg, ...extra }) + "\n"
  );
}
function fail(msg, extra = {}) {
  process.stderr.write(
    JSON.stringify({ level: "error", service: "deploy-testnet", msg, ...extra }) +
      "\n"
  );
  process.exit(1);
}

// ── Config / guardrails ─────────────────────────────────────────────────────

const ALLOW = process.env.ALLOW_TESTNET_DEPLOY === "true";
const PRIVATE_KEY_HEX = process.env.AGENT_PRIVATE_KEY_HEX ?? "";
const NETWORK = process.env.CASPER_NETWORK ?? "casper-test";
const NODE_RPC_URL =
  process.env.CASPER_NODE_RPC_URL ?? "https://node.testnet.cspr.cloud/rpc";
// cspr.cloud-hosted nodes require an API key via the `Authorization` header. A
// self-hosted / public RPC node does not. We attach the header only when a key
// is present so both node types work.
const CSPR_CLOUD_API_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const SEED_SCORE = Number.parseInt(
  process.env.REPUTATION_SEED_SCORE ?? "50",
  10
);

// Payment ceilings (motes). Large Odra wasm installs need far more gas than small calls.
// 250 CSPR was too low (out-of-gas). Empirically ~600 CSPR succeeds for these wasm
// artifacts on casper-test; higher values can be rejected as invalid transactions.
const INSTALL_PAYMENT_MOTES = Number.parseInt(
  process.env.INSTALL_PAYMENT_MOTES ?? "600000000000",
  10
); // 600 CSPR default
const INSTALL_GAS_PRICE_TOLERANCE = Number.parseInt(
  process.env.INSTALL_GAS_PRICE_TOLERANCE ?? "1",
  10
);
const CALL_PAYMENT_MOTES = 5_000_000_000; // 5 CSPR
const TX_TTL_MS = 1_800_000; // 30 minutes
const EXEC_TIMEOUT_MS = 180_000; // 3 min wait for execution

function resolveWasm(name, fallback) {
  const built = path.join(repoRoot, "contracts", "wasm", name);
  if (existsSync(built)) return built;
  const fb = path.join(repoRoot, fallback);
  if (existsSync(fb)) return fb;
  return null;
}

const VAULT_WASM = resolveWasm(
  "Vault.wasm",
  "contracts/target/wasm32-unknown-unknown/release/vault_build_contract.wasm"
);
const REGISTRY_WASM = resolveWasm(
  "Registry.wasm",
  "contracts/target/wasm32-unknown-unknown/release/registry_build_contract.wasm"
);

const DEPLOYMENTS_PATH = path.join(
  repoRoot,
  "contracts",
  "deployments",
  "testnet.json"
);

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!ALLOW) {
    fail(
      "Refusing to deploy: set ALLOW_TESTNET_DEPLOY=true to confirm a real testnet deploy."
    );
  }
  if (
    !PRIVATE_KEY_HEX ||
    PRIVATE_KEY_HEX.startsWith("replace-with") ||
    PRIVATE_KEY_HEX.includes(".pem") ||
    PRIVATE_KEY_HEX.includes("/")
  ) {
    fail(
      "AGENT_PRIVATE_KEY_HEX is not set to a real funded testnet secret key (hex). " +
        "Ensure repo-root .env contains a 64-char hex key (not a .pem path)."
    );
  }
  if (!VAULT_WASM || !REGISTRY_WASM) {
    fail(
      "Compiled wasm not found. Run `cd contracts && cargo odra build` first.",
      { vaultWasm: VAULT_WASM, registryWasm: REGISTRY_WASM }
    );
  }

  // Load the SDK, normalizing ESM `.default` interop (casper-js-sdk ships CJS).
  const mod = await import("casper-js-sdk");
  const sdk = mod.default ?? mod;
  const {
    PrivateKey,
    KeyAlgorithm,
    SessionBuilder,
    ContractCallBuilder,
    RpcClient,
    HttpHandler,
    Args,
    CLValue,
    CLTypeUInt8,
    CLTypeUInt32,
    CLTypeTuple2,
    Key,
  } = sdk;

  const privateKey = PrivateKey.fromHex(
    PRIVATE_KEY_HEX,
    (process.env.AGENT_KEY_ALGORITHM ?? "ed25519").toLowerCase() === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519
  );
  const publicKey = privateKey.publicKey;
  const ownerAccountHash = publicKey.accountHash();
  const ownerAccountHashStr = ownerAccountHash.toPrefixedString();

  const httpHandler = new HttpHandler(NODE_RPC_URL);
  if (
    CSPR_CLOUD_API_KEY &&
    !CSPR_CLOUD_API_KEY.startsWith("replace-with") &&
    typeof httpHandler.setCustomHeaders === "function"
  ) {
    // Never logged. Authenticates the cspr.cloud-hosted RPC node.
    httpHandler.setCustomHeaders({ Authorization: CSPR_CLOUD_API_KEY });
  }
  const rpc = new RpcClient(httpHandler);

  const minBalanceMotes =
    INSTALL_PAYMENT_MOTES * 2 + CALL_PAYMENT_MOTES * 3;
  let balanceMotes = 0n;
  try {
    const balanceResult = await rpc.queryLatestBalance(
      sdk.PurseIdentifier.fromPublicKey(publicKey)
    );
    balanceMotes = BigInt(balanceResult?.balance?.value ?? 0);
  } catch (err) {
    log("warn", "Could not preflight account balance; continuing deploy", {
      error: String(err?.message ?? err),
    });
  }
  log("info", "Deploy starting", {
    network: NETWORK,
    node: NODE_RPC_URL,
    owner: ownerAccountHashStr,
    installPaymentMotes: INSTALL_PAYMENT_MOTES,
    installGasPriceTolerance: INSTALL_GAS_PRICE_TOLERANCE,
    balanceMotes: balanceMotes.toString(),
    minBalanceMotes: String(minBalanceMotes),
  });
  if (balanceMotes > 0n && balanceMotes < BigInt(minBalanceMotes)) {
    fail(
      "Deploy account balance too low for two contract installs plus seed calls. " +
        "Fund via https://testnet.cspr.live/tools/faucet",
      {
        balanceMotes: balanceMotes.toString(),
        minBalanceMotes: String(minBalanceMotes),
      }
    );
  }

  // 1+2. Install vault and registry.
  const vault = await installContract({
    sdk,
    rpc,
    privateKey,
    publicKey,
    wasmPath: VAULT_WASM,
    packageKeyName: "vault_package_hash",
    ownerKey: Key.newKey(ownerAccountHashStr),
    label: "vault",
  });
  const registry = await installContract({
    sdk,
    rpc,
    privateKey,
    publicKey,
    wasmPath: REGISTRY_WASM,
    packageKeyName: "registry_package_hash",
    ownerKey: Key.newKey(ownerAccountHashStr),
    label: "registry",
  });

  // 3+4. Persist deployment metadata.
  const deployment = {
    vault_contract_hash: vault.contractHash,
    vault_deploy_hash: vault.txHash,
    registry_contract_hash: registry.contractHash,
    registry_deploy_hash: registry.txHash,
    network: NETWORK,
    deployed_at: new Date().toISOString(),
  };
  await mkdir(path.dirname(DEPLOYMENTS_PATH), { recursive: true });
  await writeFile(DEPLOYMENTS_PATH, JSON.stringify(deployment, null, 2) + "\n");
  log("info", "Wrote deployment metadata", { path: DEPLOYMENTS_PATH });

  // 5. Seed reputation (A-018): register, then a positive update so the seed is
  // itself an auditable on-chain reputation transaction.
  const agentKey = Key.newKey(ownerAccountHashStr); // agent == owner on testnet (A-016)

  await callContract({
    sdk,
    rpc,
    privateKey,
    publicKey,
    contractHash: registry.contractHash,
    entryPoint: "register_agent",
    args: Args.fromMap({ agent: CLValue.newCLKey(agentKey) }),
    label: "register_agent",
  });

  const rationaleHash = await seedRationaleHash();
  await callContract({
    sdk,
    rpc,
    privateKey,
    publicKey,
    contractHash: registry.contractHash,
    entryPoint: "update_reputation",
    args: Args.fromMap({
      agent: CLValue.newCLKey(agentKey),
      delta: CLValue.newCLInt64(SEED_SCORE),
      rationale_hash: CLValue.newCLByteArray(rationaleHash),
    }),
    label: "update_reputation(seed)",
  });

  log("info", "Deploy + seed complete", {
    vault: vault.contractHash,
    registry: registry.contractHash,
    seedScore: SEED_SCORE,
  });
}

// ── Install ──────────────────────────────────────────────────────────────────

async function installContract({
  sdk,
  rpc,
  privateKey,
  publicKey,
  wasmPath,
  packageKeyName,
  ownerKey,
  label,
}) {
  const { SessionBuilder, Args, CLValue } = sdk;

  log("info", `Building install tx for ${label}`, { wasmPath, packageKeyName });
  const wasm = new Uint8Array(await readFile(wasmPath));

  // Standard Odra 2.x install args: the cfg keys control the package-hash named
  // key, key override, and upgradability; `owner` is the contract constructor arg.
  // `odra_cfg_is_upgrade` is required — without it Odra reverts with User error
  // 64658 (MissingArg = 122, encoded as 64536 + 122).
  const args = Args.fromMap({
    odra_cfg_package_hash_key_name: CLValue.newCLString(packageKeyName),
    odra_cfg_allow_key_override: CLValue.newCLValueBool(true),
    odra_cfg_is_upgradable: CLValue.newCLValueBool(true),
    odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
    owner: CLValue.newCLKey(ownerKey),
  });

  const tx = new SessionBuilder()
    .from(publicKey)
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(args)
    .chainName(NETWORK)
    .payment(INSTALL_PAYMENT_MOTES, INSTALL_GAS_PRICE_TOLERANCE)
    .build();

  tx.sign(privateKey);

  const putResult = await rpc.putTransaction(tx);
  const txHash = putResult.transactionHash.toHex();
  log("info", `Submitted install tx for ${label}`, { txHash });

  await waitForSuccess(sdk, rpc, tx, label);

  const contractHash = await readPackageHash(
    sdk,
    rpc,
    publicKey,
    packageKeyName,
    label
  );
  log("info", `Installed ${label}`, { contractHash, txHash });
  return { contractHash, txHash };
}

// ── Contract call ──────────────────────────────────────────────────────────

async function callContract({
  sdk,
  rpc,
  privateKey,
  publicKey,
  contractHash,
  entryPoint,
  args,
  label,
}) {
  const { ContractCallBuilder } = sdk;

  log("info", `Building call tx: ${label}`, { entryPoint, contractHash });
  const tx = new ContractCallBuilder()
    .from(publicKey)
    .byPackageHash(stripPrefix(contractHash))
    .entryPoint(entryPoint)
    .runtimeArgs(args)
    .chainName(NETWORK)
    .payment(CALL_PAYMENT_MOTES)
    .ttl(TX_TTL_MS)
    .build();

  tx.sign(privateKey);

  const putResult = await rpc.putTransaction(tx);
  const txHash = putResult.transactionHash.toHex();
  log("info", `Submitted call tx: ${label}`, { txHash });

  await waitForSuccess(sdk, rpc, tx, label);
  log("info", `Executed ${label}`, { txHash });
  return { txHash };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitForSuccess(sdk, rpc, tx, label) {
  const result = await rpc.waitForTransaction(tx, EXEC_TIMEOUT_MS);
  const execResult = result?.executionInfo?.executionResult;
  const errorMessage = execResult?.errorMessage;
  const status = execResult?.status;
  if (errorMessage) {
    fail(`On-chain execution failed for ${label}`, { errorMessage, status });
  }
  if (status && String(status).toLowerCase().includes("failure")) {
    fail(`On-chain execution failed for ${label}`, {
      status,
      errorMessage: errorMessage ?? null,
    });
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After an Odra install, the contract package hash is stored under
 * `<packageKeyName>` in the deployer's named keys. State can lag briefly after
 * finalization, so we poll entity/account views for a short window.
 */
async function readPackageHash(sdk, rpc, publicKey, packageKeyName, label) {
  const { EntityIdentifier, AccountIdentifier } = sdk;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const entityResult = await rpc.getLatestEntity(
      EntityIdentifier.fromPublicKey(publicKey)
    );
    const entityNamedKeys =
      entityResult?.entity?.addressableEntity?.namedKeys ??
      entityResult?.entity?.legacyAccount?.namedKeys ??
      [];
    const fromEntity = entityNamedKeys.find((nk) => nk.name === packageKeyName);
    if (fromEntity) {
      return fromEntity.key.toPrefixedString();
    }

    try {
      const accountInfo = await rpc.getAccountInfo(
        null,
        new AccountIdentifier(undefined, publicKey)
      );
      const accountNamedKeys =
        accountInfo?.account?.namedKeys ??
        accountInfo?.accountInfo?.namedKeys ??
        [];
      const fromAccount = accountNamedKeys.find(
        (nk) => nk.name === packageKeyName
      );
      if (fromAccount) {
        return fromAccount.key.toPrefixedString();
      }
    } catch {
      // Account-info RPC may be unavailable on some nodes; entity poll is primary.
    }

    await sleep(2_000);
  }

  fail(`Could not find named key ${packageKeyName} for ${label}`, {
    hint:
      "Install may have failed (e.g. out of gas) or payment was too low. " +
      "Try raising INSTALL_PAYMENT_MOTES and fund the deploy account.",
  });
}

function stripPrefix(hash) {
  return hash.replace(/^(hash-|contract-|package-)/, "");
}

/**
 * 32-byte rationale hash for the seed update. We commit to a stable string so
 * the on-chain seed is auditable; sha256 keeps it deterministic.
 */
async function seedRationaleHash() {
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256")
    .update("aegis:reputation-seed:A-018")
    .digest();
  return new Uint8Array(digest); // 32 bytes
}

main().catch((err) => {
  fail("Unhandled error during deploy", { error: String(err?.stack ?? err) });
});
