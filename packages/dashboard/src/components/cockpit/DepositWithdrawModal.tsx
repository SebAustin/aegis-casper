"use client";

import { useState, useId } from "react";
import type { KeyboardEvent } from "react";
import type { VaultState } from "@aegis/shared";
import { useWallet } from "@/components/wallet/WalletContext";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { formatCspr, formatShares } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { TxHashChip } from "@/components/ui/TxHashChip";

type ModalStep = "amount" | "review" | "signing" | "submitted" | "error";

interface Props {
  mode: "deposit" | "withdraw";
  vaultData: VaultState | null;
  onClose: () => void;
}

const SIGNING_TIMEOUT_MS = 90_000; // DESIGN risk 5: 90s timeout

/**
 * DESIGN.md §6.4 — Deposit / Withdraw Modal.
 * FR-D-05, FR-W-01, FR-W-03.
 *
 * Accessibility:
 * - dialog / aria-modal / aria-labelledby
 * - focus trap (useFocusTrap)
 * - Escape closes in steps 1 and 2 only
 */
export function DepositWithdrawModal({ mode, vaultData, onClose }: Props) {
  const titleId = useId();
  const amountInputId = useId();
  const { state: walletState, connect, signAndDeploy } = useWallet();

  const [step, setStep] = useState<ModalStep>("amount");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [amountError, setAmountError] = useState("");

  const containerRef = useFocusTrap<HTMLDivElement>(true);

  const maxMotes =
    mode === "deposit"
      ? walletState.status === "connected"
        ? walletState.balanceMotes
        : BigInt(0)
      : vaultData?.totalShares ?? BigInt(0);

  const maxCspr = Number(maxMotes) / 1e9;
  const maxLabel =
    mode === "deposit"
      ? formatCspr(maxMotes)
      : formatShares(maxMotes);

  const amountNum = parseFloat(amount) || 0;
  const estimatedReceive =
    mode === "deposit"
      ? `~${amountNum.toFixed(6)} AEGIS`
      : `~${amountNum.toFixed(2)} CSPR`;

  // Validate amount
  function validateAmount(): boolean {
    if (!amount || amountNum <= 0) {
      setAmountError("Please enter a valid amount.");
      return false;
    }
    if (amountNum > maxCspr) {
      setAmountError("Amount exceeds your available balance.");
      return false;
    }
    setAmountError("");
    return true;
  }

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && (step === "amount" || step === "review")) {
      onClose();
    }
  };

  const handleMaxAmount = () => {
    setAmount(maxCspr.toFixed(2));
    setAmountError("");
  };

  const handleContinue = () => {
    if (validateAmount()) setStep("review");
  };

  const handleSign = async () => {
    if (walletState.status !== "connected") {
      await connect();
      return;
    }

    setStep("signing");

    // DESIGN risk 5: 90-second timeout on wallet popup.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Wallet popup may have been blocked. Check your browser and try again."
            )
          ),
        SIGNING_TIMEOUT_MS
      )
    );

    try {
      // Construct a minimal deploy stub. In a full integration, this would be
      // a properly serialised Casper deploy built with casper-js-sdk.
      const deployStub = {
        type: mode,
        amount: amountNum,
        asset: mode === "deposit" ? "CSPR" : "AEGIS",
        vaultHash: process.env["NEXT_PUBLIC_VAULT_CONTRACT_HASH"] ?? "",
        timestamp: Date.now(),
      };

      const hash = await Promise.race([
        signAndDeploy(deployStub),
        timeoutPromise,
      ]);

      setTxHash(hash);
      setStep("submitted");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Transaction cancelled. You can try again at any time.";
      setErrorMsg(msg);
      setStep("error");
    }
  };

  const title =
    mode === "deposit" ? "Deposit CSPR" : "Withdraw AEGIS";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onKeyDown={handleEscape}
      onClick={(e) => {
        // Click outside content closes if in step 1 or 2
        if (e.target === e.currentTarget && (step === "amount" || step === "review")) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-content"
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-6)",
          }}
        >
          <h2
            id={titleId}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-xl)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            {title}
          </h2>
          {(step === "amount" || step === "review" || step === "error") && (
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title} modal`}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-secondary)",
                fontSize: "var(--text-lg)",
                lineHeight: 1,
                padding: "var(--space-2)",
                borderRadius: "var(--radius-md)",
                minWidth: "44px",
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Step 1 — Amount */}
        {step === "amount" && (
          <StepAmount
            mode={mode}
            amount={amount}
            amountError={amountError}
            maxLabel={maxLabel}
            estimatedReceive={estimatedReceive}
            amountInputId={amountInputId}
            onAmountChange={(v) => { setAmount(v); setAmountError(""); }}
            onMax={handleMaxAmount}
            onContinue={handleContinue}
            walletConnected={walletState.status === "connected"}
            onConnect={connect}
          />
        )}

        {/* Step 2 — Review */}
        {step === "review" && (
          <StepReview
            mode={mode}
            amount={amountNum}
            estimatedReceive={estimatedReceive}
            onBack={() => setStep("amount")}
            onSign={handleSign}
          />
        )}

        {/* Step 3 — Signing */}
        {step === "signing" && <StepSigning />}

        {/* Step 4 — Submitted */}
        {step === "submitted" && txHash && (
          <StepSubmitted txHash={txHash} onDone={onClose} />
        )}

        {/* Error */}
        {step === "error" && (
          <StepError
            message={errorMsg}
            onRetry={() => setStep("review")}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/* ── Step sub-components ──────────────────────────────────────────────────── */

function StepAmount({
  mode,
  amount,
  amountError,
  maxLabel,
  estimatedReceive,
  amountInputId,
  onAmountChange,
  onMax,
  onContinue,
  walletConnected,
  onConnect,
}: {
  mode: "deposit" | "withdraw";
  amount: string;
  amountError: string;
  maxLabel: string;
  estimatedReceive: string;
  amountInputId: string;
  onAmountChange: (v: string) => void;
  onMax: () => void;
  onContinue: () => void;
  walletConnected: boolean;
  onConnect: () => Promise<void>;
}) {
  const unit = mode === "deposit" ? "CSPR" : "AEGIS";

  if (!walletConnected) {
    return (
      <div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-6)" }}>
          Connect your wallet to {mode} funds.
        </p>
        <Button variant="primary" onClick={onConnect} style={{ width: "100%" }}>
          Connect Wallet
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Available + MAX */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-2)",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
        }}
      >
        <span>Available: {maxLabel}</span>
        <button
          type="button"
          onClick={onMax}
          style={{
            background: "var(--color-accent-gold-10)",
            border: "1px solid var(--color-accent-gold-dim)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-accent-gold)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)",
            padding: "2px var(--space-2)",
            cursor: "pointer",
            minHeight: "44px",
            minWidth: "44px",
          }}
        >
          MAX
        </button>
      </div>

      {/* Amount input */}
      <div
        style={{
          background: "var(--color-bg-input)",
          border: `1px solid ${amountError ? "var(--color-danger)" : "var(--color-border-default)"}`,
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          padding: "var(--space-3) var(--space-4)",
          marginBottom: amountError ? "var(--space-2)" : "var(--space-4)",
        }}
      >
        <label htmlFor={amountInputId} className="sr-only">
          Amount in {unit}
        </label>
        <input
          id={amountInputId}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.000001"
          placeholder="0"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xl)",
            color: "var(--color-text-primary)",
          }}
          aria-describedby={amountError ? "amount-error" : undefined}
          aria-invalid={!!amountError || undefined}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-secondary)",
            marginLeft: "var(--space-2)",
          }}
        >
          {unit}
        </span>
      </div>

      {amountError && (
        <p
          id="amount-error"
          role="alert"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-danger)",
            marginBottom: "var(--space-4)",
          }}
        >
          {amountError}
        </p>
      )}

      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
          marginBottom: "var(--space-6)",
        }}
      >
        You will receive: {estimatedReceive}
      </p>

      <Button variant="primary" onClick={onContinue} style={{ width: "100%" }}>
        Continue →
      </Button>
    </div>
  );
}

function StepReview({
  mode,
  amount,
  estimatedReceive,
  onBack,
  onSign,
}: {
  mode: "deposit" | "withdraw";
  amount: number;
  estimatedReceive: string;
  onBack: () => void;
  onSign: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const unit = mode === "deposit" ? "CSPR" : "AEGIS";

  const handleClick = async () => {
    setIsLoading(true);
    await onSign();
    setIsLoading(false);
  };

  return (
    <div>
      <dl
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          marginBottom: "var(--space-6)",
        }}
      >
        <ReviewRow
          label={mode === "deposit" ? "Depositing" : "Redeeming"}
          value={`${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`}
        />
        <ReviewRow
          label="Receiving"
          value={estimatedReceive}
        />
        <ReviewRow
          label="Network fee"
          value="~0.001 CSPR (estimated)"
          muted
        />
      </dl>
      <hr className="divider" />
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
        <Button variant="secondary" onClick={onBack} style={{ flex: 1 }}>
          ← Back
        </Button>
        <Button
          variant="primary"
          loading={isLoading}
          onClick={handleClick}
          style={{ flex: 2 }}
        >
          Sign & {mode === "deposit" ? "Deposit" : "Withdraw"}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <dt
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-md)",
          color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
          fontWeight: muted ? "var(--weight-regular)" : "var(--weight-semibold)",
          margin: 0,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function StepSigning() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-8) 0",
        textAlign: "center",
      }}
    >
      <svg
        className="spinner"
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        style={{ color: "var(--color-accent-cyan)" }}
      >
        <circle
          cx="20"
          cy="20"
          r="16"
          stroke="var(--color-border-subtle)"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="60"
          strokeDashoffset="20"
        />
      </svg>
      <div>
        <p
          style={{
            fontSize: "var(--text-md)",
            color: "var(--color-text-primary)",
            fontWeight: "var(--weight-semibold)",
            marginBottom: "var(--space-2)",
          }}
        >
          Awaiting signature in your wallet…
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Transaction has been sent to Casper Wallet. Check the extension popup.
        </p>
      </div>
    </div>
  );
}

function StepSubmitted({ txHash, onDone }: { txHash: string; onDone: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-4) 0",
        textAlign: "center",
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        aria-label="Success"
        style={{ color: "var(--color-positive)" }}
      >
        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" fill="var(--color-positive-dim)" />
        <path d="M14 24l7 7 13-13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p
          style={{
            fontSize: "var(--text-xl)",
            color: "var(--color-text-primary)",
            fontWeight: "var(--weight-semibold)",
            marginBottom: "var(--space-4)",
          }}
        >
          Transaction Submitted
        </p>
        <TxHashChip hash={txHash} showCopy />
      </div>
      <div
        style={{
          width: "100%",
          height: "4px",
          background: "var(--color-border-subtle)",
          borderRadius: "var(--radius-xs)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "var(--color-accent-cyan)",
            borderRadius: "var(--radius-xs)",
            animation: "poll-progress 60s linear forwards",
          }}
        />
      </div>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
        Confirming on-chain…
      </p>
      <Button variant="primary" onClick={onDone} style={{ width: "100%" }}>
        Done
      </Button>
    </div>
  );
}

function StepError({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-4) 0",
        textAlign: "center",
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        aria-label="Error"
        style={{ color: "var(--color-danger)" }}
      >
        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" fill="var(--color-danger-dim)" />
        <path d="M16 16l16 16M32 16L16 32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <p
          style={{
            fontSize: "var(--text-xl)",
            color: "var(--color-text-primary)",
            fontWeight: "var(--weight-semibold)",
            marginBottom: "var(--space-2)",
          }}
        >
          Transaction Failed
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {message}
        </p>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", width: "100%" }}>
        <Button variant="secondary" onClick={onRetry} style={{ flex: 1 }}>
          ← Try again
        </Button>
        <Button variant="primary" onClick={onClose} style={{ flex: 1 }}>
          Close
        </Button>
      </div>
    </div>
  );
}
