import {
  Near,
  KeyPair,
  keyStores,
  connect,
  Account,
  Connection,
  DEFAULT_FUNCTION_CALL_GAS,
  Signer,
  utils,
} from "near-api-js";
import { FinalExecutionOutcome } from "near-api-js/lib/providers/provider";
import Big from "big.js";
import BN from "bn.js";
import * as crypto from "crypto";
import { startStream, types as nearLakeTypes } from "near-lake-framework";
import bs58 from "bs58";
import {
  Action,
  functionCall,
  SignedTransaction,
  Transaction,
} from "near-api-js/lib/transaction";
import * as nearAPI from "near-api-js";
import sha256 from "js-sha256";
import { PublicKey } from "near-api-js/lib/utils";
import { OracleJob } from "@switchboard-xyz/common";
import { KeyStore } from "near-api-js/lib/key_stores";
import path from "path";
import { homedir } from "os";
import base58 from "bs58";

export const DEFAULT_MAX_GAS = new BN("300000000000000");

import {
  TESTNET_PROGRAM_ID,
  MAINNET_PROGRAM_ID,
  LOCALNET_PROGRAM_ID,
  PROGRAM_ID,
} from "./generated/index.js";
import { types } from "./index.js";

export const DEFAULT_ESCROW_SEED: string = "DefaultEscrowSeed";

export const toBase58 = (address: Uint8Array): string => {
  return bs58.encode(address);
};
export const fromBase58 = (value: string): Uint8Array => {
  return bs58.decode(value);
};

export const isBase58 = (value: string): boolean =>
  /^[A-HJ-NP-Za-km-z1-9]*$/.test(value);

export const isTxnSuccessful = (txnReceipt: FinalExecutionOutcome): boolean => {
  return !Boolean(
    txnReceipt.status === "Failure" ||
      txnReceipt.transaction_outcome.outcome.status === "Failure" ||
      (typeof txnReceipt.transaction_outcome.outcome.status !== "string" &&
        "Failure" in txnReceipt.transaction_outcome.outcome.status)
  );
};

export const parseAddressString = (address: string): Uint8Array => {
  // check if base58
  if (isBase58(address)) {
    return base58.decode(address);
  }
  // check if array of bytes
  // TODO: Make brackets optional
  const bytesRegex = /^\[(\s)?[0-9]+((\s)?,(\s)?[0-9]+){31,}\]/;
  if (bytesRegex.test(address)) {
    return new Uint8Array(JSON.parse(address));
  }

  try {
    return new Uint8Array(JSON.parse(address));
  } catch {}

  throw new Error(`Failed to parse address string ${address}`);
};

export type NearNetwork = "testnet" | "mainnet" | "betanet" | "localnet";

export const getProgramId = (networkId: string): string => {
  switch (networkId) {
    case "testnet": {
      return TESTNET_PROGRAM_ID;
    }
    case "mainnet": {
      return MAINNET_PROGRAM_ID;
    }
    case "localnet": {
      return LOCALNET_PROGRAM_ID;
    }
    default: {
      throw new Error(
        `Failed to find Switchboard programID for networkId ${networkId}`
      );
    }
  }
};

export const getWrappedMint = (networkId: string): string => {
  switch (networkId) {
    case "testnet": {
      return "wrap.test";
    }
    case "mainnet": {
      return "wrap.test";
    }
    case "betanet": {
      return "wrap.beta";
    }
    case "localnet": {
      return "token.test.near";
    }
    default: {
      throw new Error(
        `Failed to get wrapped NEAR mint for networkId ${networkId}`
      );
    }
  }
};

export class SwitchboardProgramReadOnly extends Error {
  constructor(
    msg: string = "SwitchboardProgram was initialized in Read-Only mode with no Account defined"
  ) {
    super(msg);
    Object.setPrototypeOf(this, SwitchboardProgramReadOnly.prototype);
  }
}

export class SwitchboardProgram {
  readonly programId: string;
  readonly mint: string;
  private _account: Account;

  constructor(
    readonly keystore: KeyStore,
    _account: Account,
    programId?: string,
    mint?: string
  ) {
    this._account = _account;
    if (programId) {
      this.programId = programId;
    } else {
      this.programId = getProgramId(_account.connection.networkId);
    }
    if (mint) {
      this.mint = mint;
    } else {
      this.mint = getWrappedMint(_account.connection.networkId);
    }
  }

  get isReadOnly(): boolean {
    return (
      this._account === undefined || this._account.accountId === "READ_ONLY"
    );
  }

  get account(): Account {
    if (this.isReadOnly) {
      throw new SwitchboardProgramReadOnly();
    }

    return this._account;
  }

  set account(_account: Account) {
    this._account = _account;
  }

  get connection(): Connection {
    return this._account.connection;
  }

  /** Load the Switchboard Program in Read-Only mode */
  static async loadReadOnly(networkId: NearNetwork, rpcUrl: string) {
    const keystore = new keyStores.InMemoryKeyStore();

    const near = await loadNear(networkId, keystore, rpcUrl);
    const account = new Account(near.connection, "READ_ONLY");

    return new SwitchboardProgram(keystore, account);
  }

  /** Load the Switchboard Program from a filesystem keypair */
  static async loadFromFs(
    networkId: NearNetwork,
    rpcUrl: string,
    accountId: string,
    credentialsDir = path.join(homedir(), ".near-credentials")
  ): Promise<SwitchboardProgram> {
    const keystore = new keyStores.UnencryptedFileSystemKeyStore(
      credentialsDir
    );

    const near = await loadNear(networkId, keystore, rpcUrl);
    const account = await near.account(accountId);

    return new SwitchboardProgram(keystore, account);
  }

  /** Load the Switchboard Program from a KeyPair */
  static async loadFromKeypair(
    networkId: NearNetwork,
    rpcUrl: string,
    accountId: string,
    keyPair: KeyPair
  ): Promise<SwitchboardProgram> {
    const keystore = new keyStores.InMemoryKeyStore();
    await keystore.setKey(networkId, accountId, keyPair);

    const near = await loadNear(networkId, keystore, rpcUrl);
    const account = await near.account(accountId);

    return new SwitchboardProgram(keystore, account);
  }

  /** Load the Switchboard Program from browser storage */
  static async loadFromBrowser(
    networkId: NearNetwork,
    rpcUrl: string,
    accountId: string,
    browserLocalStorage?: any,
    browserPrefix?: string
  ): Promise<SwitchboardProgram> {
    const keystore = new keyStores.BrowserLocalStorageKeyStore(
      browserLocalStorage,
      browserPrefix
    );

    const near = await loadNear(networkId, keystore, rpcUrl);
    const account = await near.account(accountId);

    return new SwitchboardProgram(keystore, account);
  }

  async sendAction(action: Action): Promise<FinalExecutionOutcome> {
    if (this.isReadOnly) {
      throw new SwitchboardProgramReadOnly();
    }

    const txnReceipt = await this.account.functionCall({
      contractId: this.programId,
      methodName: action.functionCall.methodName,
      args: action.functionCall.args,
    });
    return txnReceipt;
  }

  async sendActions(actions: Action[]): Promise<FinalExecutionOutcome> {
    if (this.isReadOnly) {
      throw new SwitchboardProgramReadOnly();
    }

    const keyPair = await this.keystore.getKey(
      this.connection.networkId,
      this.account.accountId
    );

    const txn = new SwitchboardTransaction(
      this.programId,
      this.account,
      actions
    );
    const txnReceipt = await txn.send(keyPair);
    return txnReceipt;
  }
}

export interface AccountParams {
  program: SwitchboardProgram;
  address: Uint8Array;
}

export class AggregatorAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  /**
   * AggregatorAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      authority: string;
      queue: Uint8Array;
      name: Buffer;
      metadata: Buffer;
      batchSize: number;
      minOracleResults: number;
      minJobResults: number;
      minUpdateDelaySeconds: number;
      startAfter: number;
      varianceThreshold: SwitchboardDecimal;
      forceReportPeriod: number;
      rewardEscrow: Uint8Array;
      historyLimit: number;
      crank?: Uint8Array;
      maxGasCost?: number;
    }
  ): Promise<AggregatorAccount> {
    const [action, aggregator] = AggregatorAccount.createAction(
      program,
      params
    );
    const txnReceipt = await program.sendAction(action);
    return aggregator;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      authority: string;
      queue: Uint8Array;
      name: Buffer;
      metadata: Buffer;
      batchSize: number;
      minOracleResults: number;
      minJobResults: number;
      minUpdateDelaySeconds: number;
      startAfter: number;
      varianceThreshold: SwitchboardDecimal;
      forceReportPeriod: number;
      rewardEscrow: Uint8Array;
      historyLimit: number;
      crank?: Uint8Array;
      maxGasCost?: number;
    }
  ): [Action, AggregatorAccount] {
    const address = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "aggregator_init",
      {
        ix: {
          address: [...address],
          authority: params.authority,
          queue: [...params.queue],
          name: [...params.name],
          metadata: [...params.metadata],
          batch_size: params.batchSize,
          min_oracle_results: params.minOracleResults,
          min_job_results: params.minJobResults,
          min_update_delay_seconds: params.minUpdateDelaySeconds,
          start_after: params.startAfter,
          variance_threshold: { mantissa: 0, scale: 0 },
          force_report_period: params.forceReportPeriod,
          crank: [...(params.crank ?? new Uint8Array(32))],
          expiration: 0,
          reward_escrow: [...params.rewardEscrow],
          history_limit: params.historyLimit,
          max_gas_cost: params.maxGasCost ?? 0,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const aggregator = new AggregatorAccount({ program, address });
    return [action, aggregator];
  }

  static async loadAuthorityKeys(
    program: SwitchboardProgram,
    authority: string
  ): Promise<Array<Uint8Array>> {
    const data = await roClient(program.connection).viewFunction({
      contractId: program.programId,
      methodName: "view_aggregators_with_authority",
      args: {
        ix: { authority: authority },
      },
    });
    return (data as number[][]).map((bytes) => new Uint8Array(bytes));
  }

  static async loadFromAuthority(
    program: SwitchboardProgram,
    authority: string
  ): Promise<Array<AggregatorAccount>> {
    const addresses = await AggregatorAccount.loadAuthorityKeys(
      program,
      authority
    );
    return addresses.map(
      (address) => new AggregatorAccount({ program, address })
    );
  }

  async loadData(): Promise<types.AggregatorView> {
    const data: types.AggregatorViewBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_aggregator",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.AggregatorView.fromBorsh(data);
  }

  async setConfigs(params: {
    authority?: string;
    queue?: Uint8Array;
    name?: Buffer;
    metadata?: Buffer;
    batchSize?: number;
    minOracleResults?: number;
    minJobResults?: number;
    minUpdateDelaySeconds?: number;
    startAfter?: number;
    varianceThreshold?: SwitchboardDecimal;
    forceReportPeriod?: number;
    crank?: Uint8Array;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(
      this.setConfigsAction(params)
    );
    return txnReceipt;
  }

  setConfigsAction(params: {
    authority?: string;
    queue?: Uint8Array;
    name?: Buffer;
    metadata?: Buffer;
    batchSize?: number;
    minOracleResults?: number;
    minJobResults?: number;
    minUpdateDelaySeconds?: number;
    startAfter?: number;
    varianceThreshold?: SwitchboardDecimal;
    forceReportPeriod?: number;
    crank?: Uint8Array;
  }): Action {
    return functionCall(
      "aggregator_set_configs",
      {
        ix: {
          address: [...this.address],
          authority: params.authority,
          queue: params.queue ? [...params.queue] : null,
          name: params.name ? [...params.name] : null,
          metadata: params.metadata ? [...params.metadata] : null,
          batch_size: params.batchSize,
          min_oracle_results: params.minOracleResults,
          min_job_results: params.minJobResults,
          min_update_delay_seconds: params.minUpdateDelaySeconds,
          start_after: params.startAfter,
          variance_threshold: params.varianceThreshold?.toNearDecimal(),
          force_report_period: params.forceReportPeriod,
          crank: params.crank ? [...params.crank] : null,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }

  async openRound(params: {
    rewardRecipient: Uint8Array;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(
      this.openRoundAction(params)
    );
    return txnReceipt;
  }

  openRoundAction(params: { rewardRecipient: Uint8Array }): Action {
    return functionCall(
      "aggregator_open_round",
      {
        ix: {
          aggregator: [...this.address],
          jitter: 0,
          reward_recipient: [...params.rewardRecipient],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }

  async saveResult(params: {
    oracleIdx: number;
    error: boolean;
    value: SwitchboardDecimal;
    jobsChecksum: Uint8Array;
    minRespose: SwitchboardDecimal;
    maxResponse: SwitchboardDecimal;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(
      this.saveResultAction(params)
    );
    return txnReceipt;
  }

  saveResultAction(params: {
    oracleIdx: number;
    error: boolean;
    value: SwitchboardDecimal;
    jobsChecksum: Uint8Array;
    minRespose: SwitchboardDecimal;
    maxResponse: SwitchboardDecimal;
  }): Action {
    return functionCall(
      "aggregator_save_result",
      {
        ix: {
          aggregator_key: [...this.address],
          oracle_idx: params.oracleIdx,
          error: params.error,
          value: params.value.toNearDecimal(),
          jobs_checksum: [...params.jobsChecksum],
          min_response: params.minRespose.toNearDecimal(),
          max_response: params.maxResponse.toNearDecimal(),
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }

  async fund(params: {
    funder: Uint8Array;
    amount: number;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.fundAction(params));
    return txnReceipt;
  }

  fundAction(params: { funder: Uint8Array; amount: number }): Action {
    return functionCall(
      "aggregator_fund",
      {
        ix: {
          address: [...this.address],
          funder: [...params.funder],
          amount: params.amount,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0) // This might need to be updated
    );
  }

  async addJob(params: {
    job: Uint8Array;
    weight?: number;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.addJobAction(params));
    return txnReceipt;
  }

  addJobAction(params: { job: Uint8Array; weight?: number }): Action {
    return functionCall(
      "aggregator_add_job",
      {
        ix: new types.AggregatorAddJob({
          address: this.address,
          job: params.job,
          weight: params.weight ?? 1,
        }).toJSON(),
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }

  async removeJob(params: { idx: number }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(
      this.removeJobAction(params)
    );
    return txnReceipt;
  }

  removeJobAction(params: { idx: number }): Action {
    return functionCall(
      "aggregator_remove_job",
      {
        ix: {
          address: [...this.address],
          idx: params.idx,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }
}

export class QueueAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  /**
   * QueueAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public async createAggregatorFromJSON(params: {
    // queueAddress?: string;
    crankAddress?: string;
    authority?: string;
    name?: string;
    metadata?: string;
    // defaults to 1
    batchSize?: number;
    // defaults to 1
    minOracleResults: number;
    minJobResults?: number;
    minUpdateDelaySeconds: number;
    startAfter?: number;
    varianceThreshold?: Big;
    forceReportPeriod?: number;
    expiration?: number;
    disableCrank?: boolean;
    historySize?: number;
    rewardEscrow?: Uint8Array;
    maxGasCost?: number;
    // amount to pre-fund the lease with
    fundUpTo?: number;
    // if queue requires it, whether to enable permissions
    enable?: boolean;
    jobs: (
      | {
          authority?: string;
          name?: string;
          metadata?: string;
          expiration?: number;
          tasks: Record<string, any>[]; // required
        }
      | string
    )[];
  }): Promise<{
    aggregator: AggregatorAccount;
    permission: PermissionAccount;
    jobs: JobAccount[];
    actions: [string, Action][];
    // batches: Action[][];
  }> {
    const actions: [string, Action][] = [];

    const queue = await this.loadData();

    // check if user escrow already exists, if not add createEscrow action
    let createEscrowAction: Action | undefined;
    const seedBytes = Buffer.alloc(32);
    seedBytes.write(this.program.account.accountId);
    seedBytes.write(DEFAULT_ESCROW_SEED);
    const seed = new Uint8Array(seedBytes.subarray(0, 32));
    const escrowKey = EscrowAccount.keyFromSeed(seed);
    const escrowAccount = new EscrowAccount({
      program: this.program,
      address: escrowKey,
    });
    try {
      const escrowData = await escrowAccount.loadData();
    } catch {
      [createEscrowAction] = EscrowAccount.createAction(this.program, {
        authority: params.authority ?? this.program.account.accountId,
        mint: getWrappedMint(this.program.connection.networkId),
      });
      actions.push(["escrow_init", createEscrowAction]);
    }

    const jobs: JobAccount[] = [];

    if (!params.jobs || params.jobs.length === 0) {
      throw new Error(
        `Need to provide at least one job in order to create an aggregator`
      );
    }

    // create createJob and addJob actions
    for (const jobDefinition of params.jobs) {
      if (typeof jobDefinition === "string") {
        const jobAccount = new JobAccount({
          program: this.program,
          address: isBase58(jobDefinition)
            ? base58.decode(jobDefinition)
            : new Uint8Array(JSON.parse(jobDefinition)),
        });
        const jobData = await jobAccount.loadData(); // make sure it exist
        jobs.push(jobAccount);
        continue;
      }
      const oracleJob = OracleJob.fromObject(jobDefinition);
      if (oracleJob.tasks.length === 0) {
        throw new Error(
          `Job definition has 0 tasks defined: ${JSON.stringify(
            jobDefinition
          )} => ${JSON.stringify(oracleJob.toJSON())}`
        );
      }

      const [createJobAction, jobAccount] = JobAccount.createAction(
        this.program,
        {
          authority:
            jobDefinition.authority ??
            params.authority ??
            this.program.account.accountId,
          data: Buffer.from(OracleJob.encodeDelimited(oracleJob).finish()),
        }
      );
      actions.push(["job_init", createJobAction]);
      jobs.push(jobAccount);
    }

    // create the feed
    const [createFeedAction, aggregator] = AggregatorAccount.createAction(
      this.program,
      {
        queue: this.address,
        crank: params.crankAddress
          ? parseAddressString(params.crankAddress)
          : undefined,
        authority: params.authority ?? this.program.account.accountId,
        name: Buffer.from(params.name ?? ""),
        metadata: Buffer.from(params.metadata ?? ""),
        batchSize: params.batchSize ?? 1,
        minOracleResults: params.minOracleResults ?? 1,
        minJobResults: params.minJobResults ?? 1,
        minUpdateDelaySeconds: params.minUpdateDelaySeconds ?? 30,
        startAfter: 0,
        rewardEscrow: params.rewardEscrow ?? escrowKey,
        historyLimit: 1000,
        varianceThreshold: params.varianceThreshold
          ? SwitchboardDecimal.fromBig(params.varianceThreshold)
          : SwitchboardDecimal.fromBig(new Big(0)),
        forceReportPeriod: params.forceReportPeriod ?? 0,
      }
    );
    actions.push(["aggregator_init", createFeedAction]);

    // create permissions
    const [createPermissionAction, permission] = PermissionAccount.createAction(
      this.program,
      {
        authority: params.authority ?? this.program.account.accountId,
        granter: this.address,
        grantee: aggregator.address,
      }
    );
    actions.push(["permission_init", createPermissionAction]);

    // set permissions if required
    let setPermissionAction: Action | undefined;
    if (!queue.unpermissionedFeedsEnabled && params.enable) {
      setPermissionAction = permission.setAction({
        permission: SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
        enable: true,
      });
      actions.push(["permission_set", setPermissionAction]);
    }

    let escrowFundAction: Action | undefined;
    if (params.fundUpTo) {
      const fundAmount = new BN(
        utils.format.parseNearAmount(params.fundUpTo.toString())
      );
      const escrowState = await escrowAccount.loadData();
      const availableAmount = new BN(escrowState.amount).sub(
        new BN(escrowState.amountLocked)
      );
      if (fundAmount.gt(availableAmount)) {
        throw new Error(
          `Provided escrow does not have enough funds, need ${fundAmount}, have ${availableAmount}`
        );
      }
      escrowFundAction = aggregator.fundAction({
        funder: escrowAccount.address, // should this be a wNEAR token account?
        amount: params.fundUpTo,
      });
      actions.push(["aggregator_fund", setPermissionAction]);
    }

    // add to crank
    let crankPushAction: Action | undefined;
    if (params.crankAddress) {
      const crankAccount = new CrankAccount({
        program: this.program,
        address: parseAddressString(params.crankAddress),
      });
      crankPushAction = crankAccount.pushAction({
        aggregator: aggregator.address,
      });
      actions.push(["crank_push", crankPushAction]);
    }

    jobs.forEach((job) =>
      actions.push([
        "aggregator_add_job",
        aggregator.addJobAction({ job: job.address }),
      ])
    );

    return {
      aggregator,
      permission,
      jobs,
      actions,
    };
  }

  async loadAggregatorKeys(): Promise<Array<Uint8Array>> {
    const data = await roClient(this.program.connection).viewFunction({
      contractId: this.program.programId,
      methodName: "view_aggregators_on_queue",
      args: {
        ix: { queue: [...this.address] },
      },
    });
    return (data as number[][]).map((bytes) => new Uint8Array(bytes));
  }

  async loadAggregators(): Promise<Array<AggregatorAccount>> {
    const addresses = await this.loadAggregatorKeys();
    return addresses.map(
      (address) => new AggregatorAccount({ program: this.program, address })
    );
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      authority: string;
      mint: string;
      reward: number;
      minStake: number;
      queueSize: number;
      oracleTimeout: number;
      name?: Buffer;
      metadata?: Buffer;
      varianceToleranceMultiplier?: SwitchboardDecimal;
      feedProbationPeriod?: number;
      slashingEnabled?: boolean;
      consecutiveFeedFailureLimit?: number;
      consecutiveOracleFailureLimit?: number;
      unpermissionedFeeds?: boolean;
      unpermissionedVrf?: boolean;
      enableBufferRelayers?: boolean;
      maxGasCost?: number;
    }
  ): Promise<QueueAccount> {
    const [action, queue] = QueueAccount.createAction(program, params);
    const txnReceipt = await program.sendAction(action);
    return queue;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      authority: string;
      mint: string;
      reward: number;
      minStake: number;
      queueSize: number;
      oracleTimeout: number;
      name?: Buffer;
      metadata?: Buffer;
      varianceToleranceMultiplier?: SwitchboardDecimal;
      feedProbationPeriod?: number;
      slashingEnabled?: boolean;
      consecutiveFeedFailureLimit?: number;
      consecutiveOracleFailureLimit?: number;
      unpermissionedFeeds?: boolean;
      unpermissionedVrf?: boolean;
      enableBufferRelayers?: boolean;
      maxGasCost?: number;
    }
  ): [Action, QueueAccount] {
    const address = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "oracle_queue_init",
      {
        ix: {
          address: [...address],
          authority: params.authority,
          mint: params.mint,
          reward: params.reward,
          min_stake: params.minStake,
          queue_size: params.queueSize,
          oracle_timeout: params.oracleTimeout,
          name: [...(params.name ?? [])],
          metadata: [...(params.metadata ?? [])],
          variance_tolerance_multiplier: { mantissa: 0, scale: 0 },
          feed_probation_period: params.feedProbationPeriod ?? 0,
          slashing_enabled: params.slashingEnabled ?? false,
          consecutive_feed_failure_limit:
            params.consecutiveFeedFailureLimit ?? 0,
          consecutive_oracle_failure_limit:
            params.consecutiveOracleFailureLimit ?? 0,
          unpermissioned_feeds: params.unpermissionedFeeds ?? false,
          unpermissioned_vrf: params.unpermissionedVrf ?? false,
          enable_buffer_relayers: params.enableBufferRelayers ?? false,
          max_gas_cost: params.maxGasCost ?? 0,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const queue = new QueueAccount({ program, address });
    return [action, queue];
  }

  async loadData(): Promise<types.OracleQueueView> {
    const data: types.OracleQueueViewBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_queue",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.OracleQueueView.fromBorsh(data);
  }
}

export class CrankAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  /**
   * CrankAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      queue: Uint8Array;
      maxRows: number;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): Promise<CrankAccount> {
    const [action, crank] = CrankAccount.createAction(program, params);
    const txnReceipt = await program.sendAction(action);
    return crank;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      queue: Uint8Array;
      maxRows: number;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): [Action, CrankAccount] {
    const address = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "crank_init",
      {
        ix: {
          address: [...address],
          name: [...(params.name ?? [])],
          metadata: [...(params.metadata ?? [])],
          queue: [...params.queue],
          max_rows: params.maxRows,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const crank = new CrankAccount({ program, address });
    return [action, crank];
  }

  async loadData(): Promise<types.CrankView> {
    const data: types.CrankViewBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_crank",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.CrankView.fromBorsh(data);
  }

  async push(params: {
    aggregator: Uint8Array;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.pushAction(params));
    return txnReceipt;
  }

  pushAction(params: { aggregator: Uint8Array }): Action {
    return functionCall(
      "crank_push",
      {
        ix: {
          crank: [...this.address],
          aggregator: [...params.aggregator],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }

  async pop(params: {
    rewardRecipient: Uint8Array;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.popAction(params));
    return txnReceipt;
  }

  popAction(params: { rewardRecipient: Uint8Array }): Action {
    return functionCall(
      "crank_pop",
      {
        ix: {
          crank: [...this.address],
          reward_recipient: [...params.rewardRecipient],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }
}

export class JobAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  /**
   * JobAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      data: Buffer;
      authority?: string;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): Promise<JobAccount> {
    const [action, job] = JobAccount.createAction(program, params);
    const txnReceipt = await program.sendAction(action);
    return job;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      data: Buffer;
      authority?: string;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): [Action, JobAccount] {
    const address = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "job_init",
      {
        ix: {
          address: [...address],
          authority: params.authority ?? program.account.accountId,
          name: [...(params.name ?? [])],
          metadata: [...(params.metadata ?? [])],
          data: [...params.data],
          expiration: 0,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const job = new JobAccount({ program, address });
    return [action, job];
  }

  async loadData(): Promise<types.Job> {
    const data: types.JobBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_job",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.Job.fromBorsh(data);
  }

  public static async loadJobs(
    program: SwitchboardProgram,
    addrs: Array<Uint8Array>
  ): Promise<Array<OracleJob>> {
    const addresses = [];
    for (const addr of addrs) {
      addresses.push([...addr]);
    }
    const parsed = [];
    const results = await roClient(program.connection).viewFunction({
      contractId: program.programId,
      methodName: "view_jobs",
      args: {
        ix: { addresses },
      },
    });
    for (const res of results) {
      parsed.push(OracleJob.decodeDelimited(res.data));
    }
    return parsed;
  }

  static produceJobsHash(jobs: Array<OracleJob>): crypto.Hash {
    const hash = crypto.createHash("sha256");
    for (const job of jobs) {
      const jobHasher = crypto.createHash("sha256");
      jobHasher.update(OracleJob.encodeDelimited(job).finish());
      hash.update(jobHasher.digest());
    }
    return hash;
  }
}

export class OracleAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  /**
   * OracleAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      authority: string;
      queue: Uint8Array;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): Promise<OracleAccount> {
    const [action, oracle] = OracleAccount.createAction(program, params);
    const txnReceipt = await program.sendAction(action);
    return oracle;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      authority: string;
      queue: Uint8Array;
      name?: Buffer;
      metadata?: Buffer;
    }
  ): [Action, OracleAccount] {
    const address = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "oracle_init",
      {
        ix: {
          address: [...address],
          authority: params.authority,
          queue: [...params.queue],
          name: [...(params.name ?? [])],
          metadata: [...(params.metadata ?? [])],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const oracle = new OracleAccount({ program, address });
    return [action, oracle];
  }

  async loadData(): Promise<types.Oracle> {
    const data: types.OracleBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_oracle",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.Oracle.fromBorsh(data);
  }

  async heartbeat(): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.heartbeatAction());
    return txnReceipt;
  }

  heartbeatAction(): Action {
    return functionCall(
      "oracle_heartbeat",
      {
        ix: {
          address: [...this.address],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }
}

export class EscrowAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  public static keyFromSeed(seed: Uint8Array): Uint8Array {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from("Escrow"));
    hash.update(seed);
    return new Uint8Array(hash.digest());
  }

  /**
   * EscrowAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      authority: string;
      mint: string;
    }
  ): Promise<EscrowAccount> {
    const [action, escrow] = EscrowAccount.createAction(program, params);
    const txnReceipt = await program.sendAction(action);
    return escrow;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      authority: string;
      mint: string;
    }
  ): [Action, EscrowAccount] {
    const seed = KeyPair.fromRandom("ed25519").getPublicKey().data;
    const action = functionCall(
      "escrow_init",
      {
        ix: {
          seed: [...seed],
          authority: params.authority,
          mint: params.mint,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const escrow = new EscrowAccount({
      program,
      address: this.keyFromSeed(seed),
    });
    return [action, escrow];
  }

  static async getOrCreateStaticAccount(
    program: SwitchboardProgram,
    seedString = DEFAULT_ESCROW_SEED
  ): Promise<EscrowAccount> {
    const seedBytes = Buffer.alloc(32);
    seedBytes.write(program.account.accountId);
    seedBytes.write(seedString);
    const seed = new Uint8Array(seedBytes.subarray(0, 32));

    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from("Escrow"));
    hash.update(seed);
    const escrowKey = new Uint8Array(hash.digest());

    let escrowAccount: EscrowAccount;
    try {
      escrowAccount = new EscrowAccount({
        program,
        address: escrowKey,
      });
      await escrowAccount.loadData();
      return escrowAccount;
    } catch (error) {
      await program.account.functionCall({
        contractId: program.programId,
        methodName: "escrow_init",
        args: {
          ix: {
            seed: [...seed],
            authority: program.account.accountId,
            mint: "wrap.test",
          },
        },
      });
      escrowAccount = new EscrowAccount({
        program,
        address: escrowKey,
      });
      return escrowAccount;
    }
  }

  async loadData(): Promise<types.Escrow> {
    const data: types.EscrowBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_escrow",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.Escrow.fromBorsh(data);
  }

  async fund(): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.fundAction());
    return txnReceipt;
  }

  fundAction(): Action {
    return functionCall(
      "escrow_fund",
      {
        ix: {
          address: [...this.address],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0) // This might need to be updated
    );
  }

  async withdraw(params: { amount: number }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(
      this.withdrawAction(params)
    );
    return txnReceipt;
  }

  withdrawAction(params: { amount: number }): Action {
    return functionCall(
      "escrow_withdraw",
      {
        ix: {
          address: [...this.address],
          amount: params.amount,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0) // This might need to be updated
    );
  }
}

export class PermissionAccount {
  program: SwitchboardProgram;
  address: Uint8Array;

  public static keyFromSeed(
    authority: string,
    granter: Uint8Array,
    grantee: Uint8Array
  ): Uint8Array {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from("Permission"));
    hash.update(Buffer.from(authority));
    hash.update(Buffer.from(granter));
    hash.update(Buffer.from(grantee));
    return new Uint8Array(hash.digest());
  }

  /**
   * PermissionAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    this.program = params.program;
    this.address = params.address;
  }

  public static async create(
    program: SwitchboardProgram,
    params: {
      authority: string;
      granter: Uint8Array;
      grantee: Uint8Array;
    }
  ): Promise<PermissionAccount> {
    const [action, permission] = PermissionAccount.createAction(
      program,
      params
    );
    const txnReceipt = await program.sendAction(action);
    return permission;
  }

  public static createAction(
    program: SwitchboardProgram,
    params: {
      authority: string;
      granter: Uint8Array;
      grantee: Uint8Array;
    }
  ): [Action, PermissionAccount] {
    const action = functionCall(
      "permission_init",
      {
        ix: {
          authority: params.authority,
          granter: [...params.granter],
          grantee: [...params.grantee],
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
    const permission = new PermissionAccount({
      program,
      address: this.keyFromSeed(
        params.authority,
        params.granter,
        params.grantee
      ),
    });
    return [action, permission];
  }

  async loadData(): Promise<types.Permission> {
    const data: types.PermissionBorsh = await roClient(
      this.program.connection
    ).viewFunction({
      contractId: this.program.programId,
      methodName: "view_permission",
      args: {
        ix: { address: [...this.address] },
      },
    });
    return types.Permission.fromBorsh(data);
  }

  async set(params: {
    permission: SwitchboardPermission;
    enable: boolean;
  }): Promise<FinalExecutionOutcome> {
    const txnReceipt = await this.program.sendAction(this.setAction(params));
    return txnReceipt;
  }

  setAction(params: {
    permission: SwitchboardPermission;
    enable: boolean;
  }): Action {
    return functionCall(
      "permission_set",
      {
        ix: {
          address: [...this.address],
          permission: params.permission,
          enable: params.enable,
        },
      },
      DEFAULT_FUNCTION_CALL_GAS,
      new BN(0)
    );
  }
}

export enum SwitchboardPermission {
  NONE = 0 << 0,
  PERMIT_ORACLE_HEARTBEAT = 1 << 0,
  PERMIT_ORACLE_QUEUE_USAGE = 1 << 1,
  PERMIT_VRF_REQUESTS = 1 << 2,
}

/**
 * Switchboard precisioned representation of numbers.
 */
export class SwitchboardDecimal {
  public constructor(
    public readonly mantissa: BN,
    public readonly scale: number
  ) {}

  /**
   * Convert untyped object to a Switchboard decimal, if possible.
   * @param obj raw object to convert from
   * @return SwitchboardDecimal
   */
  public static from(obj: any): SwitchboardDecimal {
    return new SwitchboardDecimal(new BN(obj.mantissa), obj.scale);
  }

  /**
   * Convert a Big.js decimal to a Switchboard decimal.
   * @param big a Big.js decimal
   * @return a SwitchboardDecimal
   */
  public static fromBig(big: Big): SwitchboardDecimal {
    // Round to fit in Switchboard Decimal
    // TODO: smarter logic.
    big = big.round(20);
    let mantissa: BN = new BN(big.c.join(""), 10);
    // Set the scale. Big.exponenet sets scale from the opposite side
    // SwitchboardDecimal does.
    let scale = big.c.slice(1).length - big.e;

    if (scale < 0) {
      mantissa = mantissa.mul(new BN(10, 10).pow(new BN(Math.abs(scale), 10)));
      scale = 0;
    }
    if (scale < 0) {
      throw new Error(`SwitchboardDecimal: Unexpected negative scale.`);
    }
    if (scale >= 28) {
      throw new Error("SwitchboardDecimalExcessiveScaleError");
    }

    // Set sign for the coefficient (mantissa)
    mantissa = mantissa.mul(new BN(big.s, 10));

    const result = new SwitchboardDecimal(mantissa, scale);
    if (big.sub(result.toBig()).abs().gt(new Big(0.00005))) {
      throw new Error(
        `SwitchboardDecimal: Converted decimal does not match original:\n` +
          `out: ${result.toBig().toNumber()} vs in: ${big.toNumber()}\n` +
          `-- result mantissa and scale: ${result.mantissa.toString()} ${result.scale.toString()}\n` +
          `${result} ${result.toBig()}`
      );
    }
    return result;
  }

  /**
   * SwitchboardDecimal equality comparator.
   * @param other object to compare to.
   * @return true iff equal
   */
  public eq(other: SwitchboardDecimal): boolean {
    return this.mantissa.eq(other.mantissa) && this.scale === other.scale;
  }

  /**
   * Convert SwitchboardDecimal to big.js Big type.
   * @return Big representation
   */
  public toBig(): Big {
    let mantissa: BN = new BN(this.mantissa, 10);
    let s = 1;
    const c: Array<number> = [];
    const ZERO = new BN(0, 10);
    const TEN = new BN(10, 10);
    if (mantissa.lt(ZERO)) {
      s = -1;
      mantissa = mantissa.abs();
    }
    while (mantissa.gt(ZERO)) {
      c.unshift(mantissa.mod(TEN).toNumber());
      mantissa = mantissa.div(TEN);
    }
    const e = c.length - this.scale - 1;
    const result = new Big(0);
    if (c.length === 0) {
      return result;
    }
    result.s = s;
    result.c = c;
    result.e = e;
    return result;
  }

  toString() {
    return this.toBig().toString();
  }

  toNearDecimal(): any {
    return { mantissa: this.mantissa.toString(), scale: this.scale };
  }
}

export function roClient(connection: Connection): Account {
  return new Account(connection, "");
}

export async function loadNear(
  network: string,
  keystore: keyStores.KeyStore,
  url: string
): Promise<Near> {
  const connectionConfig = {
    networkId: network, //"testnet",
    keyStore: keystore, // first create a key store
    nodeUrl: url, //"https://rpc.testnet.near.org",
    headers: {},
  };
  const near = await connect(connectionConfig);
  return near;
}

async function loadNearConf(
  network: "testnet" | "mainnet"
): Promise<nearLakeTypes.LakeConfig> {
  const nearCon = await connect({
    headers: {},
    networkId: network,
    nodeUrl: `https://rpc.${network}.near.org`,
  });
  const startingBlock = (await nearCon.connection.provider.status()).sync_info
    .latest_block_height;
  const lakeConfig: nearLakeTypes.LakeConfig = {
    s3BucketName: `near-lake-data-${network}`,
    s3RegionName: "eu-central-1",
    startBlockHeight: startingBlock,
  };
  return lakeConfig;
}

export type NearEventCallback = (...args: any[]) => Promise<void>;

export class NearEvent {
  constructor(
    readonly lakeConfig: nearLakeTypes.LakeConfig,
    readonly pid: string,
    readonly eventType: string
  ) {}

  static async fromNetwork(
    network: "testnet" | "mainnet",
    pid: string,
    eventType: string
  ): Promise<NearEvent> {
    const lakeConfig = await loadNearConf(network);

    return new NearEvent(lakeConfig, pid, eventType);
  }

  async start(
    streamCallback: NearEventCallback,
    errorHandler?: (error: unknown) => Promise<void> | void
  ): Promise<void> {
    const processShard = async (
      streamerMessage: nearLakeTypes.StreamerMessage
    ): Promise<void> => {
      try {
        streamerMessage.shards
          .flatMap((shard) => shard.receiptExecutionOutcomes)
          .map(async (outcome) => {
            if (outcome.executionOutcome.outcome.executorId !== this.pid) {
              return;
            }

            outcome.executionOutcome.outcome.logs.map((log: string) => {
              const matches = log.matchAll(
                /(?<=EVENT_JSON:)(?<event>{.+?})(?=,EVENT_JSON|$)/g
              );
              for (const m of matches) {
                const eventJson = m.groups["event"];
                const event = JSON.parse(eventJson);
                if (event.event_type !== this.eventType) {
                  return;
                }

                streamCallback(event.event).catch(errorHandler);
              }
            });
          });
      } catch (error) {
        if (errorHandler) {
          errorHandler(error);
        }
      }
    };
    await startStream(this.lakeConfig, processShard);
  }
}

export class SwitchboardTransaction {
  public signer: Signer;

  constructor(
    readonly programId: string,
    readonly account: Account,
    readonly actions: Action[] = [],
    signer?: Signer
  ) {
    this.signer = signer || account.connection.signer;
  }

  add(action: Action | Action[]) {
    const actions = this.actions;

    if (Array.isArray(action)) {
      actions.push(...action);
    } else {
      actions.push(action);
    }

    return;
  }

  async getAccessKey(accessKeyKeypair: KeyPair): Promise<{
    publicKey: PublicKey;
    accessKey: any;
    nonce: number;
    recentBlockhash: Buffer;
  }> {
    const publicKey = accessKeyKeypair.getPublicKey();

    // gets sender's public key information from NEAR blockchain
    const accessKey = await this.account.connection.provider.query(
      `access_key/${this.account.accountId}/${publicKey.toString()}`,
      ""
    );

    const nonce = Number.parseInt((accessKey as any).nonce) + 1;
    // converts a recent block hash into an array of bytes
    // this hash was retrieved earlier when creating the accessKey (Line 26)
    // this is required to prove the tx was recently constructed (within 24hrs)
    const recentBlockhash = nearAPI.utils.serialize.base_decode(
      accessKey.block_hash
    );

    return {
      publicKey,
      accessKey,
      nonce,
      recentBlockhash,
    };
  }

  async send(accessKeyKeypair: KeyPair): Promise<FinalExecutionOutcome> {
    if (this.actions.length === 0) {
      throw new Error(`No actions to send`);
    }
    // const key = this.account.findAccessKey()

    const { publicKey, nonce, recentBlockhash } = await this.getAccessKey(
      accessKeyKeypair
    );

    // create transaction
    const transaction = nearAPI.transactions.createTransaction(
      this.account.accountId,
      publicKey,
      this.programId,
      nonce,
      this.actions,
      recentBlockhash
    );

    const signedTransaction = this.sign(transaction, accessKeyKeypair);

    const txnReceipt = await this.account.connection.provider.sendTransaction(
      signedTransaction
    );
    return txnReceipt;
  }

  sign(transaction: Transaction, keyPair: KeyPair): SignedTransaction {
    // before we can sign the transaction we must perform three steps...
    // 1) serialize the transaction in Borsh
    const serializedTx = nearAPI.utils.serialize.serialize(
      nearAPI.transactions.SCHEMA,
      transaction
    );
    // 2) hash the serialized transaction using sha256
    const serializedTxHash = new Uint8Array(sha256.sha256.array(serializedTx));
    // 3) create a signature using the hashed transaction
    const signature = keyPair.sign(serializedTxHash);

    // now we can sign the transaction :)
    const signedTransaction = new nearAPI.transactions.SignedTransaction({
      transaction,
      signature: new nearAPI.transactions.Signature({
        keyType: transaction.publicKey.keyType,
        data: signature.signature,
      }),
    });

    return signedTransaction;
  }
}
