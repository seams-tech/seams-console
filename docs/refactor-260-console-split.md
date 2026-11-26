# Refactor 260 — Split the Seams Console into its own repository

Status: on 2026-11-21 this repository moved by a GitHub transfer. `purin-labs/monorepo` is
now `seams-tech/seams-console`, with the same id, history, environments and secrets. The
company site has its own repository, `purin-labs/purin-monorepo`. On 2026-11-26 the last
steps finished: Pantry has its own accounts, the old Console in the old Cloudflare account
is gone, and no Console lane holds Pantry code, tables or secrets. "Progress" lists the
results and the work that other owners keep.

## Progress

Done on 2026-11-26 (the session that took over Wave 2 and the placement question):

- Step 2, Wave 2 (done on 2026-11-22 by the Pantry session, with the owner's yes; Pantry
  Plan 93, "Follow-up results", Pantry `5ce9e228`). After Plan 95 step 5, that session
  checked that no outside caller used the old Seams stack after 2026-11-21 08:00 UTC. Then it
  deleted the stack in the old account: 15 Workers (`router-ab-*`, `seams-sdk-d1-*`,
  `seams-voice-intents-x-refresh`), 8 D1 databases (`seams-console`, `seams-signer-*` and
  the `router-ab` private databases among them), the `router-ab` and `outlayer1` buckets, a
  KV namespace and the custom domain `api.wallet.seams.sh`. Checked on 2026-11-26 with
  Wrangler in the old account (`ba924da3…`):
  - 11 Workers remain: `hadimar-api`, `hadimar-web`, `purin-shop` and eight `pantry*`
    Workers. Their service bindings name only `hadimar-web`, `pantry` and `pantry-*`
    Workers. The live `pantry` version (`04c6bf1f`) binds no Console.
  - D1 holds `pantry-global-apac`, `pantry-organisation-apac` and `hadimar`. R2 holds three
    `pantry-*` buckets and `hadimar-media`.
- Step 3, Pantry Plan 95 (Pantry `dev` `63081c36`): steps 1 to 5 are done. Step 5 released
  on 2026-11-21, its gate ran on production on 2026-11-22, and the two Console removal D1
  patches ran at 09:43 UTC that day. Step 6 (Stripe billing in Pantry) is open. It is Pantry
  work and needs nothing from this Console.
- Pantry secrets, confirmed by the owner: 28 secrets are deleted, 14 from `staging-console`
  and 14 from `production-console`. The 14 names: `SATYR_DEPLOYMENT_ID`,
  `SATYR_ACCOUNT_ASSERTION_{ISSUER,AUDIENCE}`,
  `SATYR_ACCOUNT_USER_ASSERTION_{KEY_ID,PUBLIC_JWK_JSON}`, `SATYR_GOOGLE_OIDC_CLIENT_ID`,
  `SATYR_SERVICE_ORIGIN`, `SATYR_PROVISION_{ENVIRONMENT,PLACEMENT_CELL_ID,TOKEN}` and
  `ACCOUNT_PROVISION_ASSERTION_{ISSUER,AUDIENCE,KEY_ID,PRIVATE_JWK_JSON}`. No code on `dev`
  or `main` read them, and the Console env script writes only the names that it owns.
  `production-testnet-console` had none, and no environment had a `PANTRY_*` name. GitHub
  cannot restore a deleted secret. The local values files
  `~/.seams/console/{staging-testnet,production-mainnet}-deployment.env` still hold the 14
  names each.
- Testnet deploy of `4ab30f88`. The Deriver B database (`8c379ecb…`) answered from `SIN` as
  primary in 8 of 8 probes on 2026-11-26 at 10:35 UTC. The other 8 role databases of the
  three lanes answered from `SIN` too. The `HKG` answer of 2026-11-21 03:11 UTC did not come
  back. The owner chose to deploy with the check unchanged. Production testnet run
  `45804331002` from `main` (`d2aada7f`) passed every job: the `SIN` check, every role
  Worker, the Console with migration 0119, the activation and the frontend. So every lane
  runs `4ab30f88` and `24ff0b61`.
- The 3 Pantry tables, confirmed by the owner. Before the change, the tables were empty on
  all three Console databases, and only their own indexes and triggers named them. Migration
  0120 (core 0023, `b6e25818`) drops `satyr_service_bindings`, `billing_jev_hours` and
  `billing_isolated_test_accounts`. Both migration folders apply to an empty SQLite database
  through the new migration. Staging run `45820274559` (`dev`), then, after `dev` was merged
  into `main` (`7dcc696d`), production mainnet run `45822123937` and production testnet run
  `45823905476` passed every job. Afterwards each of the three Console databases has
  `0120_drop_pantry_tables.sql` as its last migration, and no schema object names the three
  tables.

Done on 2026-11-21:

- Owner decision: transfer this repository instead of re-creating its 26 environments in a
  new one. The re-creation needed six secrets that exist only in GitHub and a new CLI release
  root; a transfer keeps both. `purin-labs/purin-monorepo` is public, so its two
  environments work on GitHub Free.
- The first `seams-tech/seams-console` (the mirror, id 1465065004) was fast-forwarded and
  then renamed to `seams-tech/seams-console-mirror`. It holds nothing that is not here.
- The transfer: `purin-labs/monorepo` became `seams-tech/seams-console` (id 1366871528).
  Before and after, a script compared names only: 26 environments, 232 environment secrets
  with the same update times, 299 variables, and the same protection rules. The OIDC subject
  prefix is now `repo:seams-tech@282445520/seams-console@1366871528`. The old URL redirects.
- Step 7: the Console trusts the new identity (`4d4fe753` on `dev`, `ebd885ea` on `main`).
  Every lane deploys the Console before it activates, so each next deploy carries the pin.
- Staging run `44769288323` from `seams-tech/seams-console` deployed every staging Worker
  with the moved secrets, activated the tenant with the new identity, and deployed the
  staging frontends. Every job passed.
- `purin-labs/purin-monorepo` (id 1465628780) starts from the same history. Its `dev` cut
  (`0924338f`) keeps only the company site, the grain field and navbar packages, the company
  deploy files and the drawing docs. Its validation run `44770604885` passed. Its
  `staging` and `production` environments hold `CF_PAGES_PROJECT_VITE`
  (`seams-site-staging` and `seams-site`, read from the public `pages.dev` hosts).
- `seams-wallet` names `seams-tech/seams-console` (`0647af091`).
- Step 6 (company site): the owner set the two company secrets in `purin-labs/purin-monorepo`.
  Its staging run `44852049624` and, after `dev` was merged into its `main` (`fc336bac`), its
  production run `44852198797` passed. Another session's site commit `b8019a57` (legal name
  Purin Heavy Industries) went there as `baf044a8`; runs `44853988209` and `44853990808`
  redeployed both sites from there.
- Step 8 (company paths): `86db58f4` deletes the company site, its deploy script, targets,
  workflow and test, `docs/drawing-style.md` and the company style doc here. The local Caddy
  files moved to `scripts/local-wallet/`; `localhost:4001/` now opens the Wallet site.
- Step 5, the host part (`4ab30f88`, with `66f0d504`): the Console API answers on
  `console.seams.sh` and `console.staging.seams.sh`; the Wallet site hosts keep `/console/*`
  for the CLI. The Platform Console build is gone; the Wallet Console serves invitations and
  keeps the support billing page at `/platform/billing` for support sessions only.
  `account.seams.sh` and `account.staging.seams.sh` are former hosts that redirect to
  `console.*`. The deploy token cannot change DNS, so the owner approved deleting their old
  Pages CNAME records, and this session deleted them in the dashboard. A Worker custom domain
  fails for some minutes after a Pages release; `66f0d504` retries.
  - Staging run `44853985506` passed every backend job and the activation through the new
    host; its frontend job then passed after the DNS fix, except one smoke check that ran
    before the new host certificate existed. The redirect works.
  - `main` got `dev` as merge `948bb5d6`. Production mainnet run `44858357190` passed,
    including the frontend smoke of the `account.seams.sh` redirect.
  - Production testnet run `44859557388` stopped at the placement check: the Deriver B
    database (`8c379ecb…`) is served in HKG, not SIN. The previous run (`44760463374`,
    2026-11-20 15:09 UTC) passed it. Nothing changed on Deriver B; Deriver A and the
    Signing Worker redeployed the same role code. The testnet Console keeps working: its
    CORS list already includes `console.seams.sh`.
- Cleanup, confirmed by the owner: the Pages projects `seams-platform-console` and
  `seams-platform-console-staging` are deleted; `CF_PAGES_PROJECT_PLATFORM_CONSOLE`,
  `COMPANY_CLOUDFLARE_*` and `CF_PAGES_PROJECT_VITE` are deleted from this repository's
  `staging` and `production` environments, and the env scripts no longer write them
  (`5e71da5b`); the repository `seams-tech/seams-console-mirror` is deleted.

- Step 5, the Pantry part (`24ff0b61`): Pantry Plan 95 steps 1–4 landed on Pantry `dev`
  (`3c85e71c`, `d192c4d2`, `310231fa`, `396278ef`), so nothing in Pantry calls this Console.
  The Console lost the `satyr` service, the `SatyrAccountPlatform` entrypoint and the
  Pantry-only ingress, provisioning, release and cron, the Pantry routes, meters, prices and
  isolated test pricing, the `PANTRY_*`, `SATYR_*` and `ACCOUNT_PROVISION_*` deploy values,
  the dashboard labels, and the Pantry-only tests. Migration 0119 (core 0022) deletes every
  Pantry row and keeps three Pantry-only tables (`satyr_service_bindings`,
  `billing_jev_hours`, `billing_isolated_test_accounts`), because the old Worker reads them
  between the migration and the Worker deploy. The frontend deployed before the backend,
  because the old dashboard expects two services. Staging (frontend `44870149735`, backend
  `44870254840`) and production mainnet (merge `d2aada7f`, frontend `44871173228`, backend
  `44871323708`) passed. The production testnet Console still runs the old code until its
  placement question is settled.

Done on 2026-11-20:

- The owner decisions under "Decision", and open questions 1 to 6.
- `seams-tech/seams-console` holds `dev` at `83023b1e` and `main` at `079aebc1`, with the
  same commit IDs as this repository. It is behind, because this repository moved on after
  the push. Step 6 brings it level.
- `seams-console` is public. Its `validate-repository.yml` run `44690621569` passed on
  `83023b1e`.
- Step 1: every Seams Wallet lane runs in `seamsadmin` (Refactor 200, "After the cutover").
- Step 4, the code part (`480f7209`): the company site carries no Seams Wallet code. Its
  bundle has no `@seams/wallet`, `@seams/voice*`, `apps/wallet-console` or Console module.
  Each page has the same height, sections and text as `purin.io`.
- Step 4, the deploy part: the company site deploys through its own workflow
  `Deploy / company site`, script `scripts/deploy-company-site.mjs` and targets
  `deployment/company-site/targets.json`. The Wallet frontend deploy has no company surface.
  `dev` was merged into `main` (`5a4e34d2`), because GitHub dispatches a workflow only from
  the default branch. Staging run `44726726958` passed: `staging.purin.io` now serves 10
  script chunks (420 KiB) with no Wallet code, against 23 (1,242 KiB, 3 with Wallet code)
  on `purin.io` before. Production run `44730350445` from `main` passed too: `purin.io` now
  serves the same 10 chunks, and its home page keeps its height, sections and text.

Remaining: nothing in this plan. Steps 1 to 8 are done; step 9 is void, because
`purin-labs/purin-monorepo` is a new repository. Other owners keep these items:

| Item                                            | Owner                                                           | Next step                                                   |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Stripe billing in Pantry                        | Pantry Plan 95                                                  | Its step 6, in the Pantry repository                        |
| One Console for both networks (open question 4) | Decided 2026-11-26; [Refactor 261](refactor-261-one-console.md) | Plan and build it; `test.console.seams.sh` stays until then |
| Speak-to-Sign demo Wallet                       | Moved to `seamsadmin` 2026-11-26; Refactor 200                  | A Seams project and key for `speak-to-sign-8kf.pages.dev`   |

The CHECK constraints that list `'satyr'` or a Pantry meter stay, because SQLite cannot
change them in place (migration 0119). No code writes those values.

## Decision

The owner decided on 2026-11-20:

- The Seams Wallet and its Console are one separate product. The Console lives on
  `console.seams.sh`.
- The Console code moves out of `purin-labs/monorepo` into the `seams-tech` GitHub
  organisation.
- Pantry and the Seams Wallet stop sharing organisation accounts. Before, one "shared
  account platform" in the Console held the organisations, teams and billing of both
  products (`docs/shared-account-platform/`).
- Two repositories (owner, 2026-11-20, in the separation session):
  `seams-tech/seams-console` holds the Wallet Console and the Wallet site.
  `purin-labs/purin-monorepo` holds the company site and, later, other Purin consoles and
  deployments. It is this repository after a rename.
- The split copies the whole repository into `seams-tech/seams-console`. It does not start
  from an empty repository.

Each fact below was read from the code on `dev` at `66e51b4c`, and from Pantry `main`.

## What blocks a clean split

1. **The company site imports Wallet app source.** Resolved in `480f7209`.
   `apps/seams-site/src/components/h2/WalletFigure.tsx` imported seven files from
   `apps/wallet-console` by relative path. Only the unused section `H2Security` rendered it,
   so the figure and the section were deleted.
2. **The company site deploys through Wallet files.** Its target (`origin`,
   `pagesProjectEnv`) is in `deployment/wallet-system/targets.json`, and its deploy code is
   the `company` branch of `scripts/deploy-surface.mjs`. The `company` build path also
   requires Wallet lane values (`buildFrontendEnvironment`).
3. **Pantry cannot run without the Console today.** Pantry's Worker `satyr-edge` has a
   Cloudflare service binding `ACCOUNT_PLATFORM` to the Console Worker, entrypoint
   `SatyrAccountPlatform` (`pantry/services/platform/wrangler.jsonc`). About 60 Pantry
   files check eligibility through it. Without the binding, Pantry access fails closed.
4. **A service binding cannot cross Cloudflare accounts.** Refactor 200 moves the Console
   to the `seamsadmin` account. Pantry's binding then still names the Console Worker in the
   old account. The public Console `fetch` returns 404 for `/account-platform/*`
   (`d1ConsoleStagingWorker.ts`, line 928), so no HTTPS path exists. Refactor 200 said that
   Pantry "calls the Seams account authority over HTTPS"; that statement is wrong.

## Inventory

### Moves to `seams-tech/seams-console`

| Path                                                                                              | Content                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/wallet-console`                                                                             | Wallet site, Wallet Console and Platform Console builds (368 files)                                                                                                                                                                 |
| `packages/console-server-ts`                                                                      | Console services (181 files)                                                                                                                                                                                                        |
| `packages/wallet-console-server-ts`                                                               | Console and Wallet runtime Workers, D1 migrations, scripts (398)                                                                                                                                                                    |
| `packages/console-shared-ts`, `packages/wallet-console-shared-ts`                                 | Shared types                                                                                                                                                                                                                        |
| `deployment/console`, `deployment/wallet-system`, `deployment/celld`, `deployment/host-redirects` | Targets, key scripts, runtime evidence                                                                                                                                                                                              |
| `scripts/` Wallet and Console files                                                               | `deploy-backend`, `deploy-surface`, `deployment-targets`, `deployment-smoke`, `console-deployment-environment`, `dispatch-deployment-workflow`, `tenant-*`, `migration-fingerprint`, `prepare-wallet-docs-source`, `local-wallet/*` |
| `.github/workflows/`                                                                              | All `deploy-*`, `release-seams-cli`, `sign-recovery-trust`, and the Wallet part of `validate-repository`                                                                                                                            |
| `tests/`                                                                                          | All suites except the few that read only the company site                                                                                                                                                                           |
| `voiceId/`, most of `docs/` (about 150 of 164 files)                                              | Wallet research, plans and evidence                                                                                                                                                                                                 |
| `AGENTS.md`                                                                                       | Custody vocabulary, testing policy, commands                                                                                                                                                                                        |

### Stays in `purin-labs/purin-monorepo` (this repository, renamed)

- `apps/seams-site`, the company site (357 files).
- `packages/site-navbar-ts` and `packages/grain-field-ts`. Both apps use them, so each
  repository gets a copy. Pantry already copied the grain field
  (`pantry/apps/portal/src/ui/README.md`).
- `docs/drawing-style.md`, `docs/styles/`, and a short `AGENTS.md` for the site.
- A small deploy script and one workflow for the company site only.

The local Caddy setup (`apps/seams-site/Caddyfile`, `run_caddy.sh`, which fills the ignored
`.wallet-public/`) serves the whole local Seams stack, not the company site. It moves to
`seams-console` in step 6; `pnpm site`, `tests/scripts/start-intended-services.mjs` and the
local Wallet pages use it.

### Deleted, not moved

- Done in `480f7209`: the Wallet demo in the company site (`src/flows/demo/*`,
  `DemoPasskeyColumn`, `context/frontendRuntime.tsx`, `src/config.ts`), and the Wallet
  figures with the unused sections that held them (`WalletFigure.tsx`, `H2Security`,
  `H2Start`, `H2Networks`, `H2Trusted`, `SplitKeyVisual`). No page rendered either. The
  demo was still in the bundle, because a module-level `React.lazy` import kept its chunk.
  The figures needed no copy, so the seven Wallet app files stay in `apps/wallet-console`
  only.
- `packages/wasm` (a symlink to a path that does not exist), the empty `packages/wallet/`
  and the stale `packages/README.md`.
- The Platform Console build, after the account split (see "End state").

## End state

### Hosts

| Surface                  | Now, after Refactor 200          | End state                                 |
| ------------------------ | -------------------------------- | ----------------------------------------- |
| Wallet site              | `seams.sh`                       | `seams.sh`                                |
| Console frontend         | `console.seams.sh`               | `console.seams.sh`                        |
| Console API              | `seams.sh/console/*`             | `console.seams.sh/console/*` (question 3) |
| Platform Console         | `account.seams.sh` (temporary)   | none                                      |
| `/account-platform/v1/*` | route on `seams.sh`, answers 404 | none                                      |
| Testnet Console backend  | `test.console.seams.sh`          | none: `console.seams.sh` (question 4)     |

Moving the Console API to `console.seams.sh` changes these values, all rendered in
`packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs`:

- `CONSOLE_SESSION_ISSUER` (`${consoleOrigin}/console`). Each Console user signs in again.
- `CONSOLE_STEP_UP_RP_ID`. Today it is the Wallet site host, `seams.sh`, and it works from
  `console.seams.sh` because that is a subdomain. Keep `seams.sh` as the RP ID, so the
  step-up passkeys stay valid.
- `CONSOLE_CORS_ORIGINS`, and the OAuth callback of Google, GitHub and Apple
  (`https://console.seams.sh/dashboard/login`; `assertGithubCallback` in
  `scripts/console-deployment-environment.mjs` checks it against `siteOrigin`).
- The Wallet site calls the Console for the pricing sign-in dialog
  (`embeddedSignIn.ts`), so it becomes a cross-origin caller.
- Old paths redirect through the former-host mechanism of Refactor 200
  (`formerWalletSiteOrigins`, `readHostRedirects`, `deployment/host-redirects/worker.mjs`).
  A path on the same host, `seams.sh/console/*`, needs a plain route to the Console Worker
  for a transition time, because the Wallet CLI names the Console URL.

### Accounts and billing

The Console keeps its own organisations, members, invitations and billing for the Wallet.
It drops the Pantry service:

- The `'satyr'` service in the catalog, `satyr_service_bindings`, the Satyr meters
  (`satyr.completed_turn.test`, `satyr.jev_input_tokens`), the route
  `POST /console/billing/satyr-paid-use/postpaid`, `satyrProvisioning*`, `satyrRelease`,
  the `SatyrAccountPlatform` entrypoint, and the `PANTRY_*`, `SATYR_*` and
  `ACCOUNT_PROVISION_*` values (14 of them in `scripts/deployment-targets.mjs`).
- The price rows of the two Satyr meters (Console migrations 0020 and 0021) and the Pantry
  rows of `billing_isolated_test_accounts`.
- The provisioning retry `resumeSatyrProvisioning` (every 60 seconds). After Pantry Plan 95
  step 4, Pantry answers it with 404, and an open Pantry provision fails. This is harmless
  until this removal.
- The Pantry labels in the dashboard (`serviceProjects.ts`, `ServiceProjectsSection.tsx`,
  `consoleBillingApi.ts`).
- The shared-account tests that test Pantry (`satyr-*.e2e.test.ts`, the published
  `.artifacts/shared-account-platform` Worker in `validate-repository.yml`).

The Console side is easy to cut: `readConsoleServiceEnvironment` already treats the Pantry
connection as optional, and the ingress answers 503 without it.

Pantry must own what the Console gave it:

- Organisation creation and onboarding, memberships and invitations. Pantry has
  `organisation`, `person`, `service_role_grant` and `project_member`. Its invitation
  table `account_service_invitation_role` keeps only the Pantry role; the Console keeps the
  invitation, its token and its expiry.
- Eligibility for each protected request.
- Plans, the Stripe customer, credit, reservations and usage. Pantry has
  `organisation.plan` (only the value `beta`), but no plan catalog, subscription or billing
  account.

Pantry signs users in itself already (Google OIDC in `control/oidc.ts`). Existing records
are test data (Refactor 200), so no account data moves.

Pantry Plan 95 (`docs/plan-95-pantry-own-accounts.md` on Pantry `dev`, `ab69e3f`, written
on 2026-11-20) is that work. It has six
steps, and it needs no Console change before its step 5. Steps 1 to 5 are done
(2026-11-22); step 6 is open. On 2026-11-20 the owner took its
five recommendations:

- Its steps 1 to 5 ship to the current `satyr-edge`, before the Pantry brand cutover of
  Pantry Plan 93. So this plan's step 5 does not wait for that cutover.
- Billing is postpaid metered use on Stripe only, in one Purin Stripe account. Pantry
  builds it in test mode, and paid use stays off in production until the live account
  exists.
- Turns stay unpriced, and invitations stay a link that the inviter copies.

## Order

1. **Refactor 200 first.** Finish the move to the `seamsadmin` Cloudflare account. Do not
   split the repository during the cutover: the deploy workflows and the GitHub
   environments must stay in one place until every lane runs in `seamsadmin`.
2. **Keep Pantry's authority alive in the old account.** After the cutover, Pantry's
   binding still reaches the old Console Worker `seams-sdk-d1-console` and its old D1
   database. Do not retire that Worker and its database in Refactor 200, Phase 7, until
   Pantry has its own accounts. The two products then already have separate account data.
   Pantry removed its staging environment on 2026-11-19 (Pantry `b343df1`), so
   `seams-sdk-d1-console-staging` and its database do not wait for Pantry.
   - The old Console Worker has nine service bindings, so more than the Console waits. Kept
     for Pantry (Refactor 200, Phase 7, Wave 2): `seams-sdk-d1-console`, D1 `seams-console`,
     the four mainnet Gateways and four Wallet Runtimes that it binds, D1
     `seams-signer-{sin,us,weur,oc}`, the Workers
     `router-ab-{mpc-router,deriver-a,deriver-b,signing-worker,tenant-root-control-plane}`,
     D1 `router-ab-*-private-sin` and R2 `router-ab-deriver-{a,b}-tenant-root-managed-backup`.
     Wave 1 deleted every other old Seams resource on 2026-11-20.
   - Done on 2026-11-22: the Pantry session deleted this Wave 2 list (see "Progress").
3. **Pantry builds its own accounts** (Pantry Plan 95). Then it removes the
   `ACCOUNT_PLATFORM` binding, and `seams-sdk-d1-console` and its database retire.
   - Done: Plan 95 steps 1 to 5 (2026-11-22). Its step 6, Stripe billing, does not touch
     this Console.
4. **Cut the couplings in this repository** (small changes on `dev`):
   - Done (`480f7209`): the company site imports no Wallet app file and no Seams Wallet
     package. The unused Wallet figures were deleted instead of copied.
   - Done: the company site has its own targets (`deployment/company-site/targets.json`),
     script (`scripts/deploy-company-site.mjs`, `pnpm deploy:company-site`) and workflow
     (`deploy-company-site.yml`). The workflow passes the `COMPANY_CLOUDFLARE_*` secrets of
     the `staging` and `production` environments as `CLOUDFLARE_API_TOKEN` and
     `CLOUDFLARE_ACCOUNT_ID`; the script names no account or zone. Its build reads only
     `VITE_SITE_ORIGIN`, `VITE_WALLET_SITE_ORIGIN` and `VITE_DOCS_ORIGIN`. The shared Pages
     helpers moved to `scripts/pages-deploy.mjs`; at the split, each repository takes a
     copy. `deploy-surface.mjs` lost its `company` surface, and the Wallet targets lost
     `site.pagesProjectEnv`. The Wallet targets keep `site.origin`: the Wallet site links
     and redirects `/company` to it.
   - Step 8 keeps the `staging` and `production` environments here, with only the company
     values: `COMPANY_CLOUDFLARE_*` and `CF_PAGES_PROJECT_VITE`.
   - This did not wait for the company site's move to the Purin Cloudflare account. The
     owner ordered the Seams Wallet move first, then Purin; the Purin move has no owner yet.
     `purin.io` can change accounts from 2026-11-27, and the Purin account has no API token
     or Workers Paid plan yet. With the script in place, that move is: create the Pages
     project in the Purin account, change the two secrets, deploy, then move the `purin.io`
     zone and the custom domains. Refactor 200 Phase 7 does not touch the company Pages
     project or `purin.io`. Since 2026-11-20, `purin.io` has Email Routing in the source
     account (`info@purin.io` forwards to the owner's mailbox); keep its MX and TXT records
     when the zone moves.
5. **Remove the Pantry service from the Console** (the list in "Accounts and billing").
   Remove the Platform Console build and the `account.*` hosts. Move the Console API to
   `console.seams.sh`.
6. **Move the deploys.** Superseded on 2026-11-21: the transfer moved the deploys with the
   repository (see "Progress"). The original order was:
   1. Fast-forward `dev` and `main` of `seams-tech/seams-console`. Push the Seams branches
      (`speak-to-sign`, `archive/voiceid-stt-bench`, `archive/voiceid-whisper`). The site
      branches stay here.
   2. Freeze the Seams paths here: from now on, commit Seams work only in `seams-console`.
      Before the freeze, the owners of worktrees of this repository (for example
      `codex/voiceid-native` and the `voiceid-*` branches) land or move their work.
   3. In `seams-console`, commit the new OIDC identity (step 7), the repository names in
      scripts, `README.md` and `AGENTS.md`, and the deletion of the company-site paths. The
      mirror stops with this commit.
   4. Create its GitHub environments (see "Repository mechanics"). Deploy staging from it,
      then production.
   5. Issue a new CLI release root (open question 6). Put its private key into the
      `release-signing` environment of `seams-console`, commit its public key to
      `seams-wallet/crates/seams-cli/trust/release-root.json`, and sign the next CLI release
      from `seams-console`.
   6. Make the new checkout beside `seams-wallet`, and copy the Seams agent memory to the
      memory folder of that checkout path.
7. **Change the GitHub OIDC identity.** `automationRoute.ts` accepts tokens only from
   `purin-labs/monorepo` (`DEPLOYMENT_REPOSITORY`, `DEPLOYMENT_SUBJECT_PREFIX`, and three
   workflow file names). The first deploy from the new repository must carry the new
   values, and it deploys the Console before it activates, as today.
8. **Delete the moved paths from `purin-labs/monorepo`** after production runs from the new
   repository. Then delete the Seams GitHub environments here, and keep only the ones that
   the company site deploy uses. A deleted environment loses its secrets, so the owner
   confirms the list first.
9. **Rename `purin-labs/monorepo` to `purin-labs/purin-monorepo`** last. A rename changes
   the OIDC `repository` claim and subject that `automationRoute.ts` pins, so it must come
   after the Seams deploys run from `seams-tech/seams-console`.

## Repository mechanics

Written for a copy into a new repository. Since the transfer of 2026-11-21, only "History"
and "Package names" still apply; the environments, secrets and release keys moved with the
repository.

- **History.** The mirror keeps every commit ID that the docs, the evidence files and the
  agent memory cite. `git filter-repo` would rewrite all of them. So each side cuts by
  deleting paths in a commit, not by rewriting history.
- **OIDC identity of the new repository.** Owner `seams-tech` has ID 282445520, and
  `seams-console` has ID 1465065004. With immutable subjects on, the prefix is
  `repo:seams-tech@282445520/seams-console@1465065004`; read it from the GitHub API before
  you write it into `automationRoute.ts`.
- **Package names.** Keep the `@seams-internal/*` scope (six names, about 740 uses).
- **Dependencies.** The Console consumes `@seams/wallet-server`, `@seams/wallet` and
  `@seams/voiceid` from npm by exact version, as today. Three relayer tests read
  `../seams-wallet`; the new checkout sits beside `seams-wallet` so the path still works.
- **GitHub environments.** Secrets cannot be copied between repositories. Create the 26
  environments again in `seams-tech/seams-console` with the existing commands
  (`wallet-system:deploy:env-apply`, `console:deploy:env-apply`, the `env-update` commands)
  from the manifests and values files in `~/.seams`. Six secrets have no local copy
  (three production `ROUTER_AB_*_AUTH_SECRET` values, `SEAMS_GITHUB_OAUTH_CLIENT_SECRET`,
  two `SPEAK_TO_SIGN_*` keys): recover or reissue them first. A seventh,
  `SEAMS_RELEASE_SIGNING_KEY`, also exists only in GitHub
  (`docs/recovery-trust-operations.md`). It is not recovered: step 6 issues a new release
  root (open question 6). The recovery signing key has
  a local copy (`~/.seams/recovery-signing-2026-10.env`).
- **Workflows.** `release-seams-cli.yml` and `sign-recovery-trust.yml` use the protected
  `release-signing` and `recovery-signing` environments. `seams-wallet` names the
  repository that holds them (`crates/seams-cli/trust/README.md`).
- **Other repositories.** Pantry CI checks out this repository to build the account
  Worker (`pantry/.github/workflows/pantry.yml`, lines 61 to 75). That step goes away with
  step 3. `seams-wallet` names `purin-labs/monorepo` in `README.md` and
  `crates/seams-cli/trust/README.md`; change both to `seams-tech/seams-console` in step 6.
  The `ink-drawing` skill names an old checkout path of the company site; point it at the
  `purin-monorepo` checkout in step 9.

## What Refactor 200 should not build

- No HTTPS account API for Pantry.
- No more work on the Platform Console or the `account.*` hosts than the migration needs.
- No rename of the `PANTRY_*` values, and no new Pantry meters.

## Open questions (all decided)

1. Decided (owner, 2026-11-20): `seams-console` is public, like this repository. Both
   organisations are on GitHub Free, and the
   [environments page](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
   says: "Users with GitHub Free plans can only configure environments for public
   repositories." The 26 deploy environments need that. While the repository was private,
   GitHub did not start the job of run `44690621569`: "recent account payments have failed
   or your spending limit needs to be increased". After the change, the rerun of that job
   started. Do not make `seams-console` private again without GitHub Team and working
   `seams-tech` Actions billing.
2. Decided: the Wallet site moves with the Console (`apps/wallet-console` builds both).
3. Decided (owner, 2026-11-20): the Console API moves to `console.seams.sh/console/*` in
   step 5. The step-up RP ID stays `seams.sh`, so the step-up passkeys stay valid.
4. Decided (owner, 2026-11-20): keep `test.console.seams.sh`, the separate Console Worker
   and database of the production testnet lane, until the split ends. Then decide whether
   one Console serves both networks.
   - Decided (owner, 2026-11-26): one Console serves both networks. The navbar toggle of
     the Console selects the network. Facts on 2026-11-26: the production frontend gives
     each network its own Console URL (`VITE_TESTNET_CONSOLE_BASE_URL` is
     `test.console.seams.sh`, set in `runConsoleOperation` of `scripts/deploy-surface.mjs`),
     so a person has separate accounts, organisations and billing on each network. Each
     lane's Gateways bind that lane's Console Worker as `WALLET_CONSOLE`
     (`consoleWorkerNameFor` in `render-d1-gateway-config.mjs`), and
     `expectedConsoleOrigin` in `scripts/deployment-targets.mjs` keeps the testnet origin.
     The Console data model already maps an environment to a network
     (`networkForConsoleEnvironmentId`). Both lanes run in `seamsadmin`, so the testnet
     Gateways can bind the mainnet Console Worker. The work is its own plan
     ([Refactor 261](refactor-261-one-console.md)): it decides the
     testnet tenant and the data of `seams-console-testnet-sin`, then retires
     `seams-sdk-d1-console-testnet` and `test.console.seams.sh`.
5. Decided (owner, 2026-11-20): Pantry keeps the old Console Worker `seams-sdk-d1-console`,
   and what it binds, in the old Cloudflare account until its own accounts exist (order
   step 2). The Refactor 200 cutover does not wait for Pantry.
6. Decided (owner, 2026-11-20): a new CLI release root with no bridge, issued in step 6.
   `SEAMS_RELEASE_SIGNING_KEY` exists only in the `release-signing` environment here, and
   the `seams` binary compiles in one release root
   (`seams-wallet/crates/seams-cli/trust/release-root.json`, format
   `seams_release_root_v1`, one key). So `seams-console` cannot sign with the current root.
   - The owner confirmed on 2026-11-20 that `@seams/wallet-cli` has no users yet. Its 1,843
     npm downloads from 2026-10-20 to 2026-11-18, and the 14 to 33 downloads of each GitHub
     release, are not outside users.
   - A new root would be safe for later users too. Each launcher version pins its own root and
     downloads only the binary of its own version
     (`seams-wallet/packages/seams-cli/bin/seams-wallet.mjs`, lines 47 to 65). An old
     launcher keeps working with its old release; a new launcher ships the new root.
   - Only `seams release-verify` in an old binary rejects a release that the new root
     signs.
   - Rejected: a `seams-wallet` change that trusts two roots, and keeping
     `release-seams-cli.yml` in this repository.
