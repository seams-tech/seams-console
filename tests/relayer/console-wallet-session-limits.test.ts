import { expect, test } from '@playwright/test';
import {
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
  type D1DatabaseLike,
} from '@seams/host/cloud-host';
import {
  createCloudflareConsoleRouter,
  type ConsoleAuthClaims,
} from '@seams-internal/wallet-console-server/router/cloudflare-adaptor';
import { createInMemoryConsoleAuditService } from '../../packages/console-server-ts/src/audit';
import type { ConsoleAuditService } from '../../packages/console-server-ts/src/audit/service';
import { createD1ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/d1';
import type { ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/service';
import { callCf, makeConsoleAuthAdapter } from './helpers';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';

const namespace = 'wallet-session-limits';
const orgId = 'org-wallet-session-limits';
const projectId = 'wallet-session-limits-project';
const developmentId = `${projectId}:dev`;
const productionId = `${projectId}:prod`;
const archivedId = `${projectId}:staging`;
const context = { orgId, actorUserId: 'owner' };
const oneWeek = { maxTtlMs: 7 * 86_400_000, maxRemainingUses: 500 };

const OWNER: ConsoleAuthClaims = {
  userId: 'owner',
  orgId,
  platformSupport: false,
  membershipId: 'membership-owner',
  role: 'OWNER',
  authorizationVersion: 1,
  adminPermissions: [],
  projectAccess: { kind: 'all' },
};

function admin(permission: 'projects.manage' | 'billing.view'): ConsoleAuthClaims {
  return {
    userId: `admin-${permission}`,
    orgId,
    platformSupport: false,
    membershipId: `membership-admin-${permission}`,
    role: 'ADMIN',
    authorizationVersion: 1,
    adminPermissions: [permission],
    projectAccess: { kind: 'all' },
  };
}

const PROJECT_EDITOR: ConsoleAuthClaims = {
  userId: 'member-editor',
  orgId,
  platformSupport: false,
  membershipId: 'membership-editor',
  role: 'MEMBER',
  authorizationVersion: 1,
  adminPermissions: [],
  projectAccess: { kind: 'assigned', assignments: [{ projectId, accessLevel: 'editor' }] },
};

const fixtureDirectories: string[] = [];

function disposeFixtureDirectories(): void {
  for (const directory of fixtureDirectories) cleanupTemporaryD1Database(directory);
  fixtureDirectories.length = 0;
}

test.afterEach(disposeFixtureDirectories);

async function environmentFixture(): Promise<{
  readonly database: D1DatabaseLike;
  readonly environments: ConsoleWalletEnvironmentService;
}> {
  const temporary = createTemporaryD1Database();
  fixtureDirectories.push(temporary.tempDir);
  await applyD1MigrationFiles(temporary.database, listD1MigrationFiles('d1-console'));
  await temporary.database.exec(`
    INSERT INTO organizations (namespace, id, name, slug, created_by_user_id, status, created_at_ms, updated_at_ms)
      VALUES ('${namespace}', '${orgId}', 'Limits', 'limits', 'owner', 'ACTIVE', 1, 1);
    INSERT INTO projects (namespace, id, org_id, name, slug, status, created_at_ms, updated_at_ms)
      VALUES ('${namespace}', '${projectId}', '${orgId}', 'Limits', 'limits', 'ACTIVE', 1, 1);
    INSERT INTO environments (namespace, id, org_id, project_id, env_key, runtime_version, name, status, created_at_ms, updated_at_ms)
      VALUES
        ('${namespace}', '${developmentId}', '${orgId}', '${projectId}', 'dev', 'default', 'Development', 'ACTIVE', 1, 1),
        ('${namespace}', '${productionId}', '${orgId}', '${projectId}', 'prod', 'default', 'Production', 'DISABLED', 1, 1),
        ('${namespace}', '${archivedId}', '${orgId}', '${projectId}', 'staging', 'default', 'Staging', 'ARCHIVED', 1, 1);
  `);
  const environments = await createD1ConsoleWalletEnvironmentService({
    database: temporary.database,
    namespace,
    ensureSchema: false,
  });
  return { database: temporary.database, environments };
}

function putLimits(
  environments: ConsoleWalletEnvironmentService,
  claims: ConsoleAuthClaims,
  environmentId: string,
  body: unknown,
  audit?: ConsoleAuditService,
) {
  return callCf(
    createCloudflareConsoleRouter({
      auth: makeConsoleAuthAdapter(claims),
      walletEnvironments: environments,
      ...(audit ? { audit } : {}),
    }),
    {
      method: 'PUT',
      path: `/console/environments/${encodeURIComponent(environmentId)}/wallet-session-limits`,
      body,
    },
  );
}

async function storedLimits(
  environments: ConsoleWalletEnvironmentService,
  environmentId: string,
): Promise<unknown> {
  const listed = await environments.listEnvironments(context, { projectId });
  return listed.find((environment) => environment.id === environmentId)?.walletSessionLimits;
}

test('an owner sets, reads and clears the Wallet Session limits of one environment', async () => {
  const { environments } = await environmentFixture();

  const set = await putLimits(environments, OWNER, developmentId, { walletSessionLimits: oneWeek });
  expect(set.status, set.text).toBe(200);
  expect(set.json).toMatchObject({
    ok: true,
    environment: { id: developmentId, walletSessionLimits: oneWeek },
  });

  const listed = await callCf(
    createCloudflareConsoleRouter({
      auth: makeConsoleAuthAdapter(OWNER),
      walletEnvironments: environments,
    }),
    { method: 'GET', path: `/console/environments?projectId=${projectId}` },
  );
  expect(listed.status, listed.text).toBe(200);
  const byId = Object.fromEntries(
    (listed.json?.environments as { id: string; walletSessionLimits: unknown }[]).map(
      (environment) => [environment.id, environment.walletSessionLimits],
    ),
  );
  expect(byId[developmentId]).toEqual(oneWeek);
  expect(byId[productionId]).toBeNull();

  const ceiling = {
    maxTtlMs: MAX_WALLET_SESSION_TTL_MS,
    maxRemainingUses: MAX_WALLET_SESSION_REMAINING_USES,
  };
  const disabled = await putLimits(environments, OWNER, productionId, {
    walletSessionLimits: ceiling,
  });
  expect(disabled.status, disabled.text).toBe(200);
  expect(await storedLimits(environments, productionId)).toEqual(ceiling);

  const cleared = await putLimits(environments, OWNER, developmentId, {
    walletSessionLimits: null,
  });
  expect(cleared.status, cleared.text).toBe(200);
  expect(cleared.json?.environment).toMatchObject({ id: developmentId, walletSessionLimits: null });
  expect(await storedLimits(environments, developmentId)).toBeNull();
  expect(await storedLimits(environments, productionId)).toEqual(ceiling);
});

test('each change of the limits writes an audit event with the new value', async () => {
  const { environments } = await environmentFixture();
  const audit = createInMemoryConsoleAuditService({ seedDemoData: false });

  const set = await putLimits(environments, OWNER, developmentId, { walletSessionLimits: oneWeek }, audit);
  expect(set.status, set.text).toBe(200);
  const cleared = await putLimits(
    environments,
    OWNER,
    developmentId,
    { walletSessionLimits: null },
    audit,
  );
  expect(cleared.status, cleared.text).toBe(200);
  // A refused change writes nothing.
  const refused = await putLimits(
    environments,
    OWNER,
    developmentId,
    { walletSessionLimits: { maxTtlMs: 0, maxRemainingUses: 1 } },
    audit,
  );
  expect(refused.status, refused.text).toBe(400);

  const events = await audit.listEvents({ orgId, actorUserId: 'owner' }, {});
  const changes = events
    .filter((event) => event.action === 'environment.wallet_session_limits.update')
    .map((event) => ({
      environmentId: event.environmentId,
      actorUserId: event.actorUserId,
      walletSessionLimits: (event.metadata as { walletSessionLimits: unknown }).walletSessionLimits,
    }));
  expect(changes).toHaveLength(2);
  expect(changes).toEqual(
    expect.arrayContaining([
      { environmentId: developmentId, actorUserId: 'owner', walletSessionLimits: oneWeek },
      { environmentId: developmentId, actorUserId: 'owner', walletSessionLimits: null },
    ]),
  );
});

test('only an owner or an admin with projects.manage sets the limits', async () => {
  const { environments } = await environmentFixture();

  const projectAdmin = await putLimits(environments, admin('projects.manage'), developmentId, {
    walletSessionLimits: oneWeek,
  });
  expect(projectAdmin.status, projectAdmin.text).toBe(200);

  for (const claims of [PROJECT_EDITOR, admin('billing.view')]) {
    const denied = await putLimits(environments, claims, developmentId, {
      walletSessionLimits: null,
    });
    expect(denied.status, `${claims.role} ${denied.text}`).toBe(403);
  }
  expect(await storedLimits(environments, developmentId)).toEqual(oneWeek);
});

test('a limit outside the platform ceiling or a body of another shape is refused', async () => {
  const { environments } = await environmentFixture();
  const bodies: unknown[] = [
    { walletSessionLimits: { maxTtlMs: MAX_WALLET_SESSION_TTL_MS + 1, maxRemainingUses: 1 } },
    {
      walletSessionLimits: { maxTtlMs: 1, maxRemainingUses: MAX_WALLET_SESSION_REMAINING_USES + 1 },
    },
    { walletSessionLimits: { maxTtlMs: 0, maxRemainingUses: 1 } },
    { walletSessionLimits: { maxTtlMs: 86_400_000, maxRemainingUses: 1.5 } },
    { walletSessionLimits: { maxTtlMs: '86400000', maxRemainingUses: 1 } },
    { walletSessionLimits: { maxTtlMs: 86_400_000 } },
    { walletSessionLimits: { ...oneWeek, revision: 1 } },
    { walletSessionLimits: oneWeek, name: 'Development' },
    oneWeek,
    {},
    'not json',
  ];
  for (const body of bodies) {
    const refused = await putLimits(environments, OWNER, developmentId, body);
    expect(refused.status, `${JSON.stringify(body)}: ${refused.text}`).toBe(400);
    expect(refused.json).toMatchObject({ ok: false, code: 'invalid_body' });
  }
  expect(await storedLimits(environments, developmentId)).toBeNull();
});

test('an unknown or archived environment keeps no limits', async () => {
  const { environments } = await environmentFixture();
  const missing = await putLimits(environments, OWNER, `${projectId}:missing`, {
    walletSessionLimits: oneWeek,
  });
  expect(missing.status, missing.text).toBe(404);
  expect(missing.json).toMatchObject({ code: 'environment_not_found' });

  const archived = await putLimits(environments, OWNER, archivedId, {
    walletSessionLimits: oneWeek,
  });
  expect(archived.status, archived.text).toBe(409);
  expect(archived.json).toMatchObject({ code: 'environment_archived' });
});

test('a stored value that does not parse is an error, not the defaults', async () => {
  const { database, environments } = await environmentFixture();
  await expect(
    database.exec(
      `UPDATE environments SET wallet_session_limits_json = 'not json' WHERE id = '${developmentId}'`,
    ),
  ).rejects.toThrow();

  await database.exec(
    `UPDATE environments SET wallet_session_limits_json = '{"maxTtlMs":0,"maxRemainingUses":5}'
      WHERE id = '${developmentId}'`,
  );
  await expect(environments.listEnvironments(context, { projectId })).rejects.toThrow(
    'maxTtlMs must be a positive integer',
  );
});
