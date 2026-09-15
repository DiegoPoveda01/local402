import {
  Address,
  BASE_FEE,
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
import { FX_SCHEME, type FxExtra } from "./extra.js";

export interface ExactFxFacilitatorOptions {
  fxContract: string;
  /** Assets payers may spend; each needs a Soroswap pool against the requirements' asset. */
  sendAssets: string[];
  rpcConfig?: RpcConfig;
  /** A swap costs more resources than a plain transfer. Default 1_000_000 stroops (0.1 XLM). */
  maxTransactionFeeStroops?: number;
}

type Checked =
  | { response: VerifyResponse & { isValid: false } }
  | {
      response: VerifyResponse & { isValid: true };
      transaction: Transaction;
      simulation: Api.SimulateTransactionSuccessResponse;
    };

const SIGNATURE_EXPIRATION_LEDGER_TOLERANCE = 2;
const DEADLINE_TOLERANCE_SECONDS = 30;

function invalid(invalidReason: string, payer?: string): Checked {
  return { response: { isValid: false, invalidReason, payer } };
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

  constructor(
    private readonly signer: FacilitatorStellarSigner,
    private readonly options: ExactFxFacilitatorOptions,
  ) {}

  getExtra(): Record<string, unknown> {
    const extra: FxExtra = {
      areFeesSponsored: true,
      fxContract: this.options.fxContract,
      sendAssets: this.options.sendAssets,
    };
    return { ...extra };
  }

  getSigners(): string[] {
    return [this.signer.address];
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return (await this.check(payload, requirements)).response;
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const network = payload.accepted.network;
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
      const account = await server.getAccount(this.signer.address);
      const rebuilt = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
        sorobanData: checked.simulation.transactionData.build(),
      })
        .setTimeout(requirements.maxTimeoutSeconds)
        .addOperation(Operation.invokeHostFunction({ func: invoke.func, auth: invoke.auth }))
        .build();

      const { signedTxXdr, error } = await this.signer.signTransaction(rebuilt.toXDR(), { networkPassphrase });
      if (error) {
        return { success: false, network, transaction: "", errorReason: "settle_exact_fx_signing_failed", payer };
      }
      const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
      if (sent.status !== "PENDING") {
        return { success: false, network, transaction: "", errorReason: "settle_exact_fx_submission_failed", payer };
      }
      hash = sent.hash;
      const result = await server.pollTransaction(hash, { attempts: requirements.maxTimeoutSeconds });
      if (result.status !== Api.GetTransactionStatus.SUCCESS) {
        return { success: false, network, transaction: hash, errorReason: "settle_exact_fx_transaction_failed", payer };
      }
      return { success: true, network, transaction: hash, payer };
    } catch (error) {
      console.error("exact-fx settlement error:", error);
      return { success: false, network, transaction: hash, errorReason: "unexpected_settle_error", payer };
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
    if (transaction.source === this.signer.address || operation.source === this.signer.address) {
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
    if (from === this.signer.address) return invalid("invalid_exact_fx_payload_facilitator_is_payer");
    if (!sendAssets.includes(sendAsset)) return invalid("invalid_exact_fx_payload_unsupported_send_asset", from);
    if (destAsset !== requirements.asset) return invalid("invalid_exact_fx_payload_wrong_asset", from);
    if (destAmount !== BigInt(requirements.amount)) return invalid("invalid_exact_fx_payload_wrong_amount", from);
    if (payTo !== requirements.payTo) return invalid("invalid_exact_fx_payload_wrong_recipient", from);
    const now = Math.floor(Date.now() / 1000);
    if (Number(deadline) <= now || Number(deadline) > now + requirements.maxTimeoutSeconds + DEADLINE_TOLERANCE_SECONDS) {
      return invalid("invalid_exact_fx_payload_bad_deadline", from);
    }

    const server = getRpcClient(requirements.network, rpcConfig);
    const latestLedger = await server.getLatestLedger();
    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(requirements.network);
    const maxLedger = latestLedger.sequence + Math.ceil(requirements.maxTimeoutSeconds / ledgerSeconds);

    // The payer must authorize exactly `pay(args)` and, inside it, the transfer of `maxSend` into FxPay.
    const auth = operation.auth ?? [];
    if (auth.length !== 1) return invalid("invalid_exact_fx_payload_unexpected_auth_entries", from);
    const credentials = getAddressCredentials(auth[0].credentials());
    if (!credentials) return invalid("invalid_exact_fx_payload_unsupported_credential_type", from);
    if (Address.fromScAddress(credentials.address()).toString() !== from) {
      return invalid("invalid_exact_fx_payload_auth_not_from_payer", from);
    }
    if (credentials.signatureExpirationLedger() > maxLedger + SIGNATURE_EXPIRATION_LEDGER_TOLERANCE) {
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
    const fee = Number(simulation.minResourceFee) + Number(BASE_FEE);
    if (fee > (this.options.maxTransactionFeeStroops ?? 1_000_000)) {
      return invalid("invalid_exact_fx_payload_fee_exceeds_maximum", from);
    }
    if (!this.deliversExactAmount(simulation, requirements, destAmount)) {
      return invalid("invalid_exact_fx_payload_no_delivery", from);
    }

    const signatures = gatherAuthEntrySignatureStatus({ transaction, simulationResponse: simulation });
    if (!signatures.alreadySigned.includes(from)) return invalid("invalid_exact_fx_payload_missing_payer_signature", from);
    if (signatures.pendingSignature.length > 0) {
      return invalid("invalid_exact_fx_payload_unexpected_pending_signatures", from);
    }

    return { response: { isValid: true, payer: from }, transaction, simulation };
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
