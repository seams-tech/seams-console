import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Capability = {
  readonly enabled: boolean;
  readonly owner: string;
  readonly secrets: readonly string[];
};

type BackendResources = {
  readonly gateway: {
    readonly workerName: string;
    readonly consoleD1Name: string;
  };
  readonly router: Readonly<Record<string, unknown>>;
  readonly deriverA: Readonly<Record<string, unknown>>;
  readonly deriverB: Readonly<Record<string, unknown>>;
  readonly signingWorker: Readonly<Record<string, unknown>>;
  readonly tenantRootControlPlane: Readonly<Record<string, unknown>>;
};

type GatewayDeploymentConfig = {
  readonly resources: {
    readonly consoleD1: { readonly id: string };
    readonly regions: Readonly<
      Record<
        'US' | 'WEUR' | 'APAC',
        {
          readonly signerD1:
            | { readonly kind: 'allocated'; readonly id: string }
            | { readonly kind: 'pending'; readonly id?: never };
        }
      >
    >;
  };
  readonly tenant: { readonly namespace: string };
  readonly origins: {
    readonly gateway: string;
    readonly allowedCors: readonly string[];
  };
  readonly session: { readonly issuer: string };
};

type BackendLane = {
  readonly id: 'staging-testnet' | 'production-testnet' | 'production-mainnet';
  readonly release: 'staging' | 'production';
  readonly network: 'testnet' | 'mainnet';
  readonly branch: string;
  readonly site: {
    readonly origin: string;
    readonly defaultNetwork: string;
    readonly availableNetworks: readonly string[];
  };
  readonly gatewayOrigin: string;
  readonly walletOrigin: string;
  readonly emailOtpDelivery:
    | { readonly kind: 'demo_code_response' }
    | {
        readonly kind: 'email_provider' | 'provider_and_demo_code';
        readonly provider:
          | { readonly kind: 'resend'; readonly fromAddress: string }
          | {
              readonly kind: 'amazon_ses';
              readonly region: string;
              readonly fromAddress: string;
            };
      };
  readonly resources: BackendResources;
  readonly capabilities: Readonly<Record<string, Capability>>;
  readonly provisioning:
    | {
        readonly kind: 'provisioned';
        readonly gatewayDeploymentConfig: GatewayDeploymentConfig;
      }
    | {
        readonly kind: 'pending';
        readonly runtimeProfileKind: string;
        readonly requiredValues: readonly string[];
      };
};

type FrontendSite = {
  readonly id: 'staging' | 'production';
  readonly branch: string;
  readonly origin: string;
  readonly walletSiteOrigin: string;
  readonly docsOrigin: string;
  readonly defaultNetwork: string;
  readonly availableNetworks: readonly string[];
  readonly pagesProjectEnv: string;
  readonly walletSitePagesProjectEnv: string;
  readonly docsPagesProjectEnv: string;
  readonly lanes: readonly BackendLane[];
};

type DeploymentTopology = {
  readonly backendLanes: Readonly<Record<BackendLane['id'], BackendLane>>;
  readonly frontendSites: Readonly<Record<FrontendSite['id'], FrontendSite>>;
};

type DeploymentTargetsModule = {
  readonly parseDeploymentTargets: (value: unknown) => DeploymentTopology;
  readonly readBackendLane: (laneId: string, targetsPath?: string) => BackendLane;
  readonly readFrontendSite: (siteId: string, targetsPath?: string) => FrontendSite;
  readonly componentSecretNames: (lane: BackendLane, component: string) => readonly string[];
  readonly retiredGatewaySecretNames: (lane: BackendLane) => readonly string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deploymentTargetsModule = import(
  pathToFileURL(path.join(repoRoot, 'scripts/deployment-targets.mjs')).href
) as Promise<DeploymentTargetsModule>;

function validTargets(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, 'deployment/wallet-system/targets.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function stagingLane(targets: Record<string, unknown>): Record<string, unknown> {
  const staging = targets.staging as Record<string, unknown>;
  const lanes = staging.lanes as Record<string, unknown>;
  return lanes.testnet as Record<string, unknown>;
}

function withStaging(targets: Record<string, unknown>, lane: Record<string, unknown>) {
  const staging = targets.staging as Record<string, unknown>;
  return {
    ...targets,
    staging: {
      ...staging,
      lanes: { ...(staging.lanes as Record<string, unknown>), testnet: lane },
    },
  };
}

function withProduction(targets: Record<string, unknown>, lanes: Record<string, unknown>) {
  const production = targets.production as Record<string, unknown>;
  return {
    ...targets,
    production: {
      ...production,
      lanes: { ...(production.lanes as Record<string, unknown>), ...lanes },
    },
  };
}

test('deployment topology preserves staging operational identities', async () => {
  const module = await deploymentTargetsModule;
  const lane = module.readBackendLane('staging-testnet');
  if (lane.provisioning.kind !== 'provisioned') throw new Error('staging must be provisioned');

  expect(lane.provisioning.gatewayDeploymentConfig.resources.consoleD1.id).toBe(
    'fbd3cfdc-125b-423d-b3c9-07aa2ff43688',
  );
  expect(lane.provisioning.gatewayDeploymentConfig.resources.regions.APAC.signerD1.id).toBe(
    '38b8e122-8ac1-4ee2-9a2f-095018545787',
  );
  expect(lane.provisioning.gatewayDeploymentConfig.tenant.namespace).toBe('seams-staging');
  expect(lane.provisioning.gatewayDeploymentConfig.session.issuer).toBe('seams-gateway-staging');
});

test('deployment target parsing rejects malformed capability records', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const lane = stagingLane(targets);
  const capabilities = { ...(lane.capabilities as Record<string, unknown>) };
  capabilities.sponsoredExecution = { enabled: 'false', owner: 'gateway', secrets: [] };
  expect(() =>
    module.parseDeploymentTargets(withStaging(targets, { ...lane, capabilities })),
  ).toThrow(/enabled/u);
});

test('deployment target parsing rejects unknown capability owners', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const lane = stagingLane(targets);
  const capabilities = { ...(lane.capabilities as Record<string, unknown>) };
  capabilities.sponsoredExecution = { enabled: true, owner: 'backend', secrets: [] };
  expect(() =>
    module.parseDeploymentTargets(withStaging(targets, { ...lane, capabilities })),
  ).toThrow(/owner/u);
});

test('deployment target parsing rejects duplicate capability secrets', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const lane = stagingLane(targets);
  const capabilities = { ...(lane.capabilities as Record<string, unknown>) };
  capabilities.sponsoredExecution = {
    enabled: true,
    owner: 'gateway',
    secrets: ['SHARED_SECRET'],
  };
  capabilities.signingSessionSeal = {
    enabled: true,
    owner: 'gateway',
    secrets: ['SHARED_SECRET'],
  };
  expect(() =>
    module.parseDeploymentTargets(withStaging(targets, { ...lane, capabilities })),
  ).toThrow(/duplicate|ownership/u);
});

test('deployment target parsing rejects Gateway configuration drift', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const lane = stagingLane(targets);
  const provisioning = lane.provisioning as Record<string, unknown>;
  const gatewayDeploymentConfig = provisioning.gatewayDeploymentConfig as GatewayDeploymentConfig;
  const config = {
    ...gatewayDeploymentConfig,
    origins: {
      ...gatewayDeploymentConfig.origins,
      gateway: 'https://wrong-gateway.example',
    },
  };
  expect(() =>
    module.parseDeploymentTargets(
      withStaging(targets, {
        ...lane,
        provisioning: { ...provisioning, gatewayDeploymentConfig: config },
      }),
    ),
  ).toThrow(/origins|gatewayDeploymentConfig|lane/u);
});

test('deployment target parsing rejects a production branch drift', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const production = targets.production as Record<string, unknown>;
  expect(() =>
    module.parseDeploymentTargets({
      ...targets,
      production: { ...production, branch: 'dev' },
    }),
  ).toThrow(/branch must be main/u);
});

test('deployment target parsing rejects cross-lane origin reuse', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const lane = targets.production as Record<string, unknown>;
  const lanes = lane.lanes as Record<string, unknown>;
  const testnet = lanes.testnet as Record<string, unknown>;
  expect(() =>
    module.parseDeploymentTargets(
      withProduction(targets, {
        testnet: { ...testnet, gatewayOrigin: 'https://staging.api.seams.sh' },
      }),
    ),
  ).toThrow(/origin/u);
});

test('lane and site readers reject retired or unknown identities', async () => {
  const module = await deploymentTargetsModule;
  expect(() => module.readBackendLane('production')).toThrow(/backend lane/u);
  expect(() => module.readFrontendSite('production-testnet')).toThrow(/frontend site/u);
});

test('required secrets are derived from enabled capabilities', async () => {
  const module = await deploymentTargetsModule;
  const targets = module.parseDeploymentTargets(validTargets());
  const staging = targets.backendLanes['staging-testnet'];
  expect(module.componentSecretNames(staging, 'gateway')).toEqual([
    'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
    'ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET',
    'ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET',
    'LINKED_DEVICE_TARGET_DESCRIPTOR_HMAC_SECRET',
    'ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK',
    'SIGNING_SESSION_SEAL_ROOT_SECRET_B64U',
    'SAYSO_API_KEY',
    'SPEAK_TO_SIGN_NEAR_AI_API_KEY',
  ]);
  expect(module.componentSecretNames(staging, 'console')).toContain(
    'CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U',
  );
  expect(module.componentSecretNames(staging, 'console')).toContain(
    'CONSOLE_WEBHOOK_SECRET_KEY_B64U',
  );
  expect(module.componentSecretNames(staging, 'console')).not.toContain(
    'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
  );
  expect(module.componentSecretNames(staging, 'deriver-a')).toEqual([
    'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
    'DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY',
    'DERIVER_A_ROLE_PRIVATE_D1_KEK',
    'DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY',
    'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY',
    'DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY',
  ]);

  const mainnet = targets.backendLanes['production-mainnet'];
  expect(mainnet.emailOtpDelivery).toMatchObject({ provider: { kind: 'resend' } });
  expect(module.componentSecretNames(mainnet, 'gateway')).toContain('RESEND_API_KEY');
  expect(module.componentSecretNames(mainnet, 'gateway')).not.toContain(
    'EMAIL_OTP_SES_ACCESS_KEY_ID',
  );
  expect(module.componentSecretNames(mainnet, 'deriver-a')).toContain(
    'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_GOOGLE_CREDENTIALS_JSON',
  );
  expect(module.componentSecretNames(mainnet, 'deriver-a')).not.toContain(
    'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY',
  );
  expect(module.componentSecretNames(mainnet, 'deriver-b')).toContain(
    'DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_GOOGLE_CREDENTIALS_JSON',
  );
  expect(module.componentSecretNames(mainnet, 'deriver-b')).not.toContain(
    'DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY',
  );

  const productionTestnet = targets.backendLanes['production-testnet'];
  expect(productionTestnet.emailOtpDelivery.kind).toBe('provider_and_demo_code');
  expect(module.componentSecretNames(productionTestnet, 'gateway')).toContain('RESEND_API_KEY');
});

function withStagingVerifier(verifier: unknown): Record<string, unknown> {
  const targets = validTargets();
  const lane = structuredClone(stagingLane(targets)) as {
    provisioning: { gatewayDeploymentConfig: { optional: Record<string, unknown> } };
  };
  lane.provisioning.gatewayDeploymentConfig.optional.speakToSignVerifier = verifier;
  return withStaging(targets, lane);
}

test('the Speak-to-Sign verifier names one backend and its secret', async () => {
  const module = await deploymentTargetsModule;
  const outlayer = module.parseDeploymentTargets(
    withStagingVerifier({
      backend: 'outlayer',
      outlayerBaseUrl: 'https://testnet-api.outlayer.ai',
      project: 'seams-v1.testnet/voice-verifier',
      versionKey: '21af4130b8209ff593dd5b2e6131ffb85a0c68dec81b8bcbf857688519cd27d9',
      secretsProfile: 'main',
      secretsAccountId: 'cyan-loong.testnet',
    }),
  ).backendLanes['staging-testnet'];
  const names = module.componentSecretNames(outlayer, 'gateway');
  expect(names).toContain('SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY');
  expect(names).not.toContain('SAYSO_API_KEY');
  // A deploy deletes the secret of the backend that a lane left: Workers keep secrets.
  expect(module.retiredGatewaySecretNames(outlayer)).toEqual(['SAYSO_API_KEY']);
  expect(module.retiredGatewaySecretNames(module.readBackendLane('staging-testnet'))).toEqual([
    'SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY',
  ]);
  expect(module.retiredGatewaySecretNames(module.readBackendLane('production-mainnet'))).toEqual([
    'SAYSO_API_KEY',
    'SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY',
  ]);
  expect(() =>
    module.parseDeploymentTargets(withStagingVerifier({ backend: 'venice' })),
  ).toThrow(/backend must be sayso or outlayer/u);
  expect(() =>
    module.parseDeploymentTargets(
      withStagingVerifier({ backend: 'sayso', saysoWorkerName: 'Sayso Verifier' }),
    ),
  ).toThrow(/saysoWorkerName/u);
  expect(() =>
    module.parseDeploymentTargets(
      withStagingVerifier({
        backend: 'sayso',
        saysoWorkerName: 'sayso-verifier-staging-testnet',
        project: 'seams-v1.testnet/voice-verifier',
      }),
    ),
  ).toThrow(/project/u);
});

test('the staging workflow supplies every required Gateway secret', async () => {
  const module = await deploymentTargetsModule;
  const workflow = readFileSync(
    path.join(repoRoot, '.github/workflows/deploy-staging-backend.yml'),
    'utf8',
  );
  for (const name of module.componentSecretNames(
    module.readBackendLane('staging-testnet'),
    'gateway',
  )) {
    expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
  }
});

test('email provider delivery validates provider-specific configuration', async () => {
  const module = await deploymentTargetsModule;
  const targets = validTargets();
  const production = targets.production as Record<string, unknown>;
  const lanes = production.lanes as Record<string, unknown>;
  const mainnet = lanes.mainnet as Record<string, unknown>;

  expect(() =>
    module.parseDeploymentTargets(
      withProduction(targets, {
        mainnet: {
          ...mainnet,
          emailOtpDelivery: {
            kind: 'email_provider',
            provider: {
              kind: 'resend',
              fromAddress: 'confirm.seams.sh',
            },
          },
        },
      }),
    ),
  ).toThrow(/emailOtpDelivery\.provider\.fromAddress/u);

  const sesTargets = module.parseDeploymentTargets(
    withProduction(targets, {
      mainnet: {
        ...mainnet,
        emailOtpDelivery: {
          kind: 'email_provider',
          provider: {
            kind: 'amazon_ses',
            region: 'ap-southeast-2',
            fromAddress: 'confirm@seams.sh',
          },
        },
      },
    }),
  );
  expect(
    module.componentSecretNames(sesTargets.backendLanes['production-mainnet'], 'gateway'),
  ).toEqual(
    expect.arrayContaining(['EMAIL_OTP_SES_ACCESS_KEY_ID', 'EMAIL_OTP_SES_SECRET_ACCESS_KEY']),
  );
});

test('production workflows supply every required Gateway secret as a protected secret', async () => {
  const module = await deploymentTargetsModule;
  for (const [laneId, workflowName] of [
    ['production-testnet', 'deploy-production-testnet-backend.yml'],
    ['production-mainnet', 'deploy-production-mainnet-backend.yml'],
  ] as const) {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows', workflowName), 'utf8');
    // The names follow the lane, so they include the selected email provider's credentials.
    const secretNames = module.componentSecretNames(module.readBackendLane(laneId), 'gateway');
    expect(secretNames).toContain('RESEND_API_KEY');
    for (const name of secretNames) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(workflow).not.toContain('CONSOLE_SESSION_HMAC_SECRET:');
  }
  const consoleWorkflow = readFileSync(
    path.join(repoRoot, '.github/workflows/deploy-console-backend.yml'),
    'utf8',
  );
  expect(consoleWorkflow).toContain(
    'CONSOLE_SESSION_HMAC_SECRET: ${{ secrets.CONSOLE_SESSION_HMAC_SECRET }}',
  );
  expect(consoleWorkflow).toContain('RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}');
  expect(consoleWorkflow).not.toContain('EMAIL_OTP_SES_ACCESS_KEY_ID:');
});

// Refactor 261: the production mainnet Console serves both production lanes.
test('the production testnet lane uses the production mainnet Console through its entrypoint', async () => {
  const module = await deploymentTargetsModule;
  const render = await import(
    pathToFileURL(
      path.join(repoRoot, 'packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs'),
    ).href
  );
  const testnet = module.readBackendLane('production-testnet');
  const mainnet = module.readBackendLane('production-mainnet');
  const staging = module.readBackendLane('staging-testnet');

  expect(testnet.console).toEqual(mainnet.console);
  expect(testnet.console.workerName).toBe('seams-sdk-d1-console');
  expect(testnet.resources.gateway.consoleD1Name).toBe('seams-console');
  expect(testnet.provisioning.gatewayDeploymentConfig.tenant.namespace).toBe('seams-production');
  expect(render.walletConsoleBinding(testnet)).toEqual({
    binding: 'WALLET_CONSOLE',
    service: 'seams-sdk-d1-console',
    entrypoint: 'TestnetWalletLane',
  });
  expect(render.walletConsoleBinding(mainnet)).toEqual({
    binding: 'WALLET_CONSOLE',
    service: 'seams-sdk-d1-console',
  });
  expect(render.walletConsoleBinding(staging)).toEqual({
    binding: 'WALLET_CONSOLE',
    service: 'seams-sdk-d1-console-staging',
  });
  expect(module.consoleSecretNames(mainnet)).toEqual(
    expect.arrayContaining([
      'TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID',
      'TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
    ]),
  );
  expect(module.consoleSecretNames(staging)).not.toContain(
    'TESTNET_LANE_TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
  );
  expect(() => render.consoleServedLanes(testnet)).toThrow(/no Console of its own/u);
});
