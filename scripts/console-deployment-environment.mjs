#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';
import {
  consoleLaneGrantSecretNames,
  consoleSecretNames,
  readBackendLane,
  readConsoleTarget,
} from './deployment-targets.mjs';
import { localConsoleValuesFile, localSecretsRoot } from './local-secrets.mjs';

const MODES = new Set(['prepare', 'apply', 'update', 'lane-grant-key']);
const OPTIONAL_SECRET_INPUTS = Object.freeze([
  ['SEAMS_GITHUB_OAUTH_CLIENT_ID', 'SEAMS_GITHUB_OAUTH_CLIENT_ID'],
  ['SEAMS_GITHUB_OAUTH_CLIENT_SECRET', 'SEAMS_GITHUB_OAUTH_CLIENT_SECRET'],
  ['SEAMS_GITHUB_OAUTH_CALLBACK_URL', 'SEAMS_GITHUB_OAUTH_CALLBACK_URL'],
]);
const RECOVERY_CERTIFICATE_LANES = new Set(['staging-testnet', 'production-mainnet']);
/* The GitHub environments of a lane's role Workers share this prefix. */
const LANE_ENVIRONMENT_PREFIXES = Object.freeze({
  'staging-testnet': 'staging',
  'production-testnet': 'production-testnet',
  'production-mainnet': 'production',
});

const options = parseOptions(process.argv.slice(2));
await run(options);

async function run(input) {
  switch (input.mode) {
    case 'prepare':
      prepareManifest(input);
      return;
    case 'apply':
      applyManifest(input);
      return;
    case 'update':
      updateExternalValues(input);
      return;
    case 'lane-grant-key':
      copyLaneGrantKey(input);
      return;
    default:
      throw new Error(`Unsupported Console environment mode: ${input.mode}`);
  }
}

function parseOptions(args) {
  const mode = String(args[0] || '').trim();
  if (!MODES.has(mode)) printUsageAndExit();
  const values = new Map();
  let apply = false;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (['--lane', '--values-file', '--manifest-file', '--repo'].includes(argument)) {
      const value = String(args[index + 1] || '').trim();
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      values.set(argument, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  const laneId = requireOption(values, '--lane');
  const lane = readBackendLane(laneId);
  const target = readConsoleTarget(laneId);
  // A lane that a shared Console serves owns no Console environment (Refactor 261). Its only
  // Console value is its grant key, which `lane-grant-key` copies.
  if ((mode === 'lane-grant-key') === (target.laneId === lane.id)) {
    throw new Error(
      mode === 'lane-grant-key'
        ? `${laneId} owns its Console; lane-grant-key is for a lane that a shared Console serves`
        : `${laneId} has no Console of its own; its Console is ${target.laneId}`,
    );
  }
  if (mode === 'prepare' && apply) throw new Error('prepare and --apply are separate operations');
  if ((mode === 'apply' || mode === 'lane-grant-key') && !values.has('--manifest-file')) {
    throw new Error(`${mode} requires --manifest-file`);
  }
  if (mode !== 'apply' && mode !== 'lane-grant-key' && values.has('--manifest-file')) {
    throw new Error('--manifest-file is valid only for apply and lane-grant-key');
  }
  return Object.freeze({
    mode,
    lane,
    target,
    valuesFile: path.resolve(values.get('--values-file') || localConsoleValuesFile(laneId)),
    manifestFile: values.has('--manifest-file')
      ? path.resolve(values.get('--manifest-file'))
      : undefined,
    repository: values.get('--repo'),
    apply,
    json,
  });
}

function requireOption(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function prepareManifest(input) {
  const externalValues = readProtectedValues(input.valuesFile);
  assertGithubCallback(input.target, externalValues);
  const grantAuthority = generateGrantAuthority(input.lane.id);
  const generatedAt = new Date().toISOString();
  const generationId = `console-${input.lane.id}-${randomBytes(12).toString('base64url')}`;
  const secrets = {
    CLOUDFLARE_API_TOKEN: requireValue(externalValues, 'CLOUDFLARE_API_TOKEN'),
    CLOUDFLARE_ACCOUNT_ID: requireValue(externalValues, 'CLOUDFLARE_ACCOUNT_ID'),
    CONSOLE_SESSION_HMAC_SECRET: randomBytes(32).toString('base64url'),
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    CONSOLE_WEBHOOK_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: grantAuthority.keyId,
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: grantAuthority.signingSeedB64u,
    STRIPE_API_SK: requireValue(externalValues, 'STRIPE_API_SK'),
    STRIPE_WEBHOOK_SECRET: requireValue(externalValues, 'STRIPE_WEBHOOK_SECRET'),
  };
  if (input.target.emailDelivery.kind === 'resend') {
    secrets.RESEND_API_KEY = requireValue(externalValues, 'RESEND_API_KEY');
  }
  addOptionalMappedValues(secrets, externalValues, OPTIONAL_SECRET_INPUTS);
  assertOwnedSecretNames(input.lane, secrets);
  const variables = buildVariables(input, generationId, generatedAt, externalValues);
  const manifest = {
    schemaVersion: 1,
    authority: 'console',
    lane: input.lane.id,
    environment: input.target.environment,
    generationId,
    generatedAt,
    target: {
      origin: input.target.origin,
      siteOrigin: input.target.siteOrigin,
      workerName: input.target.workerName,
      database: input.target.database,
    },
    variables,
    secrets,
    publicHandoff: {
      ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON:
        grantAuthority.verifyingKeysJson,
    },
  };
  manifest.manifestSha256 = manifestSha256(manifest);
  const manifestPath = writeManifest(input.lane.id, manifest);
  printResult(input, { manifestPath, ...manifest });
}

function assertGithubCallback(target, values) {
  const callback = readValue(values, 'SEAMS_GITHUB_OAUTH_CALLBACK_URL');
  if (!callback) return;
  const expected = `${target.siteOrigin}/dashboard/login`;
  if (callback !== expected) {
    throw new Error(`SEAMS_GITHUB_OAUTH_CALLBACK_URL must be ${expected}`);
  }
}

function generateGrantAuthority(laneId) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const signingSeed = privateDer.subarray(privateDer.length - 32);
  const verifyingKey = publicDer.subarray(publicDer.length - 32);
  if (signingSeed.length !== 32 || verifyingKey.length !== 32) {
    throw new Error('generated Console grant authority has an invalid Ed25519 encoding');
  }
  const verifyingKeyHex = verifyingKey.toString('hex');
  const keyId = `console-${laneId}-grant-${verifyingKeyHex}`;
  return Object.freeze({
    keyId,
    signingSeedB64u: signingSeed.toString('base64url'),
    verifyingKeysJson: JSON.stringify({
      keys: [{ issuer_key_id: keyId, verifying_key_hex: verifyingKeyHex }],
    }),
  });
}

function buildVariables(input, generationId, generatedAt, externalValues) {
  const variables = {
    SEAMS_DEPLOYMENT_GENERATION_ID: generationId,
    SEAMS_DEPLOYMENT_GENERATED_AT: generatedAt,
    CONSOLE_ORIGIN: input.target.origin,
    CONSOLE_WORKER_NAME: input.target.workerName,
    CONSOLE_D1_DATABASE_NAME: input.target.database.name,
    CONSOLE_D1_DATABASE_ID: input.target.database.id,
  };
  if (input.target.emailDelivery.kind === 'resend') {
    variables.CONSOLE_EMAIL_FROM = input.target.emailDelivery.fromAddress;
  }
  if (RECOVERY_CERTIFICATE_LANES.has(input.lane.id)) {
    variables.TENANT_ROOT_RECOVERY_CERTIFICATES_JSON = requireValue(
      externalValues,
      'TENANT_ROOT_RECOVERY_CERTIFICATES_JSON',
    );
  }
  return variables;
}

function addOptionalMappedValues(destination, source, mappings) {
  for (const [destinationName, sourceName] of mappings) {
    const value = readValue(source, sourceName);
    if (value) destination[destinationName] = value;
  }
}

function assertOwnedSecretNames(lane, secrets) {
  const ownedNames = new Set([
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    ...consoleSecretNames(lane),
    ...OPTIONAL_SECRET_INPUTS.map(([name]) => name),
  ]);
  for (const name of Object.keys(secrets)) {
    if (!ownedNames.has(name)) throw new Error(`Console manifest cannot contain ${name}`);
  }
}

function writeManifest(laneId, manifest) {
  const directory = path.join(localSecretsRoot(), 'backups', 'console');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const outputPath = path.join(directory, `${laneId}-${manifest.generationId}.json`);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
  return outputPath;
}

function applyManifest(input) {
  const manifest = readPrivateJson(input.manifestFile);
  validateManifest(input, manifest);
  const repository = resolveRepository(input);
  createEnvironment(repository, input.target.environment);
  for (const [name, value] of Object.entries(manifest.variables)) {
    setGitHubVariable(repository, input.target.environment, name, value);
  }
  for (const [name, value] of Object.entries(manifest.secrets)) {
    setGitHubSecret(repository, input.target.environment, name, value);
  }
  printResult(input, {
    repository,
    environment: input.target.environment,
    generationId: manifest.generationId,
    variablesApplied: Object.keys(manifest.variables).length,
    secretsApplied: Object.keys(manifest.secrets).length,
    publicHandoff: manifest.publicHandoff,
  });
}

function validateManifest(input, manifest) {
  if (manifest.schemaVersion !== 1 || manifest.authority !== 'console') {
    throw new Error('manifest must be a Console deployment manifest with schemaVersion 1');
  }
  if (manifest.lane !== input.lane.id || manifest.environment !== input.target.environment) {
    throw new Error('manifest does not match the selected Console target');
  }
  if (manifest.manifestSha256 !== manifestSha256(manifest)) {
    throw new Error('Console deployment manifest SHA-256 does not match its contents');
  }
  assertGithubCallback(input.target, manifest.secrets);
  assertOwnedSecretNames(input.lane, manifest.secrets);
}

function updateExternalValues(input) {
  const values = readProtectedValues(input.valuesFile);
  assertGithubCallback(input.target, values);
  const secrets = {};
  const variables = {};
  addRequiredMappedValues(secrets, values, [
    ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'],
    ['STRIPE_API_SK', 'STRIPE_API_SK'],
    ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET'],
  ]);
  if (input.target.emailDelivery.kind === 'resend') {
    secrets.RESEND_API_KEY = requireValue(values, 'RESEND_API_KEY');
  }
  addOptionalMappedValues(secrets, values, OPTIONAL_SECRET_INPUTS);
  if (RECOVERY_CERTIFICATE_LANES.has(input.lane.id)) {
    variables.TENANT_ROOT_RECOVERY_CERTIFICATES_JSON = requireValue(
      values,
      'TENANT_ROOT_RECOVERY_CERTIFICATES_JSON',
    );
  }
  const repository = resolveRepository(input);
  const plan = {
    repository,
    environment: input.target.environment,
    variables,
    secretNames: Object.keys(secrets),
  };
  if (input.apply) {
    createEnvironment(repository, input.target.environment);
    for (const [name, value] of Object.entries(variables)) {
      setGitHubVariable(repository, input.target.environment, name, value);
    }
    for (const [name, value] of Object.entries(secrets)) {
      setGitHubSecret(repository, input.target.environment, name, value);
    }
  }
  printResult(input, { ...plan, applied: input.apply });
}

/* A shared Console signs a later lane's tenant-root grants with that lane's own key, the
   key its role Workers already trust, so no role Worker changes its trust (Refactor 261).
   The key comes from the lane's last Console manifest. It is copied only when its public key
   equals the key that the lane's control plane trusts today. No value is printed. */
function copyLaneGrantKey(input) {
  const manifest = readPrivateJson(input.manifestFile);
  if (manifest.schemaVersion !== 1 || manifest.authority !== 'console') {
    throw new Error('manifest must be a Console deployment manifest with schemaVersion 1');
  }
  if (manifest.lane !== input.lane.id) {
    throw new Error(`manifest belongs to ${manifest.lane}, not ${input.lane.id}`);
  }
  if (manifest.manifestSha256 !== manifestSha256(manifest)) {
    throw new Error('Console deployment manifest SHA-256 does not match its contents');
  }
  const keyId = requireValue(manifest.secrets, 'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID');
  const seed = requireValue(manifest.secrets, 'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED');
  const verifyingKeyHex = grantVerifyingKeyHex(seed);
  if (keyId !== `console-${input.lane.id}-grant-${verifyingKeyHex}`) {
    throw new Error('the manifest grant key id does not name its seed');
  }
  const repository = resolveRepository(input);
  const trustEnvironment = `${laneEnvironmentPrefix(input.lane.id)}-tenant-root-control-plane`;
  const trusted = readTrustedGrantKeys(repository, trustEnvironment);
  if (
    !trusted.some((key) => key.issuer_key_id === keyId && key.verifying_key_hex === verifyingKeyHex)
  ) {
    throw new Error(`${trustEnvironment} does not trust the manifest grant key`);
  }
  const [keyIdName, seedName] = consoleLaneGrantSecretNames(input.lane.id);
  if (input.apply) {
    setGitHubSecret(repository, input.target.environment, keyIdName, keyId);
    setGitHubSecret(repository, input.target.environment, seedName, seed);
  }
  printResult(input, {
    repository,
    environment: input.target.environment,
    secretNames: [keyIdName, seedName],
    grantKeyId: keyId,
    trustedBy: trustEnvironment,
    applied: input.apply,
  });
}

function grantVerifyingKeyHex(seedB64u) {
  const seed = Buffer.from(seedB64u, 'base64url');
  if (seed.length !== 32) throw new Error('the grant seed must be 32 bytes');
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki).subarray(12).toString('hex');
}

function laneEnvironmentPrefix(laneId) {
  const prefix = LANE_ENVIRONMENT_PREFIXES[laneId];
  if (!prefix) throw new Error(`no GitHub environments are known for ${laneId}`);
  return prefix;
}

function readTrustedGrantKeys(repository, environment) {
  const child = runGitHubCommand([
    'api',
    `repos/${repository}/environments/${environment}/variables/ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON`,
    '--jq',
    '.value',
  ]);
  if (child.status !== 0) throwGitHubError(child);
  const keys = JSON.parse(String(child.stdout)).keys;
  if (!Array.isArray(keys)) throw new Error(`${environment} has no grant verifying keys`);
  return keys;
}

function addRequiredMappedValues(destination, source, mappings) {
  for (const [destinationName, sourceName] of mappings) {
    destination[destinationName] = requireValue(source, sourceName);
  }
}

function readProtectedValues(filePath) {
  if (!existsSync(filePath))
    throw new Error(`Console deployment values file is missing: ${filePath}`);
  assertPrivateMode(filePath);
  return parseEnv(readFileSync(filePath, 'utf8'));
}

function readPrivateJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Console deployment manifest is missing: ${filePath}`);
  assertPrivateMode(filePath);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertPrivateMode(filePath) {
  const mode = statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`${filePath} must be owner-only (chmod 600)`);
}

function requireValue(values, name) {
  const value = readValue(values, name);
  if (!value) throw new Error(`${name} is required in the Console deployment values file`);
  return value;
}

function readValue(values, name) {
  return String(values[name] || '').trim();
}

function manifestSha256(manifest) {
  const digestInput = { ...manifest };
  delete digestInput.manifestSha256;
  return createHash('sha256').update(JSON.stringify(digestInput), 'utf8').digest('hex');
}

/* Without --repo, the GitHub repository of the current checkout receives the values. */
function resolveRepository(input) {
  if (input.repository) return input.repository;
  const child = runGitHubCommand([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  if (child.status !== 0) throwGitHubError(child);
  const repository = String(child.stdout).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`GitHub returned an invalid repository name: ${repository}`);
  }
  return repository;
}

function createEnvironment(repository, environment) {
  const endpoint = `repos/${repository}/environments/${environment}`;
  const existing = runGitHubCommand(['api', endpoint]);
  if (existing.status === 0) return;
  if (!`${existing.stdout}\n${existing.stderr}`.includes('HTTP 404')) {
    throwGitHubError(existing);
  }
  runGitHub(['api', '--method', 'PUT', endpoint]);
}

function setGitHubVariable(repository, environment, name, value) {
  runGitHub(['variable', 'set', name, '--env', environment, '--repo', repository, '--body', value]);
}

function setGitHubSecret(repository, environment, name, value) {
  runGitHub(['secret', 'set', name, '--env', environment, '--repo', repository], value);
}

function runGitHub(args, input) {
  const child = runGitHubCommand(args, input);
  if (child.status !== 0) throwGitHubError(child);
}

function runGitHubCommand(args, input) {
  return spawnSync(process.env.GITHUB_CLI_BIN || 'gh', args, {
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

function throwGitHubError(child) {
  throw new Error(String(child.stderr || child.stdout || 'GitHub CLI command failed').trim());
}

function printResult(input, result) {
  if (input.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.manifestPath) {
    process.stdout.write(`Prepared Console manifest: ${result.manifestPath}\n`);
    process.stdout.write(
      `Public Wallet-system handoff: ${result.publicHandoff.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printUsageAndExit() {
  process.stderr.write(`Usage:
  console-deployment-environment.mjs prepare --lane <lane> [--values-file <path>]
  console-deployment-environment.mjs apply --lane <lane> --manifest-file <path> [--repo <owner/repo>]
  console-deployment-environment.mjs update --lane <lane> [--values-file <path>] [--apply]
  console-deployment-environment.mjs lane-grant-key --lane <served lane> --manifest-file <path> [--apply]
`);
  process.exit(1);
}
