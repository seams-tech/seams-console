import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  WALLET_REGIONS,
  requireAllocatedWalletRegions,
  DEFAULT_EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX,
  DEFAULT_EMAIL_OTP_GRANT_RATE_LIMIT_MAX,
  DEFAULT_EMAIL_OTP_LOCKOUT_TTL_MS,
  DEFAULT_EMAIL_OTP_MAX_ATTEMPTS,
  DEFAULT_EMAIL_OTP_RATE_LIMIT_WINDOW_MS,
  DEFAULT_EMAIL_OTP_SENSITIVE_ATTEMPT_RATE_LIMIT_MAX,
  DEFAULT_EMAIL_OTP_VERIFY_RATE_LIMIT_MAX,
  DEFAULT_CONSOLE_SESSION_AUDIENCE,
  DEFAULT_CONSOLE_SESSION_COOKIE_NAME,
  DEFAULT_RELAY_SESSION_AUDIENCE,
  DEFAULT_SESSION_COOKIE_NAME,
  GATEWAY_WORKER_COMPATIBILITY_DATE,
  GATEWAY_WORKER_COMPATIBILITY_FLAGS,
  gatewayRuntimeProfileNearNetwork,
} from './gateway-deployment-config.mjs';
import {
  backendLaneIds,
  readBackendLane,
  readConsoleFrontendSite,
} from '../../../scripts/deployment-targets.mjs';
import { isDirectInvocation } from './d1-staging-config.mjs';

const VALID_LANES = new Set(backendLaneIds());

const require = createRequire(import.meta.url);

function walletServerMigrationsDirectory() {
  return path.join(
    path.dirname(require.resolve('@seams/wallet-server/package.json')),
    'migrations/d1-signer',
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const lane = readBackendLane(options.lane);
  const deployment = requireProvisionedGatewayDeploymentConfig(options.lane, lane.provisioning);
  if (options.worker !== 'console') requireAllocatedWalletRegions(deployment);
  const config =
    options.worker === 'console'
      ? buildConsoleConfig(lane, process.cwd())
      : options.worker === 'wallet-runtime'
        ? buildWalletRuntimeConfig(
            deployment,
            options.region,
            lane.site.origin,
            lane.walletOrigin,
            lane.emailOtpDelivery,
            lane.site.docsOrigin,
            process.cwd(),
            lane.resources.tenantRootControlPlane.workerName,
            walletConsoleBinding(lane),
          )
        : buildConfig(
            deployment,
            options.region,
            lane.site.origin,
            lane.walletOrigin,
            lane.emailOtpDelivery,
            lane.site.docsOrigin,
            process.cwd(),
            walletConsoleBinding(lane),
          );
  writePrivateJson(options.output, config);
  process.stdout.write(`${path.resolve(process.cwd(), options.output)}\n`);
}

function requireProvisionedGatewayDeploymentConfig(laneId, provisioning) {
  if (!provisioning || provisioning.kind !== 'provisioned') {
    throw new Error(`backend lane ${laneId} has no provisioned Gateway deployment config`);
  }
  const deployment = provisioning.gatewayDeploymentConfig;
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    throw new Error(`backend lane ${laneId} has no provisioned Gateway deployment config`);
  }
  return deployment;
}

function parseArguments(args) {
  let lane = '';
  let output = '';
  let worker = 'gateway';
  let region = '';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--lane') {
      lane = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--output') {
      output = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--region') {
      region = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--worker') {
      worker = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!VALID_LANES.has(lane)) {
    throw new Error('--lane must be ' + [...VALID_LANES].join(', '));
  }
  if (!output) throw new Error('--output is required');
  if (!['gateway', 'console', 'wallet-runtime'].includes(worker)) {
    throw new Error('--worker must be gateway, console, or wallet-runtime');
  }
  if (worker === 'console' ? region !== '' : !WALLET_REGIONS.includes(region)) {
    throw new Error(
      'Gateway/Runtime require --region US, WEUR, APAC, or OC; Console has no region',
    );
  }
  return { lane, output, worker, region };
}

function requireArgumentValue(args, index, name) {
  const value = String(args[index + 1] || '').trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function writePrivateJson(relativePath, value) {
  const outputPath = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/* Before the seams.sh zone moves to a new Cloudflare account, a deploy there must
   not attach public routes, custom domains or cron triggers (Refactor 200,
   Phase 4). The workflows set this for a prepare-only run. */
function withoutPublicTraffic() {
  return process.env.SEAMS_DEPLOY_WITHOUT_PUBLIC_TRAFFIC === 'true';
}

/* A Gateway or Wallet Runtime reaches the Console that serves its lane. A lane after the
   Console's first binds the entrypoint of its network, so the binding fixes the lane
   (Refactor 261). The first lane binds the default entrypoint. */
export function walletConsoleBinding(lane) {
  const index = lane.console.walletLanes?.findIndex((entry) => entry.laneId === lane.id) ?? 0;
  if (index < 0) throw new Error(`the Console of ${lane.id} does not list it`);
  return {
    binding: 'WALLET_CONSOLE',
    service: lane.console.workerName,
    ...(index > 0 ? { entrypoint: consoleLaneEntrypoint(lane.network) } : {}),
  };
}

function consoleLaneEntrypoint(network) {
  if (network === 'testnet') return 'TestnetWalletLane';
  if (network === 'mainnet') return 'MainnetWalletLane';
  throw new Error(`no Console entrypoint serves the ${network} network`);
}

/* A later lane's values carry this prefix in the Console Worker (`consoleWalletLanes.ts`). */
function consoleLanePrefix(network) {
  return `${network.toUpperCase()}_LANE_`;
}

/* The lanes that one Console serves, first its owner. */
export function consoleServedLanes(ownerLane) {
  if (ownerLane.console.laneId !== ownerLane.id) {
    throw new Error(
      `${ownerLane.id} has no Console of its own: its Console belongs to ${ownerLane.console.laneId}`,
    );
  }
  const walletLanes = ownerLane.console.walletLanes;
  if (!walletLanes) return [{ lane: ownerLane, environmentKeys: null }];
  return walletLanes.map((entry) => ({
    lane: entry.laneId === ownerLane.id ? ownerLane : readBackendLane(entry.laneId),
    environmentKeys: entry.environmentKeys,
  }));
}

export function walletRuntimeWorkerNameFor(gatewayWorkerName) {
  if (!gatewayWorkerName.includes('gateway')) {
    throw new Error(`cannot derive wallet runtime worker name from ${gatewayWorkerName}`);
  }
  return gatewayWorkerName.replace('gateway', 'wallet-runtime');
}

// The Console Worker (R105 Phase 4): its own origin, session plane, cron, and only the
// Console D1 binding. It is also the private WALLET_CONSOLE service binding target of the
// Gateways and Wallet Runtimes of every lane it serves (Refactor 261).
function buildConsoleConfig(ownerLane, packageRoot) {
  const served = consoleServedLanes(ownerLane);
  const deployment = requireProvisionedGatewayDeploymentConfig(
    ownerLane.id,
    ownerLane.provisioning,
  );
  const consoleTarget = ownerLane.console;
  const walletSiteOrigin = ownerLane.site.walletSiteOrigin;
  const consoleSite = readConsoleFrontendSite(ownerLane.site.id);
  const frontendOrigins = [consoleSite.walletConsoleOrigin];
  // Former hosts keep the Console API routes; their pages redirect to the new hosts.
  const formerFrontendOrigins = consoleSite.formerWalletConsoleOrigins;
  const production = ownerLane.release !== 'staging';
  const consoleBaseUrl = new URL(consoleSite.walletConsoleOrigin);
  consoleBaseUrl.searchParams.set('db_network', ownerLane.network);
  const vars = {
    SEAMS_TENANT_STORAGE_NAMESPACE: deployment.tenant.namespace,
    SEAMS_WALLET_SERVICE_DEPLOYMENT_ID: consoleTarget.walletServiceDeploymentId,
    SEAMS_TENANT_BROWSER_CREDENTIAL_JSON: JSON.stringify({
      kind: 'create_managed_publishable_key',
    }),
    CONSOLE_BASE_URL: consoleBaseUrl.href,
    CONSOLE_CORS_ORIGINS: [walletSiteOrigin, consoleSite.walletConsoleOrigin].join(','),
    CONSOLE_STEP_UP_RP_ID: new URL(walletSiteOrigin).hostname,
    CONSOLE_STEP_UP_ORIGIN: consoleSite.walletConsoleOrigin,
    CONSOLE_SESSION_COOKIE_NAME: DEFAULT_CONSOLE_SESSION_COOKIE_NAME,
    CONSOLE_SESSION_ISSUER: `${consoleTarget.origin}/console`,
    CONSOLE_SESSION_AUDIENCE: DEFAULT_CONSOLE_SESSION_AUDIENCE,
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_ID: `console-email-${deployment.lane}-r1`,
    CONSOLE_WEBHOOK_SECRET_KEY_ID: `console-webhook-${deployment.lane}-r1`,
    SPONSORED_EXECUTION_REAL_PRICING_JSON: JSON.stringify(
      buildOutlayerSponsoredExecutionPricingConfig(served.map(servedRuntimeProfile)),
    ),
    SPONSORED_EXECUTION_STATIC_PRICING_JSON: JSON.stringify(
      buildStaticSponsoredExecutionPricingConfig(served.map(servedRuntimeProfile)),
    ),
  };
  if (consoleTarget.walletLanes) {
    vars.SEAMS_CONSOLE_WALLET_LANES_JSON = JSON.stringify(
      served.map(({ lane, environmentKeys }) => ({
        deploymentLane: lane.id,
        network: lane.network,
        environmentKeys,
      })),
    );
  }
  if (consoleTarget.platformSupportEmails) {
    vars.CONSOLE_PLATFORM_SUPPORT_EMAILS = consoleTarget.platformSupportEmails.join(',');
  }
  addOptionalStringVar(vars, 'GOOGLE_OIDC_CLIENT_ID', deployment.optional.googleOidcClientId);
  if (production) {
    vars.CONSOLE_EMAIL_RUNTIME_PROFILE = 'PRODUCTION';
    vars.CONSOLE_EMAIL_PROVIDER = 'RESEND';
    vars.CONSOLE_EMAIL_FROM = `Seams <${ownerLane.emailOtpDelivery.provider.fromAddress}>`;
    vars.CONSOLE_EMAIL_CRON_EXPRESSIONS = '* * * * *';
  } else {
    vars.CONSOLE_EMAIL_RUNTIME_PROFILE = 'DEVELOPMENT';
    vars.CONSOLE_EMAIL_PROVIDER = 'CAPTURE';
  }
  const services = [];
  for (const [index, { lane }] of served.entries()) {
    const prefix = index === 0 ? '' : consoleLanePrefix(lane.network);
    const values = consoleLaneValues(lane, index === 0);
    for (const [name, value] of Object.entries(values.vars)) vars[`${prefix}${name}`] = value;
    for (const service of values.services) {
      services.push({ ...service, binding: `${prefix}${service.binding}` });
    }
  }
  return {
    name: consoleTarget.workerName,
    main: path.join(packageRoot, 'src/router/cloudflare/d1ConsoleStagingWorker.ts'),
    ...(consoleTarget.placementRegion
      ? { placement: { region: consoleTarget.placementRegion } }
      : {}),
    compatibility_date: GATEWAY_WORKER_COMPATIBILITY_DATE,
    compatibility_flags: [...GATEWAY_WORKER_COMPATIBILITY_FLAGS, 'global_fetch_strictly_public'],
    workers_dev: false,
    routes: withoutPublicTraffic()
      ? []
      : buildConsoleRoutes(
          consoleTarget.origin,
          walletSiteOrigin,
          [...frontendOrigins, ...formerFrontendOrigins],
          ownerLane.site.formerWalletSiteOrigins,
        ),
    d1_databases: [
      {
        binding: 'CONSOLE_DB',
        database_name: deployment.resources.consoleD1.name,
        database_id: deployment.resources.consoleD1.id,
        migrations_dir: path.join(packageRoot, 'migrations/d1-console'),
      },
    ],
    services,
    triggers: {
      crons: withoutPublicTraffic() ? [] : ['* * * * *', '0 3 * * *'],
    },
    observability: {
      enabled: true,
      logs: {
        enabled: true,
      },
    },
    vars,
  };
}

function servedRuntimeProfile({ lane }) {
  return requireProvisionedGatewayDeploymentConfig(lane.id, lane.provisioning).runtimeProfile;
}

/* The values of one lane, with the names that the Console's first lane uses. Recovery
   certificates exist only for the first lane: production testnet has none
   (`docs/recovery-trust-operations.md`). */
function consoleLaneValues(lane, first) {
  const deployment = requireProvisionedGatewayDeploymentConfig(lane.id, lane.provisioning);
  const resources = deployment.resources;
  const vars = {
    TENANT_DEPLOYMENT_SURFACES_JSON: JSON.stringify({
      applicationOrigin: lane.site.walletSiteOrigin,
      hostedWalletOrigin: lane.walletOrigin,
      gatewayOrigin: lane.gatewayOrigin,
      relyingPartyId: new URL(lane.walletOrigin).hostname,
    }),
    WALLET_BALANCE_NEAR_RPC_URL: walletBalanceNearRpcUrl(deployment),
  };
  if (first) vars.SEAMS_TENANT_DEPLOYMENT_LANE = deployment.lane;
  let regionalWalletConfigured = true;
  for (const region of WALLET_REGIONS) {
    if (resources.regions[region].signerD1.kind !== 'allocated') regionalWalletConfigured = false;
  }
  if (regionalWalletConfigured)
    vars.SEAMS_WALLET_HOME_CATALOG_JSON = walletHomeCatalogJson(deployment);
  if (first) {
    addOptionalStringVar(
      vars,
      'TENANT_ROOT_RECOVERY_CERTIFICATES_JSON',
      process.env.TENANT_ROOT_RECOVERY_CERTIFICATES_JSON,
    );
  }
  return {
    vars,
    services: [
      ...(regionalWalletConfigured ? regionalGatewayBindings(deployment) : []),
      ...(regionalWalletConfigured ? regionalRuntimeBindings(deployment) : []),
      {
        binding: 'WALLET_RUNTIME',
        service: walletRuntimeWorkerNameFor(resources.regions[resources.ingressRegion].workerName),
      },
    ],
  };
}

/* The Console reads wallet NEAR balances from the network of the lane. The testnet lanes name
   their relayer's RPC host; mainnet has no relayer and uses the mainnet host of the price
   oracle. */
function walletBalanceNearRpcUrl(deployment) {
  if (gatewayRuntimeProfileNearNetwork(deployment.runtimeProfile) === 'mainnet') {
    return MAINNET_NEAR_RPC_URL;
  }
  return deployment.optional.nearRelayer?.rpcUrl ?? 'https://rpc.testnet.fastnear.com';
}

/* The Console API answers on the Wallet Console host: its API and tenant-deployment paths go
   to this Worker and its pages to Pages. Former Console hosts and the Wallet site hosts keep
   the API paths, so a client that names an older host keeps working; an API host never
   redirects. */
export function buildConsoleRoutes(
  consoleOrigin,
  walletSiteOrigin,
  frontendOrigins,
  formerWalletSiteOrigins = [],
) {
  const apiPaths = ['/console', '/console/*'];
  const routesOn = (origin, paths) => {
    const host = new URL(origin).hostname;
    const zone = zoneNameFor(host);
    return paths.map((routePath) => ({ pattern: `${host}${routePath}`, zone_name: zone }));
  };
  const frontendRoutes = frontendOrigins.flatMap((origin) => routesOn(origin, apiPaths));
  if (!frontendOrigins.includes(consoleOrigin)) {
    throw new Error(`the Console origin ${consoleOrigin} is not its frontend host`);
  }
  return [
    ...frontendRoutes,
    ...routesOn(consoleOrigin, [
      '/internal/tenant-deployment/v1/verify-resource',
      '/internal/tenant-deployment/v1/cutover',
    ]),
    ...[walletSiteOrigin, ...formerWalletSiteOrigins].flatMap((origin) =>
      routesOn(origin, apiPaths),
    ),
  ];
}

function zoneNameFor(hostname) {
  return hostname.split('.').slice(-2).join('.');
}

function buildWalletRuntimeConfig(
  deployment,
  region,
  siteOrigin,
  walletOrigin,
  emailOtpDelivery,
  docsOrigin,
  packageRoot,
  controlPlaneWorkerName,
  consoleBinding,
) {
  const resources = deployment.resources.regions[region];
  return {
    name: walletRuntimeWorkerNameFor(resources.workerName),
    main: path.join(packageRoot, 'src/router/cloudflare/d1WalletRuntimeWorker.ts'),
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    compatibility_date: GATEWAY_WORKER_COMPATIBILITY_DATE,
    compatibility_flags: GATEWAY_WORKER_COMPATIBILITY_FLAGS,
    workers_dev: false,
    placement: { region: resources.placementRegion },
    d1_databases: [
      {
        binding: 'SIGNER_DB',
        database_name: resources.signerD1.name,
        database_id: resources.signerD1.id,
        migrations_dir: walletServerMigrationsDirectory(),
      },
    ],
    services: [
      { binding: 'SIGNING_WORKER', service: deployment.serviceNames.signingWorker },
      { binding: 'MPC_ROUTER', service: deployment.serviceNames.mpcRouter },
      { binding: 'TENANT_ROOT_CONTROL_PLANE', service: controlPlaneWorkerName },
      { binding: 'DERIVER_A', service: deployment.serviceNames.deriverA },
      { binding: 'DERIVER_B', service: deployment.serviceNames.deriverB },
      consoleBinding,
    ],
    observability: {
      enabled: true,
      logs: { enabled: true },
    },
    vars: buildWorkerVars(
      deployment,
      region,
      siteOrigin,
      walletOrigin,
      emailOtpDelivery,
      docsOrigin,
    ),
  };
}

function buildConfig(
  deployment,
  region,
  siteOrigin,
  walletOrigin,
  emailOtpDelivery,
  docsOrigin,
  packageRoot,
  consoleBinding,
) {
  const resources = deployment.resources.regions[region];
  const vars = buildWorkerVars(
    deployment,
    region,
    siteOrigin,
    walletOrigin,
    emailOtpDelivery,
    docsOrigin,
  );
  return {
    name: resources.workerName,
    main: path.join(packageRoot, 'src/router/cloudflare/d1GatewayWorker.ts'),
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    compatibility_date: GATEWAY_WORKER_COMPATIBILITY_DATE,
    compatibility_flags: GATEWAY_WORKER_COMPATIBILITY_FLAGS,
    placement: { region: resources.placementRegion },
    workers_dev: false,
    routes:
      region === deployment.resources.ingressRegion && !withoutPublicTraffic()
        ? [deployment.origins.gateway, ...(deployment.origins.formerGateways ?? [])].map(
            (origin) => ({ pattern: new URL(origin).hostname, custom_domain: true }),
          )
        : [],
    d1_databases: [
      {
        binding: 'SIGNER_DB',
        database_name: resources.signerD1.name,
        database_id: resources.signerD1.id,
        migrations_dir: walletServerMigrationsDirectory(),
      },
    ],
    services: [
      ...regionalGatewayBindings(deployment),
      { binding: 'SIGNING_WORKER', service: deployment.serviceNames.signingWorker },
      { binding: 'MPC_ROUTER', service: deployment.serviceNames.mpcRouter },
      consoleBinding,
    ],
    triggers: {
      crons: withoutPublicTraffic() ? [] : ['* * * * *'],
    },
    observability: {
      enabled: true,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        invocation_logs: true,
      },
      traces: {
        enabled: true,
        head_sampling_rate: 1,
      },
    },
    vars,
  };
}

function walletHomeCatalogJson(deployment) {
  const resources = requireAllocatedWalletRegions(deployment);
  const accountId = deploymentResourceAccountId();
  const catalog = [];
  for (const region of WALLET_REGIONS) {
    catalog.push({ region, accountId, databaseId: resources[region].signerD1.id });
  }
  return JSON.stringify(catalog);
}

function regionalGatewayBindings(deployment) {
  const bindings = [];
  for (const region of WALLET_REGIONS) {
    bindings.push({
      binding: `WALLET_GATEWAY_${region}`,
      service: deployment.resources.regions[region].workerName,
    });
  }
  return bindings;
}

function regionalRuntimeBindings(deployment) {
  const bindings = [];
  for (const region of WALLET_REGIONS) {
    bindings.push({
      binding: `WALLET_RUNTIME_${region}`,
      service: walletRuntimeWorkerNameFor(deployment.resources.regions[region].workerName),
    });
  }
  return bindings;
}

function deploymentResourceAccountId() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/u.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required to configure the deployment D1 resource');
  }
  return accountId;
}

function buildWorkerVars(
  deployment,
  region,
  siteOrigin,
  walletOrigin,
  emailOtpDelivery,
  docsOrigin,
) {
  const production = deployment.lane !== 'staging-testnet';
  const implicitNearTestFunding =
    deployment.runtimeProfile.nearFunding.kind === 'implicit_account_relayer';
  const demoEmailOtpDelivery =
    deployment.runtimeProfile.emailOtpDelivery.kind === 'demo_code_response' ||
    deployment.runtimeProfile.emailOtpDelivery.kind === 'provider_and_demo_code';
  const vars = {
    SEAMS_WALLET_HOME_CATALOG_JSON: walletHomeCatalogJson(deployment),
    SEAMS_TENANT_STORAGE_NAMESPACE: deployment.tenant.namespace,
    SEAMS_TENANT_DEPLOYMENT_LANE: deployment.lane,
    SEAMS_D1_HOME_ACCOUNT_ID: deploymentResourceAccountId(),
    SEAMS_D1_HOME_DATABASE_ID: deployment.resources.regions[region].signerD1.id,
    ROUTER_AB_PREWARM_ENABLED: 'true',
    SIGNING_WORKER_ID: deployment.serviceNames.signingWorker,
    ROUTER_AB_CEREMONY_JWT_ISSUER: deployment.origins.gateway,
    ROUTER_AB_CEREMONY_JWT_AUDIENCE: deployment.routerAb.ceremonyJwtAudience,
    ROUTER_AB_CEREMONY_JWT_KEY_ID: deployment.routerAb.ceremonyJwtKeyId,
    LINKED_DEVICE_WEBAUTHN_RP_ID: new URL(walletOrigin).hostname,
    ROUTER_AB_PUBLIC_KEYSET_JSON: JSON.stringify(deployment.routerAb.publicKeyset),
    ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON: JSON.stringify(
      deployment.routerAb.registrationTopology,
    ),
    ENABLE_IMPLICIT_NEAR_ACCOUNT_TEST_FUNDING: String(implicitNearTestFunding),
    RELAY_SESSION_ISSUER: deployment.session.issuer,
    RELAY_SESSION_AUDIENCE: DEFAULT_RELAY_SESSION_AUDIENCE,
    RELAY_CORS_ORIGINS: deployment.origins.allowedCors.join(','),
    HOSTED_WALLET_ORIGINS: walletOrigin,
    SESSION_COOKIE_NAME: DEFAULT_SESSION_COOKIE_NAME,
    SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION: deployment.signingSessionSeal.currentKeyVersion,
    SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS:
      deployment.signingSessionSeal.acceptedWarmKeyVersions.join(','),
    EMAIL_OTP_SERVER_SEAL_ACCEPTED_WARM_KEY_VERSIONS:
      deployment.emailOtpServerSeal.acceptedWarmKeyVersions.join(','),
    EMAIL_OTP_RUNTIME_PROFILE: deployment.runtimeProfile.kind,
    EMAIL_OTP_DELIVERY_MODE: deployment.runtimeProfile.emailOtpDelivery.kind,
    EMAIL_OTP_PRODUCTION: String(production),
    EMAIL_OTP_DEV_OUTBOX_ENABLED: 'false',
    EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX: DEFAULT_EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX,
    EMAIL_OTP_CHALLENGE_RATE_LIMIT_WINDOW_MS: DEFAULT_EMAIL_OTP_RATE_LIMIT_WINDOW_MS,
    EMAIL_OTP_VERIFY_RATE_LIMIT_MAX: DEFAULT_EMAIL_OTP_VERIFY_RATE_LIMIT_MAX,
    EMAIL_OTP_VERIFY_RATE_LIMIT_WINDOW_MS: DEFAULT_EMAIL_OTP_RATE_LIMIT_WINDOW_MS,
    EMAIL_OTP_GRANT_RATE_LIMIT_MAX: DEFAULT_EMAIL_OTP_GRANT_RATE_LIMIT_MAX,
    EMAIL_OTP_GRANT_RATE_LIMIT_WINDOW_MS: DEFAULT_EMAIL_OTP_RATE_LIMIT_WINDOW_MS,
    EMAIL_OTP_MAX_ATTEMPTS: DEFAULT_EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_LOCKOUT_TTL_MS: DEFAULT_EMAIL_OTP_LOCKOUT_TTL_MS,
    EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_MAX:
      DEFAULT_EMAIL_OTP_SENSITIVE_ATTEMPT_RATE_LIMIT_MAX,
    EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_WINDOW_MS:
      DEFAULT_EMAIL_OTP_RATE_LIMIT_WINDOW_MS,
  };
  if (production) {
    if (emailOtpDelivery.kind === 'demo_code_response') {
      throw new Error('Production transactional email requires a configured email provider');
    }
    vars.CONSOLE_DOCS_BASE_URL = docsOrigin;
    vars.CONSOLE_EMAIL_RUNTIME_PROFILE = 'PRODUCTION';
    vars.CONSOLE_EMAIL_PROVIDER = 'RESEND';
    vars.CONSOLE_EMAIL_FROM = `Seams <${emailOtpDelivery.provider.fromAddress}>`;
    vars.CONSOLE_EMAIL_CRON_EXPRESSIONS = '* * * * *';
  }
  if (demoEmailOtpDelivery) {
    vars.EMAIL_OTP_DEMO_ALLOWED_ORIGINS = deployment.origins.allowedCors.join(',');
  }
  if (emailOtpDelivery.kind !== 'demo_code_response') {
    vars.EMAIL_OTP_PROVIDER = emailOtpDelivery.provider.kind;
    vars.EMAIL_OTP_FROM_ADDRESS = emailOtpDelivery.provider.fromAddress;
    if (emailOtpDelivery.provider.kind === 'amazon_ses') {
      vars.EMAIL_OTP_SES_REGION = emailOtpDelivery.provider.region;
    }
  }
  addNearRelayerVars(vars, deployment.optional.nearRelayer);
  addOptionalStringVar(vars, 'GOOGLE_OIDC_CLIENT_ID', deployment.optional.googleOidcClientId);
  addSpeakToSignVerifierVars(vars, deployment.optional.speakToSignVerifier);
  return vars;
}

/**
 * The secrets file adds SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY and SPEAK_TO_SIGN_NEAR_AI_API_KEY (the
 * summary route of a note) for the same lanes.
 */
function addSpeakToSignVerifierVars(vars, verifier) {
  if (!verifier) return;
  vars.SPEAK_TO_SIGN_OUTLAYER_BASE_URL = verifier.outlayerBaseUrl;
  vars.SPEAK_TO_SIGN_OUTLAYER_PROJECT = verifier.project;
  vars.SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY = verifier.versionKey;
  vars.SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE = verifier.secretsProfile;
  vars.SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID = verifier.secretsAccountId;
  if (verifier.veniceVersionKey) {
    vars.SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY = verifier.veniceVersionKey;
  }
}

// The price oracle `price-oracle.near` is a mainnet contract.
const MAINNET_NEAR_RPC_URL = 'https://free.rpc.fastnear.com';

/* One pricing class per NEAR network of the lanes that the Console serves. */
function nearNetworkClasses(runtimeProfiles) {
  const classes = runtimeProfiles.map((profile) =>
    gatewayRuntimeProfileNearNetwork(profile) === 'mainnet' ? 'MAINNET' : 'TESTNET',
  );
  if (new Set(classes).size !== classes.length) {
    throw new Error('two lanes of one Console share a NEAR network');
  }
  return classes;
}

function buildOutlayerSponsoredExecutionPricingConfig(runtimeProfiles) {
  const near = {};
  for (const networkClass of nearNetworkClasses(runtimeProfiles)) {
    near[networkClass] = {
      nativeUnitDecimals: 24,
      estimateFeeAmountYocto: '1000000000000000000000',
      pricingVersionPrefix: `outlayer-near-${networkClass.toLowerCase()}`,
    };
  }
  return {
    provider: 'outlayer',
    nearRpcUrl: MAINNET_NEAR_RPC_URL,
    oracleContractId: 'price-oracle.near',
    nearUsdPriceId: 'c415de8d2efa7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750',
    maxAgeSeconds: 120,
    maxLatestToEmaDeviationBps: 1_000,
    cacheTtlMs: 60_000,
    near,
  };
}

function buildStaticSponsoredExecutionPricingConfig(runtimeProfiles) {
  const near = {};
  for (const networkClass of nearNetworkClasses(runtimeProfiles)) {
    near[networkClass] = {
      estimateFeeAmountYocto: '1000000000000000000000',
      minorPerFeeUnitNumerator: '300',
      minorPerFeeUnitDenominator: '1000000000000000000000000',
      pricingVersion: `static-near-${networkClass.toLowerCase()}-v1`,
    };
  }
  return { near };
}

function addNearRelayerVars(vars, nearRelayer) {
  if (!nearRelayer) return;
  vars.RELAYER_ACCOUNT_ID = nearRelayer.accountId;
  addOptionalStringVar(vars, 'RELAYER_PUBLIC_KEY', nearRelayer.publicKey);
  vars.NEAR_RPC_URL = nearRelayer.rpcUrl;
  vars.ACCOUNT_INITIAL_BALANCE = nearRelayer.initialBalanceYocto;
}

function addOptionalStringVar(vars, name, value) {
  if (value === null) return;
  vars[name] = value;
}

if (isDirectInvocation(import.meta.url)) main();
