#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_WALLET_DOCS_ORIGIN,
  readConsoleFrontendSite,
  readFrontendSite,
  readHostRedirects,
} from './deployment-targets.mjs';
import { formatFailedCheck, isFailedCheck, runReadinessChecks } from './deployment-smoke.mjs';
import {
  assertDeploymentBranch,
  assertDirectory,
  assertFile,
  deployPagesProject,
  ensurePagesCustomDomain,
  releasePagesCustomDomains,
  requestCloudflareApi,
  requireEnvironmentValues,
  runCommand,
  smokeChecks,
} from './pages-deploy.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const WALLET_SITE_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'wallet-console');
const WALLET_SITE_OUTPUT = path.join(WALLET_SITE_ROOT, 'dist');
const WALLET_HOST_OUTPUT = path.join(REPOSITORY_ROOT, '.release-artifacts', 'wallet-host');
const WALLET_DOCS_OUTPUT = path.join(REPOSITORY_ROOT, '.release-artifacts', 'wallet-docs');
const PUBLIC_DOCS_ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, '.artifacts', 'wallet-docs');
const HOST_REDIRECTS_WORKER = path.join(
  REPOSITORY_ROOT,
  'deployment',
  'host-redirects',
  'worker.mjs',
);
const HOST_REDIRECTS_COMPATIBILITY_DATE = '2026-11-01';
const HOST_RELEASE_DEPLOY_ATTEMPTS = 8;
const SURFACES = Object.freeze(['wallet-console', 'wallet-docs', 'wallet-site', 'wallet-host']);
const COMPONENTS = Object.freeze(['all', ...SURFACES]);

function isDirectInvocation() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  );
}

async function main(args) {
  const options = parseArguments(args);
  if (options.component === 'wallet-console') {
    await runConsoleOperation(options.operation, readConsoleFrontendSite(options.site));
    return;
  }
  const site = readFrontendSite(options.site);
  const walletLanes = selectWalletLanes(site, options);
  if (options.operation !== 'plan') assertDeploymentBranch(site);
  if (options.component === 'all') {
    if (options.operation === 'deploy') {
      const consoles = readConsoleFrontendSite(options.site);
      requireEnvironmentValues(
        [
          'CLOUDFLARE_API_TOKEN',
          'CLOUDFLARE_ACCOUNT_ID',
          consoles.walletConsolePagesProjectEnv,
          site.docsPagesProjectEnv,
          site.walletSitePagesProjectEnv,
          ...walletLanes.map(walletPagesProjectEnvironment),
        ],
        process.env,
      );
    }
    for (const surface of SURFACES) {
      if (surface === 'wallet-console') {
        await runConsoleOperation(options.operation, readConsoleFrontendSite(options.site));
      } else {
        await runOperation(options.operation, site, surface, walletLanes);
      }
    }
    return;
  }
  await runOperation(options.operation, site, options.component, walletLanes);
}

/* Before the seams.sh zone moves to a new Cloudflare account, a deploy there uploads
   the Pages builds only: no custom domain, no redirect Worker, no smoke on the public
   hosts. */
function withoutPublicTraffic() {
  return process.env.SEAMS_DEPLOY_WITHOUT_PUBLIC_TRAFFIC === 'true';
}

function walletPagesProjectEnvironment(lane) {
  return lane.walletPagesProjectEnv;
}

async function runConsoleOperation(operation, site) {
  const component = 'wallet-console';
  const origin = site.walletConsoleOrigin;
  const projectEnv = site.walletConsolePagesProjectEnv;
  const output = path.join(WALLET_SITE_ROOT, 'dist-wallet');
  if (operation === 'plan') {
    process.stdout.write(
      `${JSON.stringify({ component, origin, output, pagesProjectEnvironment: projectEnv, branch: site.branch })}\n`,
    );
    return;
  }
  assertDeploymentBranch(site);
  if (operation === 'build') {
    const environment = {
      ...process.env,
      VITE_SITE_ORIGIN: origin,
      VITE_ASSET_BASE_PATH: '/',
      // One Console serves every network of the site (Refactor 261).
      VITE_CONSOLE_BASE_URL: origin,
      VITE_MAINNET_RELAYER_URL: '',
      // The login page runs in a dialog on the Wallet site's pricing page.
      VITE_WALLET_SITE_ORIGIN: readFrontendSite(site.id).walletSiteOrigin,
      // Without it the top bar's Docs link falls back to the local docs host.
      VITE_DOCS_ORIGIN: readFrontendSite(site.id).docsOrigin,
    };
    for (const lane of readFrontendSite(site.id).lanes) {
      environment[`VITE_${lane.network.toUpperCase()}_RELAYER_URL`] = lane.gatewayOrigin;
      environment[`VITE_${lane.network.toUpperCase()}_WALLET_ORIGIN`] = lane.walletOrigin;
    }
    runCommand('pnpm', ['-C', 'apps/wallet-console', 'run', 'build:wallet'], { env: environment });
    assertFile(path.join(output, 'index.html'), 'Console entry');
    fs.writeFileSync(path.join(output, '_redirects'), '/* /index.html 200\n');
    fs.appendFileSync(path.join(output, '_headers'), '\n/*\n  X-Robots-Tag: noindex\n');
    return;
  }
  if (operation === 'deploy') {
    requireEnvironmentValues(
      ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', projectEnv],
      process.env,
    );
    assertDirectory(output, 'Console output');
    await deployPagesProject(output, site, process.env[projectEnv]);
    if (!withoutPublicTraffic()) await ensurePagesCustomDomain(origin, process.env[projectEnv]);
    return;
  }
  if (operation === 'smoke') {
    if (withoutPublicTraffic()) return;
    const checks = smokeChecks(component, origin, [
      { path: '/dashboard/login', isReady: consoleApplicationIsReady },
      { path: '/console/auth/session', isReady: consoleSessionEndpointIsReady },
    ]);
    const results = await runReadinessChecks(checks);
    process.stdout.write(`${JSON.stringify({ results })}\n`);
    if (results.some(isFailedCheck)) throw new Error('Console frontend smoke failed');
    return;
  }
  throw new Error(`Unsupported Console operation: ${operation}`);
}

async function runOperation(operation, site, component, walletLanes) {
  switch (operation) {
    case 'plan':
      printPlan(site, component, walletLanes);
      return;
    case 'build':
      buildFrontend(site, component, walletLanes);
      return;
    case 'deploy':
      await deployFrontend(site, component, walletLanes);
      return;
    case 'smoke':
      await smokeFrontend(site, component, walletLanes);
      return;
    default:
      throw new Error(`Unsupported frontend operation: ${operation}`);
  }
}

function parseArguments(args) {
  const operation = String(args[0] || '').trim();
  let site = '';
  let component = '';
  let lane = '';
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--site') {
      site = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--component') {
      component = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--lane') {
      if (lane) throw new Error('--lane may only be provided once');
      lane = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(usage());
  }
  if (!['plan', 'build', 'deploy', 'smoke'].includes(operation) || !site) throw new Error(usage());
  if (!COMPONENTS.includes(component)) {
    throw new Error(`--component must be ${COMPONENTS.join(', ')}`);
  }
  if (lane && component !== 'wallet-host') {
    throw new Error('--lane requires --component wallet-host');
  }
  return { operation, site, component, lane };
}

function usage() {
  return 'usage: deploy-surface.mjs <plan|build|deploy|smoke> --site <site> --component <all|wallet-docs|wallet-site|wallet-host|wallet-console> [--lane <lane>]';
}

function selectWalletLanes(site, options) {
  if (!options.lane) return site.lanes;
  for (const lane of site.lanes) {
    if (lane.id === options.lane) return [lane];
  }
  throw new Error(`Lane ${options.lane} does not belong to site ${site.id}`);
}

function walletHostOutput(lane) {
  return path.join(WALLET_HOST_OUTPUT, lane.id);
}

function requireArgumentValue(args, index, name) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function printPlan(site, component, walletLanes) {
  const lines = {
    'wallet-docs': [
      `Origin: ${site.docsOrigin}`,
      `Pages project environment: ${site.docsPagesProjectEnv}`,
      'Artifact: exact public Wallet docs at the origin root',
    ],
    'wallet-site': [
      `Origin: ${site.walletSiteOrigin}`,
      `Docs redirect: ${site.docsOrigin}/`,
      `Console API: ${readConsoleFrontendSite(site.id).walletConsoleOrigin}/console/*`,
      `Pages project environment: ${site.walletSitePagesProjectEnv}`,
      'Artifact: wallet marketing and showcases',
    ],
    'wallet-host': walletLanes.flatMap((lane) => [
      `Hosted wallet (${lane.network}): ${lane.walletOrigin}`,
      `Pages project environment (${lane.network}): ${lane.walletPagesProjectEnv}`,
    ]),
  }[component];
  process.stdout.write(
    `${[`Frontend deployment plan: ${site.id}/${component}`, `Branch: ${site.branch}`, ...lines].join('\n')}\n`,
  );
}

function buildFrontend(site, component, walletLanes) {
  if (component === 'wallet-docs') {
    copyPublicDocsArtifact(WALLET_DOCS_OUTPUT);
    writeWalletDocsHeaders(site);
    assertFile(path.join(WALLET_DOCS_OUTPUT, 'index.html'), 'Wallet docs entry');
    assertFile(
      path.join(WALLET_DOCS_OUTPUT, 'guides', 'transaction-review.html'),
      'Wallet docs guide',
    );
    assertFile(path.join(WALLET_DOCS_OUTPUT, 'sitemap.xml'), 'Wallet docs sitemap');
    return;
  }
  if (component === 'wallet-site') {
    runCommand('pnpm', ['-C', 'apps/wallet-console', 'run', 'build:marketing'], {
      env: buildFrontendEnvironment(site, site.walletSiteOrigin),
    });
    writeWalletConsoleRedirects(site);
    copySdkAssets(WALLET_SITE_OUTPUT);
    if (site.id === 'staging') {
      fs.appendFileSync(
        path.join(WALLET_SITE_OUTPUT, '_headers'),
        '\n/*\n  X-Robots-Tag: noindex\n',
      );
    }
    fs.appendFileSync(
      path.join(WALLET_SITE_OUTPUT, '_headers'),
      '\n/showcase/*\n  X-Robots-Tag: noindex\n/wallet-service/*\n  X-Robots-Tag: noindex\n' +
        '\nhttps://:project.pages.dev/*\n  X-Robots-Tag: noindex\n' +
        '\nhttps://:version.:project.pages.dev/*\n  X-Robots-Tag: noindex\n',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'index.html'), 'Wallet site entry');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'ja', 'index.html'), 'Japanese Wallet site entry');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'pricing', 'index.html'), 'Wallet pricing entry');
    assertFile(
      path.join(WALLET_SITE_OUTPUT, 'ja', 'pricing', 'index.html'),
      'Japanese Wallet pricing entry',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'features', 'index.html'), 'Wallet features entry');
    assertFile(
      path.join(WALLET_SITE_OUTPUT, 'ja', 'features', 'index.html'),
      'Japanese Wallet features entry',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'sitemap.xml'), 'Wallet site sitemap');
    return;
  }
  assertWalletSettingsExport();
  for (const lane of walletLanes) {
    const output = walletHostOutput(lane);
    runCommand(
      'pnpm',
      [
        '-C',
        'apps/wallet-console',
        'exec',
        'vite',
        'build',
        '--config',
        'wallet-host/vite.config.ts',
        '--outDir',
        output,
      ],
      {
        env: buildFrontendEnvironment(site, site.walletSiteOrigin),
      },
    );
    copySdkAssets(output);
    copyHostPluginAssets(output);
    fs.appendFileSync(path.join(output, '_headers'), '\n/*\n  X-Robots-Tag: noindex\n');
    assertFile(path.join(output, 'index.html'), 'Wallet settings entry');
    fs.writeFileSync(path.join(output, '_redirects'), '/wallet-settings /index.html 200\n');
    assertFile(path.join(output, 'wallet-service', 'index.html'), 'wallet-service entry');
  }
}

function writeWalletConsoleRedirects(site) {
  const consoleOrigin = readConsoleFrontendSite(site.id).walletConsoleOrigin;
  const lines = [
    `/docs ${site.docsOrigin}/ 301`,
    `/docs/ ${site.docsOrigin}/ 301`,
    `/docs/* ${site.docsOrigin}/:splat 301`,
    '/ja /ja/ 301',
    '/pricing /pricing/ 301',
    '/ja/pricing /ja/pricing/ 301',
    '/features /features/ 301',
    '/ja/features /ja/features/ 301',
    `/company ${site.origin}/company 302`,
    `/company/* ${site.origin}/company/:splat 302`,
    `/ja/company ${site.origin}/ja/company/ 302`,
    `/ja/company/* ${site.origin}/ja/company/:splat 302`,
  ];
  lines.push(`/dashboard ${consoleOrigin}/dashboard 302`);
  lines.push(`/dashboard/* ${consoleOrigin}/dashboard/:splat 302`);
  // The support billing page moved from the Platform Console into the Wallet Console.
  lines.push(`/platform/* ${consoleOrigin}/platform/:splat 302`);
  fs.writeFileSync(path.join(WALLET_SITE_OUTPUT, '_redirects'), `${lines.join('\n')}\n`);
}

function writeWalletDocsHeaders(site) {
  const lines = ['/*', '  Cache-Control: public, max-age=0, must-revalidate, no-transform'];
  if (site.id === 'staging') lines.push('  X-Robots-Tag: noindex');
  fs.writeFileSync(path.join(WALLET_DOCS_OUTPUT, '_headers'), `${lines.join('\n')}\n`);
}

function copyPublicDocsArtifact(destination) {
  assertDirectory(PUBLIC_DOCS_ARTIFACT_ROOT, 'Public Wallet docs artifact');
  assertFile(
    path.join(PUBLIC_DOCS_ARTIFACT_ROOT, 'seams-wallet-docs-artifact.json'),
    'Public Wallet docs artifact receipt',
  );
  assertRootDocsArtifact();
  copyDirectory(PUBLIC_DOCS_ARTIFACT_ROOT, destination);
}

function assertRootDocsArtifact() {
  const entry = fs.readFileSync(path.join(PUBLIC_DOCS_ARTIFACT_ROOT, 'index.html'), 'utf8');
  if (entry.includes('href="/docs/') || entry.includes('src="/docs/')) {
    throw new Error('Public Wallet docs artifact must use the root base path');
  }
}

function copySdkAssets(destination) {
  const sdkOutput = path.join(resolveInstalledWalletRoot(), 'dist');
  const sdkEsm = path.join(sdkOutput, 'esm', 'sdk');
  const sdkWorkers = path.join(sdkOutput, 'workers');
  const walletAssetsManifest = path.join(sdkOutput, 'public', 'wallet-assets.manifest.json');
  const walletHeadersManifest = path.join(sdkOutput, 'public', 'headers.manifest.json');
  const pagesHeaders = path.join(sdkOutput, 'public', '_headers');
  const walletService = path.join(sdkOutput, 'public', 'wallet-service');
  assertDirectory(sdkEsm, 'SDK ESM output');
  assertDirectory(sdkWorkers, 'SDK Workers output');
  assertFile(walletAssetsManifest, 'SDK wallet assets manifest');
  assertFile(walletHeadersManifest, 'SDK wallet headers manifest');
  assertFile(pagesHeaders, 'SDK Cloudflare Pages headers');
  assertFile(path.join(walletService, 'index.html'), 'SDK wallet-service output');
  fs.mkdirSync(destination, { recursive: true });
  copyDirectory(sdkEsm, path.join(destination, 'sdk'));
  copyDirectory(sdkWorkers, path.join(destination, 'sdk', 'workers'));
  fs.copyFileSync(walletAssetsManifest, path.join(destination, 'wallet-assets.manifest.json'));
  fs.copyFileSync(walletHeadersManifest, path.join(destination, 'headers.manifest.json'));
  fs.copyFileSync(pagesHeaders, path.join(destination, '_headers'));
  copyDirectory(walletService, path.join(destination, 'wallet-service'));
}

// Every Wallet host serves the VoiceID host plugin. Speak-to-Sign has no host plugin since
// Wallet 0.68.0: its flow is a chunk of the Wallet SDK, which copySdkAssets copies.
const HOST_PLUGIN_COMPOSITION = { command: 'seams-voiceid-host', directories: ['voiceid'] };

function copyHostPluginAssets(destination) {
  const composition = HOST_PLUGIN_COMPOSITION;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-host-plugins-'));
  const composedAssets = path.join(temporaryDirectory, 'assets');
  try {
    runCommand('pnpm', ['-C', WALLET_SITE_ROOT, 'exec', composition.command, composedAssets]);
    for (const directory of composition.directories) {
      copyDirectory(
        path.join(composedAssets, 'sdk', directory),
        path.join(destination, 'sdk', directory),
      );
    }
    fs.copyFileSync(
      path.join(composedAssets, 'wallet-assets.manifest.json'),
      path.join(destination, 'wallet-assets.manifest.json'),
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function buildFrontendEnvironment(site, frontendOrigin, sourceEnvironment = process.env) {
  const environment = {
    ...sourceEnvironment,
    VITE_SITE_ID: site.id,
    VITE_SITE_ORIGIN: frontendOrigin,
    VITE_COMPANY_SITE_ORIGIN: site.origin,
    VITE_WALLET_SITE_ORIGIN: site.walletSiteOrigin,
    VITE_DOCS_ORIGIN: site.docsOrigin,
    // The pricing page's plan cards open the Wallet Console sign-in in a dialog.
    VITE_WALLET_CONSOLE_ORIGIN: readConsoleFrontendSite(site.id).walletConsoleOrigin,
  };
  for (const lane of site.lanes) {
    const prefix = site.id === 'production' ? `VITE_${lane.network.toUpperCase()}_` : 'VITE_';
    environment[`${prefix}RELAYER_URL`] = lane.gatewayOrigin;
    environment[`${prefix}CONSOLE_BASE_URL`] = lane.console.origin;
    environment[`${prefix}WALLET_ORIGIN`] = lane.walletOrigin;
    environment[`${prefix}RP_ID_BASE`] = new URL(lane.walletOrigin).hostname;
    environment[`${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID`] =
      lane.resources.signingWorker.workerName;
    requireEnvironmentValues(
      [
        `${prefix}NEAR_NETWORK`,
        `${prefix}NEAR_RPC_URL`,
        `${prefix}NEAR_EXPLORER`,
        `${prefix}CONSOLE_BASE_URL`,
        `${prefix}SIGNING_SESSION_PERSISTENCE_MODE`,
      ],
      environment,
    );
  }
  return environment;
}

async function deployFrontend(site, component, walletLanes) {
  requireEnvironmentValues(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], process.env);
  if (component === 'wallet-docs') {
    requireEnvironmentValues([site.docsPagesProjectEnv], process.env);
    assertDirectory(WALLET_DOCS_OUTPUT, 'Wallet docs Pages output');
    const project = process.env[site.docsPagesProjectEnv];
    // One docs project serves both sites: production from main, staging as the dev preview.
    await deployPagesProject(WALLET_DOCS_OUTPUT, site, project, 'main');
    if (site.id === 'production' && !withoutPublicTraffic()) {
      await ensurePagesCustomDomain(site.docsOrigin, project);
    }
  } else if (component === 'wallet-site') {
    const prepareOnly = withoutPublicTraffic();
    if (!prepareOnly) {
      await runConsoleOperation('smoke', readConsoleFrontendSite(site.id));
    }
    requireEnvironmentValues([site.walletSitePagesProjectEnv], process.env);
    assertDirectory(WALLET_SITE_OUTPUT, 'Wallet site Pages output');
    const project = process.env[site.walletSitePagesProjectEnv];
    await deployPagesProject(WALLET_SITE_OUTPUT, site, project);
    if (!prepareOnly) {
      await ensurePagesCustomDomain(site.walletSiteOrigin, project);
      await deployHostRedirects(site);
    }
  } else {
    const projectEnvironments = [...new Set(walletLanes.map((lane) => lane.walletPagesProjectEnv))];
    requireEnvironmentValues(projectEnvironments, process.env);
    for (const lane of walletLanes) {
      const output = walletHostOutput(lane);
      assertDirectory(output, 'Hosted wallet Pages output');
      await deployPagesProject(output, site, process.env[lane.walletPagesProjectEnv]);
    }
  }
  process.stdout.write(`Frontend deploy completed: ${site.id}/${component}\n`);
}

/* One Worker per site sends every former host to its successor. A former host that a
   Pages project in this account still serves is released first, so the Worker's custom
   domain can take it. The host's own DNS record must be gone too: the deploy token
   cannot remove it. */
async function deployHostRedirects(site) {
  const redirects = readHostRedirects(site.id);
  if (redirects.length === 0) return;
  const released = await releasePagesCustomDomains(
    redirects.map(({ from }) => new URL(from).hostname),
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-host-redirects-'));
  const configPath = path.join(directory, 'wrangler.json');
  const hosts = redirects.map(({ from, to }) => [new URL(from).hostname, to]);
  const config = {
    name: `seams-host-redirects-${site.id}`,
    main: HOST_REDIRECTS_WORKER,
    compatibility_date: HOST_REDIRECTS_COMPATIBILITY_DATE,
    workers_dev: false,
    // A custom domain brings its own certificate. A plain route on a host with two
    // or more labels under the zone has none, because the zone certificate covers
    // one label only. The Console API routes on these hosts stay more specific.
    routes: hosts.map(([host]) => ({ pattern: host, custom_domain: true })),
    vars: { HOST_REDIRECTS_JSON: JSON.stringify(Object.fromEntries(hosts)) },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  try {
    // Pages lets a released host go some time after the API call returns, and a Worker
    // custom domain on that host fails until then (2026-11-21: 5 s was too short).
    const attempts = released.length > 0 ? HOST_RELEASE_DEPLOY_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        runCommand('pnpm', ['exec', 'wrangler', 'deploy', '--config', configPath]);
        return;
      } catch (error) {
        if (attempt >= attempts) throw error;
        process.stdout.write(
          `Redirect Worker deploy failed after a Pages release; retry ${attempt}/${attempts - 1} in 30 s\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function smokeFrontend(site, component, walletLanes) {
  if (withoutPublicTraffic()) {
    process.stdout.write(
      `Frontend smoke skipped without public traffic: ${site.id}/${component}\n`,
    );
    return;
  }
  const checks = await buildSmokeChecks(site, component, walletLanes);
  const results = await runReadinessChecks(checks);
  const failed = results.filter(isFailedCheck);
  process.stdout.write(`${JSON.stringify({ results })}\n`);
  if (failed.length > 0) {
    throw new Error(`frontend smoke failed: ${failed.map(formatFailedCheck).join(', ')}`);
  }
}

async function buildSmokeChecks(site, component, walletLanes) {
  if (component === 'wallet-site') {
    return [
      ...smokeChecks('wallet-site', site.walletSiteOrigin, [
        { path: '/', isReady: walletMarketingIsReady },
        '/ja/',
        '/pricing/',
        '/ja/pricing/',
        '/features/',
        '/ja/features/',
        '/sitemap.xml',
        { path: '/robots.txt', isReady: walletRobotsIsReady },
        '/sdk/workers/near-signer.worker.js',
      ]),
      docsRedirectCheck('wallet-site', site.walletSiteOrigin, '/docs/guides/transaction-review'),
      ...readHostRedirects(site.id).map(hostRedirectCheck),
    ];
  }
  if (component === 'wallet-docs') {
    const origin = await walletDocsSmokeOrigin(site);
    const isReady = site.id === 'staging' ? stagingWalletDocsIsReady : walletDocsIsReady;
    return smokeChecks('wallet-docs', origin, [
      { path: '/', isReady },
      { path: '/concepts/', isReady },
      { path: '/guides/transaction-review', isReady },
      { path: '/reference/server', isReady },
      '/sitemap.xml',
      '/seams-wallet-docs-artifact.json',
    ]);
  }
  return walletLanes.flatMap((lane) =>
    smokeChecks(`wallet-${lane.network}`, lane.walletOrigin, [
      { path: '/', isReady: walletSettingsApplicationIsReady },
      { path: '/wallet-settings', isReady: walletSettingsApplicationIsReady },
      '/wallet-service/index.html',
      { path: '/wallet-assets.manifest.json', isReady: walletManifestMatchesInstalledVersion },
      '/sdk/voiceid/host.js',
      '/sdk/workers/router_ab_ed25519_yao_client_bg.wasm',
    ]),
  );
}

async function walletRobotsIsReady(response) {
  if (!response.headers.get('content-type')?.includes('text/plain')) return false;
  const body = await response.text();
  const sitemap = new URL('/sitemap.xml', response.url).href;
  return body.includes('User-agent: *') && body.includes(`Sitemap: ${sitemap}`);
}

async function walletMarketingIsReady(response) {
  if (!response.headers.get('content-type')?.includes('text/html')) return false;
  const html = await response.text();
  return html.includes('data-rendered="true"') && /<h1\b[^>]*>[^<]+/.test(html);
}

async function walletDocsIsReady(response) {
  if (!response.ok) return false;
  if (!response.headers.get('content-type')?.includes('text/html')) return false;
  if (!response.headers.get('cache-control')?.includes('no-transform')) return false;
  const html = await response.text();
  return html.includes('name="generator" content="VitePress');
}

async function stagingWalletDocsIsReady(response) {
  if (!(await walletDocsIsReady(response))) return false;
  return /\bnoindex\b/i.test(response.headers.get('x-robots-tag') || '');
}

async function walletDocsSmokeOrigin(site) {
  if (site.id === 'production') return site.docsOrigin;
  const project = String(process.env[site.docsPagesProjectEnv] || '').trim();
  if (!project) throw new Error(`${site.docsPagesProjectEnv} is required for staging docs smoke`);
  // A pages.dev subdomain can differ from the project name, so read it.
  const response = await requestCloudflareApi(
    `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(project)}`,
    process.env.CLOUDFLARE_API_TOKEN,
    'GET',
    [200],
  );
  const subdomain = (await response.json()).result?.subdomain || `${project}.pages.dev`;
  return `https://${site.branch}.${subdomain}`;
}

function docsRedirectCheck(surface, sourceOrigin, sourcePath) {
  const source = new URL(sourcePath, sourceOrigin);
  return {
    name: `${surface}${sourcePath} redirects to docs`,
    url: source.href,
    request: { redirect: 'manual' },
    isReady: isPermanentRedirectToWalletDocs,
  };
}

function hostRedirectCheck({ from, to }) {
  const source = new URL('/pricing/?from=smoke', from);
  return {
    name: `${source.hostname} redirects to ${new URL(to).hostname}`,
    url: source.href,
    request: { redirect: 'manual' },
    isReady(response) {
      const location = response.headers.get('location');
      return (
        response.status === 301 && location === new URL(source.pathname + source.search, to).href
      );
    },
  };
}

function isPermanentRedirectToWalletDocs(response) {
  if (response.status !== 301 && response.status !== 308) return false;
  const location = response.headers.get('location');
  if (!location) return false;
  const source = new URL(response.url);
  const destination = new URL(location, source);
  const sourcePath = source.pathname.startsWith('/docs/')
    ? source.pathname.slice('/docs'.length)
    : source.pathname;
  return (
    destination.origin === PUBLIC_WALLET_DOCS_ORIGIN &&
    destination.pathname === sourcePath &&
    destination.search === source.search
  );
}

async function walletManifestMatchesInstalledVersion(response) {
  const installedWalletRoot = resolveInstalledWalletRoot();
  const installedWalletVersion = readPackageVersion(path.join(installedWalletRoot, 'package.json'));
  return walletManifestMatchesPackageVersion(response, installedWalletVersion);
}

export async function walletManifestMatchesPackageVersion(response, expectedVersion) {
  if (!response.ok) return false;
  if (!String(response.headers.get('content-type') || '').includes('application/json')) {
    return false;
  }
  try {
    const manifest = await response.json();
    if (!isRecord(manifest) || !isRecord(manifest.versionSkewContract)) return false;
    return (
      manifest.packageName === '@seams/wallet' &&
      manifest.packageVersion === expectedVersion &&
      manifest.versionSkewContract.packageVersion === expectedVersion
    );
  } catch {
    return false;
  }
}

async function consoleApplicationIsReady(response) {
  if (!response.ok) return false;
  const html = await response.text();
  if (!html.includes('<title>Seams Wallet Console</title>')) return false;
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  return assetPaths.length > 0 && assetPaths.every((assetPath) => assetPath.startsWith('/assets/'));
}

async function consoleSessionEndpointIsReady(response) {
  if (response.status !== 200 && response.status !== 401) return false;
  if (!response.headers.get('content-type')?.includes('application/json')) return false;
  const body = await response.json();
  return isRecord(body) && typeof body.ok === 'boolean';
}

export async function walletSettingsApplicationIsReady(response) {
  if (!response.ok) return false;
  const html = await response.text();
  return (
    html.includes('<title>Seams Wallet Settings</title>') &&
    /<script[^>]+src="\/assets\/[^"\s]+\.js"/.test(html)
  );
}

function assertWalletSettingsExport() {
  const entry = path.join(resolveInstalledWalletRoot(), 'dist', 'esm', 'react', 'index.js');
  if (!fs.readFileSync(entry, 'utf8').includes('WalletSettingsPage')) {
    throw new Error(
      'The pinned @seams/wallet release does not export WalletSettingsPage. Publish the settings SDK release and update the exact package pins and lockfile before deploying wallet-host.',
    );
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  runCommand('rsync', ['-a', '--delete', `${source}${path.sep}`, `${destination}${path.sep}`]);
}

function readPackageVersion(packagePath) {
  const packageDocument = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!isRecord(packageDocument)) throw new Error(`Invalid package manifest: ${packagePath}`);
  const version = String(packageDocument.version || '').trim();
  if (!version) throw new Error(`Package version is missing: ${packagePath}`);
  return version;
}

function resolveInstalledWalletRoot() {
  const requireFromWalletSite = createRequire(path.join(WALLET_SITE_ROOT, 'package.json'));
  return path.dirname(requireFromWalletSite.resolve('@seams/wallet/package.json'));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleFailure(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

// Last, so every module constant exists before a synchronous build reads it.
if (isDirectInvocation()) {
  main(process.argv.slice(2)).catch(handleFailure);
}
