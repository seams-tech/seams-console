import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import {
  readConsoleWalletLanes,
  CONSOLE_WALLET_LANES_VARIABLE,
} from '../../packages/wallet-console-server-ts/src/router/cloudflare/consoleWalletLanes';
import {
  environmentKeySqlFilter,
  LaneEnvironmentKeys,
} from '../../packages/wallet-console-server-ts/src/walletLanes/environmentKeys';
import {
  lanePublishableKeyAuth,
  laneSecretKeyAuth,
  laneWalletEnvironments,
} from '../../packages/wallet-console-server-ts/src/walletLanes/guards';
import type { ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/service';
import type { ConsoleWalletEnvironment } from '../../packages/wallet-console-server-ts/src/environments/types';

// Refactor 261: one Console serves the production mainnet and testnet lanes.

const mainnetRuntime = { fetch: async () => new Response('mainnet') };
const testnetRuntime = { fetch: async () => new Response('testnet') };

function productionConsoleEnvironment(): Record<string, unknown> {
  return {
    SEAMS_TENANT_STORAGE_NAMESPACE: 'seams-production',
    SEAMS_WALLET_SERVICE_DEPLOYMENT_ID: 'production-mainnet',
    SEAMS_TENANT_DEPLOYMENT_LANE: 'production-mainnet',
    [CONSOLE_WALLET_LANES_VARIABLE]: JSON.stringify([
      { deploymentLane: 'production-mainnet', network: 'mainnet', environmentKeys: ['prod'] },
      {
        deploymentLane: 'production-testnet',
        network: 'testnet',
        environmentKeys: ['dev', 'staging'],
      },
    ]),
    WALLET_RUNTIME: mainnetRuntime,
    TENANT_ROOT_RECOVERY_CERTIFICATES_JSON: '{"a":[]}',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: 'console-production-mainnet-grant-1',
    TESTNET_LANE_WALLET_RUNTIME: testnetRuntime,
    TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: 'console-production-testnet-grant-1',
    CONSOLE_SESSION_ISSUER: 'https://console.seams.sh/console',
  };
}

test('a Console without a lane list has one lane that serves every environment', () => {
  const env = { SEAMS_TENANT_DEPLOYMENT_LANE: 'staging-testnet', WALLET_RUNTIME: testnetRuntime };
  const lanes = readConsoleWalletLanes(env);
  expect(lanes.all).toHaveLength(1);
  expect(lanes.primary.network).toBeNull();
  expect(lanes.primary.deploymentLane).toBe('staging-testnet');
  expect(lanes.primary.env).toBe(env);
  expect(lanes.primary.environmentKeys.admitsAll).toBe(true);
});

test('a later lane sees its own values and never the first lane values', () => {
  const lanes = readConsoleWalletLanes(productionConsoleEnvironment());
  const mainnet = lanes.forNetwork('mainnet')!;
  const testnet = lanes.forNetwork('testnet')!;
  expect(lanes.primary).toBe(mainnet);
  expect(lanes.forDeploymentLane('production-testnet')).toBe(testnet);

  const mainnetEnv = mainnet.env as Record<string, unknown>;
  const testnetEnv = testnet.env as Record<string, unknown>;
  expect(mainnetEnv.WALLET_RUNTIME).toBe(mainnetRuntime);
  expect(testnetEnv.WALLET_RUNTIME).toBe(testnetRuntime);
  expect(testnetEnv.SEAMS_TENANT_DEPLOYMENT_LANE).toBe('production-testnet');
  expect(testnetEnv.TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID).toBe(
    'console-production-testnet-grant-1',
  );
  // Testnet has no recovery certificates: the mainnet value must not leak into its view.
  expect('TENANT_ROOT_RECOVERY_CERTIFICATES_JSON' in testnetEnv).toBe(false);
  // Account values are shared.
  expect(testnetEnv.SEAMS_TENANT_STORAGE_NAMESPACE).toBe('seams-production');
  expect(testnetEnv.CONSOLE_SESSION_ISSUER).toBe('https://console.seams.sh/console');

  expect(mainnet.environmentKeys.admitsEnvironmentId('proj_a:prod')).toBe(true);
  expect(mainnet.environmentKeys.admitsEnvironmentId('proj_a:dev')).toBe(false);
  expect(testnet.environmentKeys.admitsEnvironmentId('proj_a:staging')).toBe(true);
  expect(testnet.environmentKeys.admitsEnvironmentId('proj_a')).toBe(false);
});

test('one parse serves every request of a Worker environment', () => {
  const env = productionConsoleEnvironment();
  expect(readConsoleWalletLanes(env)).toBe(readConsoleWalletLanes(env));
});

test('a lane list that splits environments badly is refused', () => {
  const lanesOf =
    (lanes: unknown[], overrides: Record<string, unknown> = {}) =>
    () =>
      readConsoleWalletLanes({
        ...productionConsoleEnvironment(),
        [CONSOLE_WALLET_LANES_VARIABLE]: JSON.stringify(lanes),
        ...overrides,
      });
  const mainnet = {
    deploymentLane: 'production-mainnet',
    network: 'mainnet',
    environmentKeys: ['prod'],
  };
  expect(
    lanesOf([
      mainnet,
      {
        deploymentLane: 'production-testnet',
        network: 'testnet',
        environmentKeys: ['dev', 'prod'],
      },
    ]),
  ).toThrow(/shares an environment key/);
  expect(
    lanesOf([
      mainnet,
      { deploymentLane: 'production-testnet', network: 'mainnet', environmentKeys: ['dev'] },
    ]),
  ).toThrow(/repeats a network/);
  expect(lanesOf([mainnet], { SEAMS_TENANT_DEPLOYMENT_LANE: 'production-testnet' })).toThrow(
    /named by SEAMS_TENANT_DEPLOYMENT_LANE/,
  );
  expect(lanesOf([mainnet], { SEAMS_WALLET_SERVICE_DEPLOYMENT_ID: 'production-testnet' })).toThrow(
    /serves prod/,
  );
  expect(lanesOf([{ ...mainnet, environmentKeys: ['live'] }])).toThrow(/dev, staging and prod/);
});

function environment(id: string, key: ConsoleWalletEnvironment['key']): ConsoleWalletEnvironment {
  return { id, key, projectId: 'proj_a' } as ConsoleWalletEnvironment;
}

test('the Wallet routes of a lane see only the environments of its network', async () => {
  const all = [environment('proj_a:dev', 'dev'), environment('proj_a:prod', 'prod')];
  const service = {
    listEnvironments: async () => all,
    findOrganizationForEnvironment: async () => ({ id: 'org_a' }),
  } as unknown as ConsoleWalletEnvironmentService;
  const testnet = laneWalletEnvironments(service, LaneEnvironmentKeys.parse(['dev'], 'keys'));
  const context = { orgId: 'org_a', actorUserId: 'user_a' };
  expect((await testnet.listEnvironments(context)).map((entry) => entry.id)).toEqual([
    'proj_a:dev',
  ]);
  expect(await testnet.findOrganizationForEnvironment({ environmentId: 'proj_a:prod' })).toBeNull();
  expect(laneWalletEnvironments(service, LaneEnvironmentKeys.all())).toBe(service);
});

test('a key of another network is refused before and after authentication', async () => {
  const keys = LaneEnvironmentKeys.parse(['prod'], 'keys');
  const principal = {
    apiKeyId: 'key_a',
    orgId: 'org_a',
    environmentId: 'proj_a:dev',
    scopes: [],
  };
  const secret = laneSecretKeyAuth({ authenticate: async () => ({ ok: true, principal }) }, keys);
  const refusedAfter = await secret.authenticate({
    secret: 's',
    endpoint: '/',
    requiredScopes: [],
  });
  expect(refusedAfter).toMatchObject({
    ok: false,
    status: 403,
    code: 'secret_key_environment_mismatch',
  });

  let called = false;
  const publishable = lanePublishableKeyAuth(
    {
      authenticate: async () => {
        called = true;
        return { ok: true, principal };
      },
    },
    keys,
  );
  const refusedBefore = await publishable.authenticate({
    secret: 'p',
    origin: 'https://seams.sh',
    environmentId: 'proj_a:dev',
  });
  expect(refusedBefore).toMatchObject({ code: 'publishable_key_environment_mismatch' });
  expect(called).toBe(false);
});

test('the SQL filter admits only rows of the lane environments', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE rows (project_id TEXT, environment_id TEXT)');
  for (const key of ['dev', 'staging', 'prod']) {
    database.prepare('INSERT INTO rows VALUES (?, ?)').run('proj_a', `proj_a:${key}`);
  }
  const select = (keys: LaneEnvironmentKeys) =>
    database
      .prepare(
        `SELECT environment_id FROM rows WHERE ${environmentKeySqlFilter('environment_id', 'project_id', '?1')} ORDER BY environment_id`,
      )
      .all(keys.toSqlParameter())
      .map((row) => (row as { environment_id: string }).environment_id);
  expect(select(LaneEnvironmentKeys.parse(['dev', 'staging'], 'keys'))).toEqual([
    'proj_a:dev',
    'proj_a:staging',
  ]);
  expect(select(LaneEnvironmentKeys.parse(['prod'], 'keys'))).toEqual(['proj_a:prod']);
  expect(select(LaneEnvironmentKeys.all())).toHaveLength(3);
});
