#!/usr/bin/env node
/**
 * Build Vault + Registry wasm for Casper testnet deploy.
 *
 * cargo-odra 0.1.7 expects `{crate}_build_contract`, but this repo uses
 * per-contract bins (`vault_build_contract`, `registry_build_contract`) with
 * ODRA_MODULE set per build. This script is the supported build path.
 */

import { mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const contractsRoot = path.join(repoRoot, "contracts");
const wasmOutDir = path.join(contractsRoot, "wasm");
const targetDir = path.join(
  contractsRoot,
  "target/wasm32-unknown-unknown/release"
);

const CONTRACTS = [
  { module: "Vault", bin: "vault_build_contract", out: "Vault.wasm" },
  { module: "Registry", bin: "registry_build_contract", out: "Registry.wasm" },
];

function runCargo(bin, module) {
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--target",
      "wasm32-unknown-unknown",
      "--release",
      "--package",
      "aegis-contracts",
      "--bin",
      bin,
    ],
    {
      cwd: contractsRoot,
      env: { ...process.env, ODRA_MODULE: module },
      stdio: "inherit",
    }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function findWasmArtifact(bin) {
  const direct = path.join(targetDir, `${bin}.wasm`);
  if (existsSync(direct)) return direct;

  const depsDir = path.join(targetDir, "deps");
  const files = await readdir(depsDir);
  const hashed = files.find((f) => f.startsWith(`${bin}-`) && f.endsWith(".wasm"));
  return hashed ? path.join(depsDir, hashed) : null;
}

function rustcSupportsBulkMemoryLowering() {
  const result = spawnSync("rustc", ["--version", "--verbose"], { encoding: "utf8" });
  if (result.status !== 0) return true;
  const match = result.stdout.match(/commit-date:\s*(\S+)/);
  if (!match) return true;
  return match[1] >= "2025-02-17";
}

function runOrDie(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(
      `${label} failed: ${result.error.message}\n` +
        "Install binaryen (wasm-opt) and wabt (wasm-strip): brew install binaryen wabt\n"
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`${label} exited with code ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
}

/** Match cargo-odra's wasm post-processing (required for Casper deploy). */
function optimizeWasm(wasmPath) {
  const optArgs = ["--signext-lowering"];
  if (rustcSupportsBulkMemoryLowering()) {
    optArgs.push("--enable-bulk-memory", "--llvm-memory-copy-fill-lowering");
  }
  optArgs.push(wasmPath, "-o", wasmPath);
  runOrDie("wasm-opt", optArgs, "wasm-opt");
  runOrDie("wasm-strip", [wasmPath], "wasm-strip");
}

async function main() {
  for (const tool of ["wasm-opt", "wasm-strip"]) {
    const found = spawnSync("which", [tool], { stdio: "ignore" });
    if (found.status !== 0) {
      process.stderr.write(
        `Missing required tool: ${tool}\n` +
          "Casper rejects raw rustc wasm (bulk memory). Install post-processors:\n" +
          "  brew install binaryen wabt    # macOS\n" +
          "  apt install binaryen wabt   # Debian/Ubuntu\n"
      );
      process.exit(1);
    }
  }

  await mkdir(wasmOutDir, { recursive: true });

  for (const { module, bin, out } of CONTRACTS) {
    process.stdout.write(`Building ${module} (${bin})...\n`);
    runCargo(bin, module);
    const source = await findWasmArtifact(bin);
    const dest = path.join(wasmOutDir, out);
    if (!source) {
      process.stderr.write(
        `Missing wasm artifact for ${bin} under ${targetDir}\n` +
          "Ensure Rust nightly-2026-01-01 and wasm32-unknown-unknown are installed.\n"
      );
      process.exit(1);
    }
    await copyFile(source, dest);
    optimizeWasm(dest);
    process.stdout.write(`Wrote ${dest} (wasm-opt + wasm-strip applied)\n`);
  }
}

await main();
