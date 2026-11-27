import { LaneEnvironmentKeys } from '../../walletLanes/environmentKeys';

/**
 * The Wallet lanes that one Console Worker serves (Refactor 261).
 *
 * The account values (database, namespace, service deployment id, sessions, email, billing)
 * are one set for the Console. Each lane has its own Wallet bindings, home catalog,
 * deployment surfaces, grant key and recovery certificates. The first lane reads them from
 * the plain names, as a Console with one lane always did. Every later lane reads them from
 * the same names with the prefix `<NETWORK>_LANE_`, for example `TESTNET_LANE_WALLET_RUNTIME`.
 * A lane's view of the environment holds only its own values: a value that a later lane does
 * not set is absent, never the first lane's value.
 *
 * `SEAMS_CONSOLE_WALLET_LANES_JSON` lists the lanes. Without it, the Console has one lane that
 * serves every environment.
 */
export type ConsoleWalletNetwork = 'testnet' | 'mainnet';

export const CONSOLE_WALLET_LANES_VARIABLE = 'SEAMS_CONSOLE_WALLET_LANES_JSON';

const LANE_SCOPED_NAMES = Object.freeze([
  'SEAMS_TENANT_DEPLOYMENT_LANE',
  'WALLET_RUNTIME',
  'WALLET_RUNTIME_US',
  'WALLET_RUNTIME_WEUR',
  'WALLET_RUNTIME_APAC',
  'WALLET_RUNTIME_OC',
  'WALLET_GATEWAY_US',
  'WALLET_GATEWAY_WEUR',
  'WALLET_GATEWAY_APAC',
  'WALLET_GATEWAY_OC',
  'SEAMS_WALLET_HOME_CATALOG_JSON',
  'TENANT_DEPLOYMENT_SURFACES_JSON',
  'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID',
  'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
  'TENANT_ROOT_RECOVERY_CERTIFICATES_JSON',
  'TENANT_ROOT_RESTORE_DESTINATION_JSON',
  'TENANT_ROOT_RESTORE_ACCESS_JSON',
  'WALLET_BALANCE_NEAR_RPC_URL',
] as const);

export interface ConsoleWalletLane<Env extends object> {
  readonly deploymentLane: string;
  /** Null for the only lane of a Console without a lane list. */
  readonly network: ConsoleWalletNetwork | null;
  readonly environmentKeys: LaneEnvironmentKeys;
  /** The account values and this lane's values. */
  readonly env: Env;
}

export class ConsoleWalletLanes<Env extends object> {
  constructor(readonly all: readonly ConsoleWalletLane<Env>[]) {
    if (all.length === 0) throw new Error('A Console serves at least one Wallet lane');
  }

  /** The lane of a request that names none: a Gateway of this lane, the CLI, an old page. */
  get primary(): ConsoleWalletLane<Env> {
    return this.all[0]!;
  }

  forNetwork(network: string): ConsoleWalletLane<Env> | null {
    return this.all.find((lane) => lane.network === network) ?? null;
  }

  forDeploymentLane(deploymentLane: string): ConsoleWalletLane<Env> | null {
    return this.all.find((lane) => lane.deploymentLane === deploymentLane) ?? null;
  }
}

const parsedLanes = new WeakMap<object, ConsoleWalletLanes<object>>();

/** One parse per Worker environment object, so each lane keeps one view across requests. */
export function readConsoleWalletLanes<Env extends object>(env: Env): ConsoleWalletLanes<Env> {
  const cached = parsedLanes.get(env);
  if (cached) return cached as ConsoleWalletLanes<Env>;
  const lanes = parseConsoleWalletLanes(env);
  parsedLanes.set(env, lanes as ConsoleWalletLanes<object>);
  return lanes;
}

function parseConsoleWalletLanes<Env extends object>(env: Env): ConsoleWalletLanes<Env> {
  const values = env as Record<string, unknown>;
  const raw = values[CONSOLE_WALLET_LANES_VARIABLE];
  if (raw === undefined || raw === '') {
    return new ConsoleWalletLanes([
      {
        deploymentLane: String(values.SEAMS_TENANT_DEPLOYMENT_LANE ?? '').trim(),
        network: null,
        environmentKeys: LaneEnvironmentKeys.all(),
        env,
      },
    ]);
  }
  if (typeof raw !== 'string') throw new Error(`${CONSOLE_WALLET_LANES_VARIABLE} must be JSON`);
  const declared: unknown = JSON.parse(raw);
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`${CONSOLE_WALLET_LANES_VARIABLE} must list at least one lane`);
  }
  const lanes: ConsoleWalletLane<Env>[] = [];
  for (const [index, entry] of declared.entries()) {
    const label = `${CONSOLE_WALLET_LANES_VARIABLE}[${index}]`;
    const lane = parseDeclaredLane(entry, label);
    for (const other of lanes) {
      if (other.deploymentLane === lane.deploymentLane) throw new Error(`${label} repeats a lane`);
      if (other.network === lane.network) throw new Error(`${label} repeats a network`);
      if (other.environmentKeys.overlaps(lane.environmentKeys)) {
        throw new Error(`${label} shares an environment key with another lane`);
      }
    }
    if (index === 0 && values.SEAMS_TENANT_DEPLOYMENT_LANE !== lane.deploymentLane) {
      throw new Error(`${label} must be the lane named by SEAMS_TENANT_DEPLOYMENT_LANE`);
    }
    // The production usage statements (`billing/usage.ts`) match the lane of a `prod` row
    // against the project's service deployment id, so the two must be one value.
    if (
      lane.environmentKeys.admitsKey('prod') &&
      values.SEAMS_WALLET_SERVICE_DEPLOYMENT_ID !== lane.deploymentLane
    ) {
      throw new Error(`${label} serves prod, so it must be SEAMS_WALLET_SERVICE_DEPLOYMENT_ID`);
    }
    lanes.push({
      ...lane,
      env: index === 0 ? env : laneEnvironment(env, lane.network, lane.deploymentLane),
    });
  }
  return new ConsoleWalletLanes(lanes);
}

function parseDeclaredLane(
  value: unknown,
  label: string,
): Omit<ConsoleWalletLane<object>, 'env' | 'network'> & { readonly network: ConsoleWalletNetwork } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort().join(',');
  if (keys !== 'deploymentLane,environmentKeys,network') {
    throw new Error(`${label} must contain deploymentLane, network and environmentKeys`);
  }
  const deploymentLane = typeof entry.deploymentLane === 'string' ? entry.deploymentLane : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(deploymentLane)) {
    throw new Error(`${label}.deploymentLane is invalid`);
  }
  if (entry.network !== 'testnet' && entry.network !== 'mainnet') {
    throw new Error(`${label}.network must be testnet or mainnet`);
  }
  return {
    deploymentLane,
    network: entry.network,
    environmentKeys: LaneEnvironmentKeys.parse(entry.environmentKeys, `${label}.environmentKeys`),
  };
}

function laneEnvironment<Env extends object>(
  env: Env,
  network: ConsoleWalletNetwork,
  deploymentLane: string,
): Env {
  const source = env as Record<string, unknown>;
  const prefix = `${network.toUpperCase()}_LANE_`;
  const view: Record<string, unknown> = { ...source };
  for (const name of LANE_SCOPED_NAMES) {
    delete view[name];
    const value = source[`${prefix}${name}`];
    if (value !== undefined) view[name] = value;
  }
  view.SEAMS_TENANT_DEPLOYMENT_LANE = deploymentLane;
  return view as Env;
}
