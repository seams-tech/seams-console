import type { ConsoleWalletEnvironmentKey as ConsoleEnvironmentKey } from '../environments/types';

const CONSOLE_ENVIRONMENT_KEYS: readonly ConsoleEnvironmentKey[] = Object.freeze([
  'dev',
  'staging',
  'prod',
]);

function isConsoleEnvironmentKey(value: unknown): value is ConsoleEnvironmentKey {
  return CONSOLE_ENVIRONMENT_KEYS.some((key) => key === value);
}

/**
 * The environment keys that one Wallet lane serves (Refactor 261). One Console can serve
 * several lanes from one account database: the network of an environment decides its lane,
 * so `dev` and `staging` run on the testnet lane and `prod` on the mainnet lane. A Console
 * with one lane serves every key.
 *
 * An environment id is `${projectId}:${key}` (`environments/d1.ts`), and a project id has no
 * colon, so the key is the text after the last colon.
 */
export class LaneEnvironmentKeys {
  private constructor(private readonly keys: readonly ConsoleEnvironmentKey[]) {}

  /** Every key: the only lane of a Console. */
  static all(): LaneEnvironmentKeys {
    return new LaneEnvironmentKeys(CONSOLE_ENVIRONMENT_KEYS);
  }

  static parse(value: unknown, label: string): LaneEnvironmentKeys {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${label} must be a non-empty list of environment keys`);
    }
    const keys: ConsoleEnvironmentKey[] = [];
    for (const entry of value) {
      if (!isConsoleEnvironmentKey(entry)) {
        throw new Error(`${label} must contain only dev, staging and prod`);
      }
      if (keys.includes(entry)) throw new Error(`${label} repeats ${entry}`);
      keys.push(entry);
    }
    return new LaneEnvironmentKeys(CONSOLE_ENVIRONMENT_KEYS.filter((key) => keys.includes(key)));
  }

  get list(): readonly ConsoleEnvironmentKey[] {
    return this.keys;
  }

  get admitsAll(): boolean {
    return this.keys.length === CONSOLE_ENVIRONMENT_KEYS.length;
  }

  overlaps(other: LaneEnvironmentKeys): boolean {
    return this.keys.some((key) => other.keys.includes(key));
  }

  admitsKey(key: string): boolean {
    return this.keys.some((admitted) => admitted === key);
  }

  admitsEnvironmentId(environmentId: string): boolean {
    const separator = environmentId.lastIndexOf(':');
    if (separator <= 0) return false;
    return this.admitsKey(environmentId.slice(separator + 1));
  }

  /** The bound value of `environmentKeySqlFilter`. */
  toSqlParameter(): string {
    return JSON.stringify(this.keys);
  }
}

/**
 * A SQL condition that admits a row whose environment belongs to the lane. Bind
 * `keys.toSqlParameter()` to `parameter`.
 */
export function environmentKeySqlFilter(
  environmentIdColumn: string,
  projectIdColumn: string,
  parameter: string,
): string {
  return `substr(${environmentIdColumn}, length(${projectIdColumn}) + 2) IN (SELECT value FROM json_each(${parameter}))`;
}
