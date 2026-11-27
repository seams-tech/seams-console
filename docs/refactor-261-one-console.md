# Refactor 261 — One Console for both networks

Status: plan, written on 2026-11-26. On 2026-11-27 the owner approved it with the seven
recommended answers in "Owner decisions". Steps 1 to 4 are built on `dev` (see "Progress").
Step 5 (staging) is next. Each push, production deploy, secret change and deletion still waits
for the owner's yes at its step.

## Progress

Built on 2026-11-27 (steps 1 to 4, on `dev`):

- Server (`walletLanes/`, `consoleWalletLanes.ts`, `d1ConsoleStagingWorker.ts`): the lane
  table from `SEAMS_CONSOLE_WALLET_LANES_JSON`, the `TestnetWalletLane` and
  `MainnetWalletLane` entrypoints, the lane choice by `X-Console-Environment-Id`, the guards on
  the Wallet environment service, both key adapters, the project environment resolver, the
  usage meter and the tenant-root lineage, and per-lane cron with SQL filters on the
  environment key. A Console without the list has one lane that serves every environment.
- Config: the mainnet Console target lists `walletLanes`; the testnet lane takes the mainnet
  Console, database `seams-console`, namespace `seams-production` and the tenant
  `proj_65be6ecba1ff48d6a7294f0db59964ca:dev`. Its Gateways and Wallet Runtimes bind
  `seams-sdk-d1-console` with the entrypoint `TestnetWalletLane`. The Console renders both
  lanes (later-lane values carry `TESTNET_LANE_`) and pricing for both NEAR classes.
  `customerReplica` and the custom-domain Console route are gone.
- Deploys: `deploy-live-demo.yml` has no Console job; `deploy-console-backend.yml` refuses a
  lane without its own Console and passes the `TESTNET_LANE_*` grant secrets;
  `deploy:backend` and `dispatch-deployment-workflow.mjs` refuse a Console build, migration or
  deploy for the testnet lane (its smoke stays). `console-deployment-environment.mjs
lane-grant-key --lane production-testnet --manifest-file <export>` copies the testnet grant
  key into `production-console` only after it proves that the key is the one that
  `production-testnet-tenant-root-control-plane` trusts; a dry run on 2026-11-27 passed and set
  nothing.
- Frontend: one Console base URL for both networks; the switch keeps the organisation and
  project and selects an environment of the new network; the environment menu shows only the
  selected network's environments when two networks exist.

Checks on 2026-11-27:

- Rendered configs: the staging Console differs from the live one only by
  `WALLET_BALANCE_NEAR_RPC_URL` (the old default) and the recovery certificates that CI
  supplies. The mainnet Console gains only the testnet lane values, the lane list and the
  second pricing class. Staging and mainnet Gateways keep their bindings.
- `pnpm check` and `pnpm test:scripts` (54) pass. The new unit test
  (`consoleWalletLanes.unit.test.ts`, 7) and the composed test
  (`console-wallet-lanes.e2e.test.ts`, the real Worker in Miniflare with both entrypoints)
  pass. A local staging Console build bundles both entrypoints.
- Failures that exist on `HEAD` without this work, not repaired here:
  `tenant-deployment-binding.e2e.test.ts` (503 expected, 502 received),
  `tenant-home-challenge.e2e.test.ts` and `wallet-relocation-directory.e2e.test.ts` (they read
  migrations from `../seams-wallet` paths that do not exist), and 17 unit tests that need the
  missing Playwright Chromium build 1187.

## Decision

The owner decided on 2026-11-26 (Refactor 260, open question 4): one Console on
`console.seams.sh` serves testnet and mainnet. The navbar toggle selects the network. When
this plan ends, the separate production testnet Console is retired: the Worker
`seams-sdk-d1-console-testnet`, the D1 database `seams-console-testnet-sin` (`8700ed4b…`) and
the host `test.console.seams.sh`.

Staging keeps its own Console. It has one network (testnet), and nothing in this plan changes
its behaviour.

## Result

A person signs in once on `console.seams.sh`. One organisation, one project and one billing
account serve both networks. The network of an environment decides which Wallet lane serves
it: `dev` and `staging` run on the production testnet lane, `prod` runs on the production
mainnet lane. The navbar toggle shows the environments of one network and points the
dashboard at that network's Gateway and hosted wallet.

One Console Worker (`seams-sdk-d1-console`) with one database (`seams-console`) holds the
accounts and serves both lanes. The testnet Gateways and Wallet Runtimes bind that Worker.

## Facts

Read on 2026-11-26 from `dev` at `1d7ff998`, from read-only Cloudflare API calls in the
`seamsadmin` account (`ea0d5435…`), and from the GitHub API. No resource was changed.

### Console resources

| Lane               | Worker                         | D1 database                             | API host                   | Namespace                  | Grant key id prefix                 |
| ------------------ | ------------------------------ | --------------------------------------- | -------------------------- | -------------------------- | ----------------------------------- |
| staging-testnet    | `seams-sdk-d1-console-staging` | `seams-console-staging-sin` `fbd3cfdc…` | `console.staging.seams.sh` | `seams-staging`            | `console-staging-testnet-grant-`    |
| production-testnet | `seams-sdk-d1-console-testnet` | `seams-console-testnet-sin` `8700ed4b…` | `test.console.seams.sh`    | `seams-production-testnet` | `console-production-testnet-grant-` |
| production-mainnet | `seams-sdk-d1-console`         | `seams-console` `f6e040fb…`             | `console.seams.sh`         | `seams-production`         | `console-production-mainnet-grant-` |

The live Worker bindings match `deployment/console/targets.json` and the rendered config. The
GitHub variables `CONSOLE_D1_DATABASE_ID`, `CONSOLE_D1_DATABASE_NAME` and `CONSOLE_ORIGIN` of
`production-console` and `production-testnet-console` are stale: they name the September
databases `b928549b…` and `204147dd…`, and mainnet names the host `wallet.seams.sh`. No
workflow reads them;
`scripts/console-deployment-environment.mjs` writes them. The targets files are the source of
the live ids.

### Data in the two production Console databases

The testnet database (`8700ed4b…`) holds only the tenant of the testnet activation of
2026-11-20 and its test wallets:

- 1 organisation "Seams" (`org_d9zox3del842`, free plan, 1 owner, no billing ledger rows).
- 1 project "Seams Wallet" (`proj_a5abea28…`). Its `dev` environment is `ACTIVE`; `staging`
  and `prod` are `DISABLED`.
- 1 API key, 1 policy, 1 tenant-root creation grant for `dev` (testnet grant key), 4 deployment
  bindings, 1 active binding (`production-testnet`, activated 2026-11-26 13:02 UTC).
- 6 wallet homes (1 established in APAC on 2026-11-21, 5 reserved), 10 wallet routes, 1 wallet
  index row. These are test wallets.

The mainnet database (`f6e040fb…`) holds two organisations, both on the free plan:

- "Seams" (`org_ri0bh5kt0er2`), created by the cutover on 2026-11-20. Its project "Seams
  Wallet" (`proj_e8f2db07…`) has `dev` `ACTIVE`, and that `dev` environment has an `ACTIVE`
  tenant root on the **mainnet** lane (grant of 2026-11-20). The mainnet lane served this
  environment until 2026-11-21.
- "Seams Wallets II" (`org_bqzydcm176nt`), created on 2026-11-21. Its project "Seams Wallets"
  (`proj_65be6ecb…`) has `dev`, `staging` and `prod` `ACTIVE`. The mainnet lane serves its
  `prod` environment (`deployment/wallet-system/targets.json`, active binding of 2026-11-26
  12:50 UTC).

### The Console Worker serves one lane

`d1ConsoleStagingWorker.ts` reads its lane from the Worker environment, once per request:

- `SEAMS_TENANT_STORAGE_NAMESPACE`, `SEAMS_TENANT_DEPLOYMENT_LANE` and
  `SEAMS_WALLET_SERVICE_DEPLOYMENT_ID`.
- One lane's Wallet bindings: `WALLET_RUNTIME` (wallet control: router, control plane,
  derivers), `WALLET_GATEWAY_{US,WEUR,APAC,OC}` and `WALLET_RUNTIME_{US,WEUR,APAC,OC}`.
- One lane's `SEAMS_WALLET_HOME_CATALOG_JSON` (the four signer databases),
  `TENANT_DEPLOYMENT_SURFACES_JSON` (Gateway, hosted wallet, RP ID), and sponsored-execution
  pricing for one network class (`TESTNET` or `MAINNET`).
- One grant authority key (`TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID` and `_SEED`) and one
  set of recovery certificates (`TENANT_ROOT_RECOVERY_CERTIFICATES_JSON`).

The Gateways and Wallet Runtimes call the Console through the service binding
`WALLET_CONSOLE` (`render-d1-gateway-config.mjs`, lines 380 and 441). A call names no lane; the
Console answers for its own lane. The automation route accepts a cutover only for the Worker's
own lane (`automationRoute.ts`, lines 242–243).

What the database already allows (migration paths under
`packages/wallet-console-server-ts/migrations/d1-console`):

- `namespace` leads the primary key of every account, wallet-home and tenant-root table
  (`organizations`, `projects`, `environments`, memberships, invitations, API keys, billing,
  session revocations, `tenant_root_*`, `wallet_homes` and the placement tables). So the
  accounts of both networks can share one database only if both lanes use one namespace.
- The lane tables are keyed by lane: `tenant_deployment_bindings` (PK `deployment_lane,
revision`), `active_tenant_deployment_bindings` (PK `deployment_lane`, migration 0046) and
  `regional_production_admission_pushes` (PK `deployment_lane`, migration 0102). Two lanes can
  have their active binding in one database today.
- `platform_service_instances` allows one Wallet service instance per project (UNIQUE
  `namespace, project_id, service_id`, migration 0093), so a project has one
  `deployment_id` (the service deployment id). The project environment resolver that the
  Gateways call filters by it (`accountPlatform/admission.ts`, lines 6–16).
- No table holds a network. The network follows from the environment key:
  `modeForEnvironment` (`tenantDeployment/productionReadiness.ts`, lines 89–98) maps `dev` to
  `development_testnet_v1` (testnet) and `prod` to `production_mainnet_v1` (mainnet), and
  refuses `staging`. The shared tenant-deployment types tie `:dev` to testnet and `:prod` to
  mainnet in the same way.
- Wallet home rows have no lane column. They store the region, account and database of one
  signer database, and every signer database belongs to one lane's home catalog.
- A signer database does not belong to one namespace. Its rows and its resource challenges
  are keyed by namespace (`deployment_resource_challenges` PK `namespace, challenge_id`,
  wallet-server migration 0040), and the role Workers read no namespace. So the testnet signer
  databases can take the namespace `seams-production` beside the old rows.

Where the Worker calls its one lane (`d1ConsoleStagingWorker.ts`):

- Wallet control through `WALLET_RUNTIME`: tenant-root creation (line 569), restore (559),
  state (603), custody (618–620), refresh (659) and the cron refresh (1074–1152). Each call
  has the tenant-root identity (organisation, project, environment), not a lane.
- `executeSignedDelegate` and `getRelayerAccount` (sponsored NEAR calls, line 514). The
  principal's environment is known at the call site (`routerApiSignedDelegate.ts`).
- The regional bindings: readiness, regional admission, resource verification, wallet
  identities, relocation admission, advance and resumption, and the production admission sync.
- The cron jobs: account provisioning and free-plan resumption (namespace and service
  deployment id), billing finalization and email dispatch (namespace), and three lane jobs:
  relocation resumption, production admission sync, tenant-root refresh resumption. The lane
  jobs read namespace-wide tables and call the one lane's bindings.

Two faults that exist today and that this plan fixes on the way:

- The balance reader falls back to the testnet NEAR RPC host (`wallets/balances.ts`, lines
  20–22) and the Worker passes no RPC URL. So the mainnet Console reads mainnet NEAR balances
  from testnet. (Tempo and Arc are testnet chains on every lane: the gas onboarding policy is
  fixed to testnet, `gasSponsorship/onboarding.ts`. Their hosts are right.)
- Placement passes the **lane** where the usage SQL expects the **service deployment id**
  (`walletPlacement/d1.ts`, line 406, against `billing/usage.ts`, lines 161–165), and the
  signature statements use one value for both columns. The two are equal on every lane today,
  so nothing fails. Only `prod` environments write these rows, and `prod` runs on mainnet,
  whose lane id is the service deployment id. So the lane table refuses a lane that serves
  `prod` under another id, and the billing statements stay as they are.

### Trust per lane

- Each lane's role Workers trust exactly one Console grant key
  (`ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON`, a public GitHub
  variable in the six role environments of each lane). Testnet trusts only
  `console-production-testnet-grant-b44b0026…`; mainnet trusts only
  `console-production-mainnet-grant-752746a3…`.
- Recovery trust is configured on staging and production mainnet only
  (`docs/recovery-trust-operations.md`, lines 85–88). Production testnet has no trust bundle,
  snapshot or recovery certificates, by design.
- The recovery root is one key for all lanes (`seams-recovery-root-production-2026-10`). The
  CLI fetches it from `{console}/console/tenant-root/security/recovery-trust` with no lane or
  identity in the request, and saves it per Console origin and recovery identity
  (`seams-wallet/crates/seams-cli/src/deployment.rs`, lines 32–53 and 143–171).

### Frontend

- `apps/wallet-console/src/core/runtime.tsx` gives each network its own `consoleBaseUrl`,
  `relayerUrl` (Gateway) and `walletOrigin`. `runConsoleOperation` in
  `scripts/deploy-surface.mjs` (lines 124–129) sets `VITE_TESTNET_CONSOLE_BASE_URL` to
  `https://test.console.seams.sh` for production. `buildFrontendEnvironment` (line 446) sets
  the Wallet site's `*_CONSOLE_BASE_URL` from `lane.console.origin`.
- Session cookies are host-only. The network switch (`page.tsx`, lines 193–239) reads the other
  network's session ahead of time, clears the saved organisation and project, and remounts the
  dashboard, because "each network has its own account store".
- `networkForConsoleEnvironmentId` (`environmentNetwork.ts`) maps `prod` to mainnet and `dev`
  and `staging` to testnet. The API keys page already uses it.
- The dashboard's CLI commands embed `--console-url <consoleBaseUrl>`
  (`DerivationRootSecurityWorkspace.tsx`, `recoveryKeySetupCommand.ts`).

### Hosts, CORS, discovery and the CLI

- No discovery document names a Console URL. The Gateway's
  `/.well-known/seams-tenant-deployment.json` names the application, hosted wallet and Gateway
  origins only.
- The Console CORS list is `https://seams.sh,https://console.seams.sh` on both production lanes.
  No Gateway CORS list names a Console host.
- The Wallet CLI names no Console host. `--console-url` is a required option.
- `GET /console/tenant-root/security/cli-info` returns `CONSOLE_STEP_UP_ORIGIN` as the
  dashboard URL: `https://seams.sh` on the testnet Console, `https://console.seams.sh` on
  mainnet.

### Deploys

- `deploy-live-demo.yml` (production testnet) runs `deploy_console` for the lane
  `production-testnet`, then the role Workers, Runtimes and Gateways, then the cutover
  (`pnpm tenant:cutover --lane production-testnet`, which posts to `lane.console.origin`), then
  the production frontend.
- `deploy-production-mainnet-backend.yml` deploys the mainnet Console before it activates.
- `scripts/deployment-targets.mjs` requires three Console lanes (`CONSOLE_LANE_IDS`), unique
  Console databases across lanes (lines 999 and 1029), and `expectedConsoleOrigin` pins
  `https://test.console.seams.sh` for production testnet (lines 684–690).
- The GitHub environment `production-testnet-console` holds 13 secrets. The September export
  `~/.seams/old/console-exports-20260913/production-testnet-console-…nj3XB8tBnjot9JLs.json`
  holds its grant key id and seed. The public key of that seed equals the live testnet
  verifying key (checked on 2026-11-26 without printing the seed), and the GitHub secret dates
  match that generation.

### A design that ran before

From 2026-10-24 to 2026-11-07 the GetSignal lane (`bf793428`, removed in `6a5352e3`) was a
second testnet Wallet lane served from the mainnet Console database. Its Console Worker was a
"customer replica": it bound the mainnet Console D1, used the mainnet namespace
`seams-production` and the mainnet service deployment id `production-mainnet`, ran no cron,
and owned its own host. Its tenant was a `dev` environment in the mainnet Console. The
`customerReplica` branches of `buildConsoleConfig` are still in the code, unused.

## Design

### Recommended: one Console Worker with a lane table

The mainnet Console Worker `seams-sdk-d1-console` serves both production lanes. The testnet
Worker, database and host retire.

1. **Lanes are data in the Worker.** The rendered config lists the lanes that the Console
   serves. Each lane has its id, network, environment keys, Wallet bindings, home catalog,
   deployment surfaces, sponsored pricing class, grant authority key and recovery
   certificates. The production Console has two lanes:

   | Lane                 | Network | Environment keys | Grant key                            | Recovery certificates |
   | -------------------- | ------- | ---------------- | ------------------------------------ | --------------------- |
   | `production-mainnet` | mainnet | `prod`           | `console-production-mainnet-grant-…` | yes                   |
   | `production-testnet` | testnet | `dev`, `staging` | `console-production-testnet-grant-…` | none (as today)       |

   The staging Console has one lane, `staging-testnet`, with all three keys, so staging keeps
   its behaviour. The account values stay single: one namespace (`seams-production`), one
   service deployment id (`production-mainnet`), one session plane, one set of email, Stripe
   and OAuth values. The service deployment id is a stored identifier
   (`wallet_service_bindings.deployment_id`); it names the Console's Wallet service, not a
   network, and it is not renamed.

2. **Each request selects one lane, and the lane only sees its own environments.**
   - A Gateway or Wallet Runtime call: the lane is fixed by the binding. The Console exports
     one named entrypoint per lane, and each lane's Gateways and Runtimes bind
     `WALLET_CONSOLE` to their lane's entrypoint. A caller cannot name another lane.
   - A tenant activation from GitHub: the lane is `deploymentLane` in the body, and the OIDC
     scope check stays per lane (`automationRoute.ts`).
   - A dashboard request: the lane serves the environment that the request names in
     `X-Console-Environment-Id`. The dashboard's Wallet pages already send that header
     (`products/wallet/consoleWalletHttp.ts`), and the Wallet claims read it
     (`router/walletConsoleAuth.ts`), so the lane always matches the environment. A request
     without it selects the Console's first lane (mainnet on production, the only lane on
     staging), so the CLI and the account pages keep working.
   - In a lane's composition, the Wallet environment resolver returns only the environments
     whose key belongs to the lane. A `prod` environment is not found through the testnet lane,
     and a `dev` environment is not found through the mainnet lane. This is the one guard that
     keeps a tenant root or a wallet on the lane of its network.
   - Account routes (organisations, members, invitations, billing, sessions) touch no Wallet
     lane and serve both networks.
3. **Cron runs account jobs once and lane jobs per lane.** Each lane job reads only rows of
   its own lane: tenant-root operations whose environment belongs to the lane, relocations
   whose homes are in the lane's catalog, and the lane's production admission.
4. **The frontend keeps one session.** `console.seams.sh` is the Console base URL of both
   networks. The network switch keeps the organisation and project, shows the environments of
   the selected network, and points the Gateway and hosted wallet at that network. The
   per-network session prefetch and the remount go away. The API keys page and the tenant
   deployment page keep their per-network Gateway reads.
5. **The testnet lane joins the mainnet account store.** Its tenant namespace becomes
   `seams-production`, its Console database becomes `seams-console`, and its tenant becomes an
   environment of a mainnet-database project (owner decision 2). Its Gateways keep their
   hosts, signer databases and role Workers.

What does not change: the Gateway and Console CORS lists, discovery
(`/.well-known/seams-tenant-deployment.json`), the CLI (`--console-url` stays an option, and
the dashboard prints `https://console.seams.sh` for both networks), the recovery root, and the
role Workers' trust settings (each lane keeps its grant key).

Limit: the CLI sends no network. Its tenant-root requests select the mainnet lane. Production
testnet has no recovery certificates today, so no testnet CLI flow is lost.

### Rejected: keep a hostless testnet Console Worker on the shared database

This is the GetSignal "customer replica": the testnet Console Worker stays, binds
`seams-console` with namespace `seams-production`, and serves only the testnet Gateways. It
needs less Worker code, but:

- The dashboard still needs testnet Wallet calls (tenant roots, wallet balances, deployment
  readiness). The mainnet Console must forward those requests to the replica, so the lane
  selection of point 2 is needed anyway.
- The lane jobs of both Workers read the same namespace-wide tables, so the per-lane filters of
  point 3 are needed anyway. GetSignal ran its replica with no cron, so its tenant roots had no
  scheduled refresh.
- Two Workers, two deploy jobs and two secret sets remain, and the testnet Console Worker is not
  retired, against the decision.

## Steps

Each step is a commit (or a few) on `dev`. Steps 1 to 4 change no production resource.

1. **Server: the lane table.** Parse the lanes from the Worker environment into one typed
   value. Build one composition per request for the selected lane. Add the named entrypoints,
   the lane choice by environment, the per-lane environment filter, the per-lane cron filters,
   the multi-lane automation route, per-lane NEAR balance hosts, and the check that the `prod`
   lane is the service deployment id. A single-lane Console behaves as today.
2. **Config and targets.** `buildConsoleConfig` renders all lanes of a Console. The Gateway and
   Runtime configs bind `WALLET_CONSOLE` to the Console of their account authority with their
   lane's entrypoint (no more `consoleWorkerNameFor` from the Gateway name).
   `deployment/console/targets.json` loses the `production-testnet` lane; the production
   testnet backend lane names the mainnet Console. The testnet tenant block in
   `deployment/wallet-system/targets.json` gets the new namespace, organisation, project and
   environment. `deployment-targets.mjs` drops `expectedConsoleOrigin`'s testnet host and
   allows two backend lanes to share one Console database.
3. **Deploy scripts and workflows.** `deploy-live-demo.yml` stops deploying a Console; its
   cutover posts to `console.seams.sh`. `deploy-console-backend.yml` and
   `console-deployment-environment.mjs` carry the testnet lane's grant key as a second secret
   pair in `production-console`. `dispatch-deployment-workflow.mjs` and the script tests
   follow.
4. **Frontend.** One Console base URL; the switch of point 4. `deploy-surface.mjs` stops
   setting a per-network Console URL.
5. **Staging.** Deploy `dev` to staging (one lane through the new code). Run the staging
   activation and the Console smoke, and sign in on `console.staging.seams.sh`.
6. **Production mainnet.** Set the testnet grant key secret pair in `production-console`. Merge
   `dev` into `main`. Run the mainnet full stack. The Console now has both lanes; the testnet
   Gateways still bind the old testnet Console, so the testnet lane runs on unchanged.
7. **Production testnet.** Run `deploy-live-demo.yml`: the role Workers (unchanged trust), then
   the Wallet Runtimes and Gateways bound to the mainnet Console, then the cutover of the new
   testnet tenant on `console.seams.sh`, then the frontend. The testnet Wallet answers
   `tenant_deployment_unavailable` from the Gateway deploy until the cutover ends (some
   minutes).
8. **Verify.** Sign in once on `console.seams.sh`; switch networks without a second sign-in; on
   testnet, register a wallet on the Wallet site and see it in the `dev` environment; on
   mainnet, see the `prod` environment and its wallets unchanged; check that the testnet
   Gateways reach the mainnet Console (live bindings) and that nothing calls
   `test.console.seams.sh` (Worker analytics).
9. **Retire** (owner decision 6). Export `seams-console-testnet-sin` to `~/.seams/old/`, then
   delete the Worker `seams-sdk-d1-console-testnet` with its custom domain
   `test.console.seams.sh`, the D1 database, and the GitHub environment
   `production-testnet-console`.

### Rollback

- Steps 1 to 5 roll back with a revert on `dev` and a staging redeploy.
- Step 6 rolls back by redeploying the previous Console version; the testnet lane does not use
  the new code yet.
- Step 7 rolls back by deploying the previous testnet Runtimes and Gateways (bound to
  `seams-sdk-d1-console-testnet`) and the previous frontend. The old testnet Console and its
  database keep the old tenant and its active binding until step 9, so a rollback needs no data
  repair.
- Step 9 cannot be undone. A deleted D1 database, Worker version history and GitHub secrets do
  not come back. The export keeps the data; the testnet grant seed is in
  `~/.seams/old/console-exports-20260913/` (its public key matches the live testnet key, checked
  on 2026-11-26).

## Owner decisions

Decided on 2026-11-27: the owner took the recommended answer of each question ("Approve all 7",
asked in the parent session).

1. **Design.** One Console Worker with a lane table (recommended), or a hostless testnet replica
   on the shared database.
2. **Testnet tenant.** Recommended: the `dev` environment of "Seams Wallets II" / "Seams
   Wallets" (`proj_65be6ecba1ff48d6a7294f0db59964ca:dev`, namespace `seams-production`), the
   project whose `prod` environment the mainnet lane serves. Then one project shows both
   networks. Its `dev` environment is `ACTIVE` and has no tenant root yet; the cutover creates
   one on the testnet lane.
3. **Testnet Console data.** Recommended: keep nothing. Export the database, then delete it in
   step 9. The organisation "Seams" (`org_d9zox3del842`), its API key and its test wallets are
   not moved. The testnet signer databases keep the rows of the old tenant under the namespace
   `seams-production-testnet`; nothing reads them after the cutover.
4. **The mainnet organisation "Seams"** (`org_ri0bh5kt0er2`). Its `dev` environment has an
   `ACTIVE` tenant root on the mainnet lane from the cutover of 2026-11-20. With this plan,
   `dev` belongs to testnet, so the Console looks for that root on the testnet lane and does not
   find it. Recommended: delete the organisation before step 7, through the dashboard if its
   deletion guard allows it, otherwise by a D1 patch after an export. Alternative: keep it; its `dev` environment then shows no tenant
   root.
5. **Grant keys.** Recommended: one grant key per lane. The Console signs testnet grants with the
   existing testnet key, so no role Worker changes its trust. This needs the testnet seed as a
   second secret pair in `production-console`, set from the September export by a script that
   prints no value. Alternative: one key for the Console; the six testnet role environments then
   trust the mainnet key, and the testnet role Workers redeploy with the new variable.
6. **Retirement.** Recommended: retire in step 9 after one day with no request to
   `test.console.seams.sh`, with no redirect host, because an API host never redirects and only
   the old frontend called it.
7. **Testnet downtime in step 7.** Some minutes of `tenant_deployment_unavailable` on the
   testnet Wallet. Recommended: accept it, because the testnet lane serves test wallets only.

Each production deploy, the push of `dev` and `main`, the GitHub secret change and every
deletion in step 9 waits for the owner's yes at that step.
