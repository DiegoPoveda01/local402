import {
  Address,
  Operation,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  gatherAuthEntrySignatureStatus,
  getAddressCredentials,
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  isStellarNetwork,
  STELLAR_WILDCARD_CAIP2,
  type FacilitatorStellarSigner,
  type RpcConfig,
} from "@x402/stellar";
import { FX_SCHEME, SIGNING_GRACE_SECONDS, type FxExtra } from "./extra.js";
import { inclusionFeeBid } from "./fees.js";

export interface ExactFxFacilitatorOptions {
  fxContract: string;
  /** Assets payers may spend; each needs a Soroswap pool against the requirements' asset. */
  sendAssets: string[];
  rpcConfig?: RpcConfig;
  /** A swap costs more resources than a plain transfer. Default 1_000_000 stroops (0.1 XLM). */
  maxTransactionFeeStroops?: number;
  /** Ceiling for the inclusion fee bid on top of resources, see `inclusionFeeBid`. Default 10_000 stroops. */
  maxInclusionFeeStroops?: number;
  /** Picks the account that settles; see `ChannelPool.select`. Default: round-robin. */
  selectSigner?: (addresses: readonly string[]) => string;
  /**
   * Wall-clock seconds a whole `settle` may take, confirmation included. Default 45.
   *
   * It must stay below the host's request limit (Vercel functions are capped at 60 s), because being
   * killed mid-confirmation is the one outcome with no recovery: the transaction is on the ledger and
   * the buyer is told the payment failed. Running out returns `settle_exact_fx_confirmation_pending`
   * with the hash instead.
   */
  settleBudgetSeconds?: number;
}

type Checked =
  | { response: VerifyResponse & { isValid: false } }
  | {
      response: VerifyResponse & { isValid: true };
      transaction: Transaction;
      simulation: Api.SimulateTransactionSuccessResponse;
    };

const SIGNATURE_EXPIRATION_LEDGER_TOLERANCE = 2;
// The payer sets the deadline before signing, so it may sit up to a signing grace ahead of the window
// this facilitator would compute now. Clock skew between the two machines gets the extra 30 s.
const DEADLINE_TOLERANCE_SECONDS = SIGNING_GRACE_SECONDS + 30;
/** Longest `maxTimeoutSeconds` the facilitator will work with; see `timeoutSeconds`. */
const MAX_TIMEOUT_SECONDS = 300;
const DEFAULT_SETTLE_BUDGET_SECONDS = 45;
const POLL_INTERVAL_MS = 1_000;

function invalid(invalidReason: string, payer?: string): Checked {
  return { response: { isValid: false, invalidReason, payer } };
}

/**
 * `maxTimeoutSeconds` as a usable number, or undefined.
 *
 * The x402 facilitator passes `paymentRequirements` straight from the request body without schema
 * validation, so a missing field would turn the deadline and expiration comparisons below into
 * `NaN` tests — which are always false, quietly removing both bounds.
 */
function timeoutSeconds(requirements: PaymentRequirements): number | undefined {
  const seconds = Number(requirements.maxTimeoutSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) return undefined;
  return Math.floor(seconds);
}

function contractFn(fn: xdr.SorobanAuthorizedFunction) {
  if (fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    return undefined;
  }
  const call = fn.contractFn();
  return {
    contract: Address.fromScAddress(call.contractAddress()).toString(),
    name: call.functionName().toString(),
    args: call.args(),
  };
}

/** Facilitator side of `exact-fx`: verifies and submits FxPay `pay` transactions, sponsoring fees. */
export class ExactFxFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = FX_SCHEME;
  readonly caipFamily = STELLAR_WILDCARD_CAIP2;

  private readonly signers: Map<string, FacilitatorStellarSigner>;
  private readonly selectSigner: (addresses: readonly string[]) => string;

  constructor(
    signers: FacilitatorStellarSigner | FacilitatorStellarSigner[],
    private readonly options: ExactFxFacilitatorOptions,
  ) {
    const list = Array.isArray(signers) ? signers : [signers];
    if (!list.length) throw new Error("At least one signer is required");
    this.signers = new Map(list.map((signer) => [signer.address, signer]));
    let next = 0;
    this.selectSigner = options.selectSigner ?? ((addresses) => addresses[next++ % addresses.length]);
  }

  getExtra(): Record<string, unknown> {
    const extra: FxExtra = {
      areFeesSponsored: true,
      fxContract: this.options.fxContract,
      sendAssets: this.options.sendAssets,
    };
    return { ...extra };
  }

  getSigners(): string[] {
    return [...this.signers.keys()];
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return (await this.check(payload, requirements)).response;
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const network = payload.accepted.network;
    // Everything below shares one wall-clock budget, so the answer always beats the host's request limit.
    const budgetEndsAt = Date.now() + (this.options.settleBudgetSeconds ?? DEFAULT_SETTLE_BUDGET_SECONDS) * 1_000;
    const checked = await this.check(payload, requirements);
    const payer = checked.response.payer;
    if (!("transaction" in checked)) {
      return { success: false, network, transaction: "", errorReason: checked.response.invalidReason, payer };
    }

    let hash = "";
    try {
      const server = getRpcClient(requirements.network, this.options.rpcConfig);
      const networkPassphrase = getNetworkPassphrase(requirements.network);
      const invoke = checked.transaction.operations[0] as Operation.InvokeHostFunction;
      const signer = this.signers.get(this.selectSigner([...this.signers.keys()]));
      if (!signer) {
        return { success: false, network, transaction: "", errorReason: "settle_exact_fx_signer_selection_failed", payer };
      }
      const account = await server.getAccount(signer.address);
      // The builder adds the simulated resource fee to this inclusion bid.
      const rebuilt = new TransactionBuilder(account, {
        fee: String(await this.inclusionFee(server)),
        networkPassphrase,
        sorobanData: checked.simulation.transactionData.build(),
      })
        .setTimeout(timeoutSeconds(requirements) ?? MAX_TIMEOUT_SECONDS)
        .addOperation(Operation.invokeHostFunction({ func: invoke.func, auth: invoke.auth }))
        .build();

      const { signedTxXdr, error } = await signer.signTransaction(rebuilt.toXDR(), { networkPassphrase });
      if (error) {
        return { success: false, network, transaction: "", errorReason: "settle_exact_fx_signing_failed", payer };
      }
      const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
      if (sent.status !== "PENDING") {
        return { success: false, network, transaction: "", errorReason: "settle_exact_fx_submission_failed", payer };
      }
      hash = sent.hash;
      const result = await this.awaitTransaction(server, hash, budgetEndsAt);
      if (!result) {
        return { success: false, network, transaction: hash, errorReason: "settle_exact_fx_confirmation_pending", payer };
      }
      if (result.status !== Api.GetTransactionStatus.SUCCESS) {
        return { success: false, network, transaction: hash, errorReason: "settle_exact_fx_transaction_failed", payer };
      }
      // `pay` returns the send-asset amount the swap consumed; the rest was refunded to the payer.
      const sendAsset = scValToNative(invoke.func.invokeContract().args()[1]) as string;
      const sendAmount = result.returnValue ? String(scValToNative(result.returnValue)) : undefined;
      return { success: true, network, transaction: hash, payer, extra: { sendAsset, sendAmount } };
    } catch (error) {
      console.error("exact-fx settlement error:", error);
      // With a hash the transaction reached the network, so its fate is unknown rather than failed.
      const errorReason = hash ? "settle_exact_fx_confirmation_pending" : "unexpected_settle_error";
      return { success: false, network, transaction: hash, errorReason, payer };
    }
  }

  /**
   * Waits for a submitted transaction until `deadlineMs`, and returns undefined if it is still
   * unconfirmed by then. The SDK's `pollTransaction` counts attempts rather than time, so it cannot
   * promise to return before the host kills the request.
   */
  private async awaitTransaction(
    server: ReturnType<typeof getRpcClient>,
    hash: string,
    deadlineMs: number,
  ): Promise<Api.GetTransactionResponse | undefined> {
    for (;;) {
      const response = await server.getTransaction(hash);
      if (response.status !== Api.GetTransactionStatus.NOT_FOUND) return response;
      if (Date.now() + POLL_INTERVAL_MS >= deadlineMs) return undefined;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async check(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Checked> {
    const { fxContract, sendAssets, rpcConfig } = this.options;
    if (payload.x402Version !== 2) return invalid("invalid_x402_version");
    if (payload.accepted.scheme !== FX_SCHEME || requirements.scheme !== FX_SCHEME) {
      return invalid("unsupported_scheme");
    }
    if (payload.accepted.network !== requirements.network) return invalid("network_mismatch");
    if (!isStellarNetwork(requirements.network)) return invalid("invalid_network");
    const maxTimeoutSeconds = timeoutSeconds(requirements);
    if (maxTimeoutSeconds === undefined) return invalid("invalid_exact_fx_requirements_bad_timeout");

    const networkPassphrase = getNetworkPassphrase(requirements.network);
    let transaction: Transaction;
    try {
      transaction = new Transaction(String((payload.payload as { transaction?: unknown }).transaction), networkPassphrase);
    } catch {
      return invalid("invalid_exact_fx_payload_malformed");
    }

    const [operation] = transaction.operations;
    if (transaction.operations.length !== 1 || operation.type !== "invokeHostFunction") {
      return invalid("invalid_exact_fx_payload_wrong_operation");
    }
    if (this.signers.has(transaction.source) || (operation.source && this.signers.has(operation.source))) {
      return invalid("invalid_exact_fx_payload_unsafe_tx_or_op_source");
    }
    if (operation.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
      return invalid("invalid_exact_fx_payload_wrong_operation");
    }

    const call = operation.func.invokeContract();
    const args = call.args();
    if (
      Address.fromScAddress(call.contractAddress()).toString() !== fxContract ||
      call.functionName().toString() !== "pay" ||
      args.length !== 7
    ) {
      return invalid("invalid_exact_fx_payload_wrong_invocation");
    }

    const [from, sendAsset, maxSend, destAsset, destAmount, payTo, deadline] = args.map((arg) => scValToNative(arg));
    if (this.signers.has(from)) return invalid("invalid_exact_fx_payload_facilitator_is_payer");
    if (!sendAssets.includes(sendAsset)) return invalid("invalid_exact_fx_payload_unsupported_send_asset", from);
    if (destAsset !== requirements.asset) return invalid("invalid_exact_fx_payload_wrong_asset", from);
    if (destAmount !== BigInt(requirements.amount)) return invalid("invalid_exact_fx_payload_wrong_amount", from);
    if (payTo !== requirements.payTo) return invalid("invalid_exact_fx_payload_wrong_recipient", from);
    const now = Math.floor(Date.now() / 1000);
    // Two separate failures, because the payer can act on one of them: an expired deadline means the
    // payload took too long between signing and arriving here, and signing again fixes it.
    if (Number(deadline) <= now) return invalid("invalid_exact_fx_payload_deadline_expired", from);
    if (Number(deadline) > now + maxTimeoutSeconds + DEADLINE_TOLERANCE_SECONDS) {
      return invalid("invalid_exact_fx_payload_deadline_too_far", from);
    }

    const server = getRpcClient(requirements.network, rpcConfig);
    const latestLedger = await server.getLatestLedger();
    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(requirements.network);
    const maxLedger = latestLedger.sequence + Math.ceil(maxTimeoutSeconds / ledgerSeconds);
    // The signature expiration was fixed before the wallet prompt too, so it gets the same grace.
    const ledgerTolerance = SIGNATURE_EXPIRATION_LEDGER_TOLERANCE + Math.ceil(DEADLINE_TOLERANCE_SECONDS / ledgerSeconds);

    // The payer must authorize exactly `pay(args)` and, inside it, the transfer of `maxSend` into FxPay.
    const auth = operation.auth ?? [];
    if (auth.length !== 1) return invalid("invalid_exact_fx_payload_unexpected_auth_entries", from);
    const credentials = getAddressCredentials(auth[0].credentials());
    if (!credentials) return invalid("invalid_exact_fx_payload_unsupported_credential_type", from);
    if (Address.fromScAddress(credentials.address()).toString() !== from) {
      return invalid("invalid_exact_fx_payload_auth_not_from_payer", from);
    }
    if (credentials.signatureExpirationLedger() > maxLedger + ledgerTolerance) {
      return invalid("invalid_exact_fx_signature_expiration_too_far", from);
    }
    const root = auth[0].rootInvocation();
    const rootFn = contractFn(root.function());
    const sameArgs = (a: xdr.ScVal[], b: xdr.ScVal[]) =>
      a.length === b.length && a.every((value, i) => value.toXDR("base64") === b[i].toXDR("base64"));
    if (!rootFn || rootFn.contract !== fxContract || rootFn.name !== "pay" || !sameArgs(rootFn.args, args)) {
      return invalid("invalid_exact_fx_payload_wrong_auth_root", from);
    }
    const subs = root.subInvocations();
    const subFn = subs.length === 1 ? contractFn(subs[0].function()) : undefined;
    const subArgs = subFn?.args.map((arg) => scValToNative(arg));
    if (
      !subFn ||
      subs[0].subInvocations().length !== 0 ||
      subFn.contract !== sendAsset ||
      subFn.name !== "transfer" ||
      subArgs?.length !== 3 ||
      subArgs[0] !== from ||
      subArgs[1] !== fxContract ||
      subArgs[2] !== maxSend
    ) {
      return invalid("invalid_exact_fx_payload_wrong_auth_subinvocation", from);
    }

    const simulation = await server.simulateTransaction(transaction);
    if (!Api.isSimulationSuccess(simulation)) {
      console.error("exact-fx simulation error:", simulation.error);
      return invalid("invalid_exact_fx_payload_simulation_failed", from);
    }
    const fee = Number(simulation.minResourceFee) + this.maxInclusionFee;
    if (fee > (this.options.maxTransactionFeeStroops ?? 1_000_000)) {
      return invalid("invalid_exact_fx_payload_fee_exceeds_maximum", from);
    }
    if (!this.deliversExactAmount(simulation, requirements, destAmount)) {
      return invalid("invalid_exact_fx_payload_no_delivery", from);
    }
    if (this.movesFacilitatorFunds(simulation)) {
      return invalid("invalid_exact_fx_payload_moves_facilitator_funds", from);
    }

    const signatures = gatherAuthEntrySignatureStatus({ transaction, simulationResponse: simulation });
    if (!signatures.alreadySigned.includes(from)) return invalid("invalid_exact_fx_payload_missing_payer_signature", from);
    if (signatures.pendingSignature.length > 0) {
      return invalid("invalid_exact_fx_payload_unexpected_pending_signatures", from);
    }

    return { response: { isValid: true, payer: from }, transaction, simulation };
  }

  private get maxInclusionFee(): number {
    return this.options.maxInclusionFeeStroops ?? 10_000;
  }

  private inclusionFee(server: ReturnType<typeof getRpcClient>): Promise<number> {
    return inclusionFeeBid(server, this.maxInclusionFee);
  }

  /** Defense in depth: no simulated event may move tokens out of an account the facilitator signs for. */
  private movesFacilitatorFunds(simulation: Api.SimulateTransactionSuccessResponse): boolean {
    return simulation.events.some((diagnostic) => {
      const event = diagnostic.event();
      if (event.type().name !== "contract") return false;
      const topics = event.body().v0().topics();
      if (topics.length < 2 || topics[0].switch().name !== "scvSymbol") return false;
      const name = topics[0].sym().toString();
      return ["transfer", "burn", "approve"].includes(name) && this.signers.has(String(scValToNative(topics[1])));
    });
  }

  /** Defense in depth: the simulated events must include FxPay delivering `amount` of the asset to `payTo`. */
  private deliversExactAmount(
    simulation: Api.SimulateTransactionSuccessResponse,
    requirements: PaymentRequirements,
    amount: bigint,
  ): boolean {
    return simulation.events.some((diagnostic) => {
      const event = diagnostic.event();
      const contractId = event.contractId();
      if (event.type().name !== "contract" || !contractId) return false;
      const eventAsset = Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(contractId)).toString();
      const topics = event.body().v0().topics();
      if (eventAsset !== requirements.asset || topics.length < 3 || topics[0].switch().name !== "scvSymbol") {
        return false;
      }
      const data = scValToNative(event.body().v0().data());
      const value = typeof data === "bigint" ? data : data?.amount;
      return (
        topics[0].sym().toString() === "transfer" &&
        scValToNative(topics[1]) === this.options.fxContract &&
        scValToNative(topics[2]) === requirements.payTo &&
        value === amount
      );
    });
  }
}
