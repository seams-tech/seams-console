import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWalletConsoleOpsClient,
  isD1DatabaseLike,
  type WalletConsoleServiceBinding,
} from '@seams/host/cloud-host';
import { consoleWorkerEnvironment } from '../helpers/consoleWorkerEnvironment';
import { activateWalletProject } from '../helpers/accountWalletProject.fixtures';
import { createD1ConsoleApiKeyService } from '../../packages/wallet-console-server-ts/src/apiKeys/d1';
import { createD1ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments';
import { createCloudflareD1AccountServiceBundle } from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';

/*
 * Refactor 261: one Console serves the production mainnet and testnet lanes. The testnet
 * Gateways bind the Console's `TestnetWalletLane` entrypoint and the mainnet Gateways its
 * default entrypoint. Each lane sees only the environments of its network, so a key of a
 * `prod` environment is refused on the testnet lane, and a `dev` key on the mainnet lane.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const namespace = 'console-wallet-lanes-e2e';
const context = { orgId: 'org_console_lanes', actorUserId: 'fixture-owner' };
const projectId = 'console_lanes';
const origin = 'https://wallet.example.test';
const accountId = '0123456789abcdef0123456789abcdef';

class ConsumerService implements WalletConsoleServiceBinding {
  constructor(private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body: request.body === null ? undefined : await request.arrayBuffer(),
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Array.from(response.headers.entries()),
    });
  }
}

function homeCatalog(databases: readonly string[]): string {
  return JSON.stringify(
    ['US', 'WEUR', 'APAC', 'OC'].map((region, index) => ({
      region,
      accountId,
      databaseId: databases[index],
    })),
  );
}

function unexpectedWalletCall(): Response {
  return new Response('A Wallet lane binding was called', { status: 599 });
}

function walletBindings(prefix: string): Record<string, () => Response> {
  const bindings: Record<string, () => Response> = {};
  for (const name of [
    'WALLET_RUNTIME',
    'WALLET_RUNTIME_US',
    'WALLET_RUNTIME_WEUR',
    'WALLET_RUNTIME_APAC',
    'WALLET_RUNTIME_OC',
    'WALLET_GATEWAY_US',
    'WALLET_GATEWAY_WEUR',
    'WALLET_GATEWAY_APAC',
    'WALLET_GATEWAY_OC',
  ]) {
    bindings[`${prefix}${name}`] = unexpectedWalletCall;
  }
  return bindings;
}

test('each lane of a shared Console serves only the environments of its network', async () => {
  test.setTimeout(120_000);
  const output = test.info().outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      console: path.join(
        repoRoot,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts',
      ),
      consumer: path.join(repoRoot, 'tests/fixtures/tenant-deployment/consoleOpsConsumer.ts'),
    },
    outdir: output,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const consoleEnvironment = {
    ...consoleWorkerEnvironment({
      namespace,
      deploymentLane: 'production-mainnet',
      walletServiceDeploymentId: 'production-mainnet',
      accountId,
      databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    SEAMS_CONSOLE_WALLET_LANES_JSON: JSON.stringify([
      { deploymentLane: 'production-mainnet', network: 'mainnet', environmentKeys: ['prod'] },
      {
        deploymentLane: 'production-testnet',
        network: 'testnet',
        environmentKeys: ['dev', 'staging'],
      },
    ]),
    TESTNET_LANE_SEAMS_WALLET_HOME_CATALOG_JSON: homeCatalog([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]),
    TESTNET_LANE_TENANT_DEPLOYMENT_SURFACES_JSON: JSON.stringify({
      applicationOrigin: origin,
      hostedWalletOrigin: 'https://test.sign.example.test',
      gatewayOrigin: 'https://test.gateway.example.test',
      relyingPartyId: 'test.sign.example.test',
    }),
    TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: 'local-testnet-grant',
    TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: randomBytes(32).toString('base64url'),
  };
  const runtime = new Miniflare({
    workers: [
      {
        name: 'mainnet-gateway',
        modules: true,
        modulesRoot: output,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { WALLET_CONSOLE: 'console' },
      },
      {
        name: 'testnet-gateway',
        modules: true,
        modulesRoot: output,
        scriptPath: path.join(output, 'consumer.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        serviceBindings: { WALLET_CONSOLE: { name: 'console', entrypoint: 'TestnetWalletLane' } },
      },
      {
        name: 'console',
        modules: true,
        modulesRoot: output,
        scriptPath: path.join(output, 'console.js'),
        compatibilityDate: '2026-04-17',
        compatibilityFlags: ['nodejs_compat'],
        bindings: consoleEnvironment,
        d1Databases: { CONSOLE_DB: 'console-wallet-lanes-e2e' },
        serviceBindings: { ...walletBindings(''), ...walletBindings('TESTNET_LANE_') },
      },
    ],
  });
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    if (!isD1DatabaseLike(database)) throw new Error('Local Console D1 binding is unavailable');
    const migrationDirectory = path.join(
      repoRoot,
      'packages/wallet-console-server-ts/migrations/d1-console',
    );
    for (const name of (await readdir(migrationDirectory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const sql = await readFile(path.join(migrationDirectory, name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
    }
    const core = await createCloudflareD1AccountServiceBundle({
      database,
      namespace,
      externalDeletionGuard: null,
    });
    await core.orgProjects.upsertOrganization(context, { name: 'Console lanes' });
    await core.orgProjects.createProject(context, { id: projectId, name: 'Console lanes' });
    await core.organizationAccess.bootstrapInitialOwner({
      orgId: context.orgId,
      userId: context.actorUserId,
      email: `${context.actorUserId}@example.test`,
      displayName: 'Lanes owner',
    });
    const walletEnvironments = await createD1ConsoleWalletEnvironmentService({
      database,
      namespace,
    });
    await activateWalletProject({
      core,
      walletEnvironments,
      namespace,
      deploymentId: 'production-mainnet',
      context,
      projectId,
    });
    for (const environment of await walletEnvironments.listEnvironments(context, { projectId })) {
      if (environment.status !== 'ACTIVE') {
        await walletEnvironments.updateEnvironment(context, environment.id, { status: 'ACTIVE' });
      }
    }
    const keys = await createD1ConsoleApiKeyService({
      deploymentId: 'production-mainnet',
      database,
      namespace,
      ensureSchema: false,
      scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
    });
    const publishableKey = async (environmentId: string) =>
      (
        await keys.createApiKey(context, {
          kind: 'publishable_key',
          name: `Key for ${environmentId}`,
          environmentId,
          allowedOrigins: [origin],
          rateLimitBucket: 'default',
          quotaBucket: 'default',
        })
      ).secret;
    const devKey = await publishableKey(`${projectId}:dev`);
    const prodKey = await publishableKey(`${projectId}:prod`);

    const testnet = createWalletConsoleOpsClient(
      new ConsumerService(await runtime.getWorker('testnet-gateway')),
    );
    const mainnet = createWalletConsoleOpsClient(
      new ConsumerService(await runtime.getWorker('mainnet-gateway')),
    );
    const authenticate = (client: typeof testnet, secret: string, environmentId: string) =>
      client.publishableKeyAuth.authenticate({ secret, origin, environmentId });

    await expect(authenticate(testnet, devKey, `${projectId}:dev`)).resolves.toMatchObject({
      ok: true,
      principal: { environmentId: `${projectId}:dev` },
    });
    await expect(authenticate(testnet, prodKey, `${projectId}:prod`)).resolves.toMatchObject({
      ok: false,
      code: 'publishable_key_environment_mismatch',
    });
    await expect(authenticate(mainnet, prodKey, `${projectId}:prod`)).resolves.toMatchObject({
      ok: true,
      principal: { environmentId: `${projectId}:prod` },
    });
    await expect(authenticate(mainnet, devKey, `${projectId}:dev`)).resolves.toMatchObject({
      ok: false,
      code: 'publishable_key_environment_mismatch',
    });

    const environmentKeys = async (client: typeof testnet) =>
      (
        await client.projectEnvironments.listEnvironments({
          orgId: context.orgId,
          actorUserId: context.actorUserId,
          roles: ['OWNER'],
        })
      )
        .map((environment) => environment.key)
        .sort();
    expect(await environmentKeys(testnet)).toEqual(['dev', 'staging']);
    expect(await environmentKeys(mainnet)).toEqual(['prod']);
  } finally {
    await runtime.dispose();
  }
});
