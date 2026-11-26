# Refactor 200 — Cloudflare account split and host move

Create fresh Seams Wallet infrastructure in the Cloudflare account owned by
`seamsadmin@gmail.com`. Create the Purin infrastructure in the account owned by
`purinindustries@gmail.com`. Move traffic from the source account `N6378056@gmail.com's Account`
(`ba924da36f2ffc3839e8d323000b66b4`).
Remove the source resources after verification to isolate future Cloudflare billing.

Existing wallets, organisations, projects, sessions, signing material, and application records
are test data and are discarded (owner, 2026-11-20). Create empty destination storage. The
deployment keys stay (owner, 2026-11-20), so the recovery certificates stay valid. The public
host names change during the move (see "Public hosts"), so build the
destination resources with the new host names from the start. Use a planned maintenance window
for the account and domain cutover.

Status: cut over on 2026-11-20. Every Seams Wallet lane runs in the `seamsadmin@gmail.com`
account (`ea0d54352cf9d80e962154980504b428`), and the `seams.sh` zone and registration are
there. The company site serves on `purin.io` from the source account. What remains is in
"After the cutover".

### Decisions of 2026-11-20

- `seamsadmin@gmail.com` holds every Seams Wallet resource: Workers, D1, Durable Objects, R2,
  the Wallet and Platform Consoles, the Gateways, the Wallet site, the docs and the `seams.sh`
  zone.
- `purinindustries@gmail.com` holds the Purin resources: the company site, Pantry and the
  `purin.io` zone.
- The Platform Console stays with the Console Worker in the Seams account, on a `seams.sh` host.
  Cloudflare Worker routes cannot cross accounts.
- Pantry moves to the Purin account with `purin.io` host names. Pantry plans its own move in
  its repository. Pantry reaches the Console through a Cloudflare service binding
  (`ACCOUNT_PLATFORM` to `seams-sdk-d1-console*`), and a binding cannot cross accounts. So
  Pantry keeps using the old production Console Worker `seams-sdk-d1-console` and its D1
  database in the source account until it has its own accounts
  ([Refactor 260](refactor-260-console-split.md)). Do not retire them before that. Pantry
  removed its staging environment on 2026-11-19, so `seams-sdk-d1-console-staging` can retire.
- `info@purin.io` replaces `sales@seams.sh` and `confirm@seams.sh`.
- No host is renamed in the source account first.
- Decided later on 2026-11-20: the Seams Wallet and its Console become one separate product
  on `console.seams.sh`, and the Console code moves out of this repository to the
  `seams-tech` GitHub organisation. Pantry and the Wallet stop sharing organisation accounts.
  That split is [Refactor 260](refactor-260-console-split.md). Until it lands, this migration keeps the Platform Console
  and the `/account-platform/v1/*` routes, and the `account.*` hosts are temporary.
- The current deployment keys stay. Only the Cloudflare account values, the storage IDs and
  the host names change.
- The r150 benchmarks and the ML-DSA disposable fleet retire: they are not recreated. Their
  evidence files stay.
- `tatchi` (w3a) and `watchbook` retire with all their Workers and storage.
- `hadimar`, `outlayer`, `underclerk` and `POLICY_KV` stay in the source account.
- Delete a retired resource only after the owner confirms the list.

## Scope and completion conditions

- Move all three lanes: `staging-testnet`, `production-testnet`, and `production-mainnet`.
- Recreate all four wallet regions: `US`, `WEUR`, `APAC`, and `OC`.
- Include Console, Gateways, Wallet Runtime, Router, Deriver A, Deriver B, and SigningWorker.
- Include the tenant-root control plane, Durable Objects, D1, R2, Pages, DNS, certificates, secrets, and scheduled work.
- Find all deployed benchmarks, diagnostic Workers, and resources absent from checked-in targets. Retire them; do not recreate them.
- Recreate any additional Seams service found during the live inventory.
- Move the company site (`seams-site`) and the `purin.io` zone to the Purin account.
- Move Pantry's Cloudflare resources to the Purin account through a Pantry plan.
- Preserve unrelated workloads and their credentials in the source account.

The migration is complete when every retained Seams resource belongs to the destination account.
Every regional product flow must pass there.
The source account must have no active Seams traffic, scheduled work, storage, or Seams-only subscriptions.
Record residual charges from earlier usage separately from new usage.

Cloudflare account ownership uses account IDs.
Record both IDs before execution and require the destination ID for every destination command.
Changing a login email or inviting another administrator does not accomplish this resource migration.
The source login is `n6378056@gmail.com` (checked with `wrangler whoami` on 2026-11-20).

## Execution checklist

Owner steps need the owner's accounts, money or credentials. Claude does the other steps.

1. Done: the backend workflows run `account-bootstrap` before the role Workers and accept
   `prepare_only`; a Pages deploy creates a missing project (`d4562c0b`). The company site can
   use its own `COMPANY_CLOUDFLARE_*` credentials (`b65b871c`). The env-update command also
   updates the control-plane environment (`49d834d2`).
2. Done: `wrangler` on the deployment Mac is signed in as `seamsadmin@gmail.com`. R2 is on.
3. Done: staging storage in `seamsadmin`: 8 D1 databases (APAC primaries in `SIN`) and all 6
   R2 buckets. The Free plan stops at 10 D1 databases, so 14 production databases wait.
   The complete signer (91, head `0091`) and Console (95, head `0118`) migration sets apply
   cleanly to the empty staging databases. The ten Wallet Pages projects exist; each has a
   suffixed `pages.dev` subdomain (for example `seams-wallet-site-staging-3vl.pages.dev`)
   because the source account holds the plain names. The destination `seams.sh` records are
   ready as two BIND files in the private inventory folder.
   4a. Claude, before the production switch: add a former docs origin (`docs.wallet.seams.sh`
   to `docs.seams.sh`) to the host redirects and change `PUBLIC_WALLET_DOCS_ORIGIN`.
4. Done: Workers Paid on `seamsadmin`. All 24 D1 databases exist; every APAC primary is in
   `SIN` (empty databases were recreated until placed), US in ATL or EWR, WEUR in LHR or CDG,
   OC in SYD. The production target switch is a reviewed script in the private folder
   (`apply-production-switch.py`), applied at the production cutover.
5. Done: the `seamsadmin` API token is in the six values files under `~/.seams` (the old
   pair stays as `COMPANY_CLOUDFLARE_*` in the two Wallet files that deploy the company site).
6. Done for staging: the eight staging GitHub environments hold the `seamsadmin` values and
   the new private D1 IDs, and the staging targets name the new hosts and storage (`7a378cf5`).
7. Done for staging: the staging backend workflow with `prepare_only` passed in `seamsadmin`
   ([run 44688679257](https://github.com/purin-labs/monorepo/actions/runs/44688679257)). All
   14 staging Workers run real code there. The first run showed one problem: Cloudflare
   answered "This Worker does not exist" right after a new script upload; the reservation now
   retries (`437e94ec`). Until the zone moves, deploy staging only with `prepare_only`.
   Done for production on 2026-11-20: the production targets name the new hosts and storage
   (`83023b1e`), `main` has the changes (merge `3b52c7ad`), every production GitHub
   environment holds the `seamsadmin` values, and both prepare-only deploys passed:
   [production testnet](https://github.com/purin-labs/monorepo/actions/runs/44690697195) and
   [production mainnet](https://github.com/purin-labs/monorepo/actions/runs/44691432575).
   All three lanes now run in `seamsadmin` without public routes. Live traffic still runs
   from the source account. Deploy every lane only with `prepare_only` until the zone moves.
   Do not run the D1 migrations by hand while a deploy runs: the first mainnet run failed
   because a local migration run was in the same database.
   The frontends are uploaded too: the frontend workflows with `prepare_only` put the Wallet
   site, both Consoles, the docs and the wallet hosts into the `seamsadmin` Pages projects
   ([staging](https://github.com/purin-labs/monorepo/actions/runs/44693012202),
   [production](https://github.com/purin-labs/monorepo/actions/runs/44693372436)). Each
   answers 200 on its `pages.dev` address. The company site is not part of these runs.
8. Owner: add `seams.sh` to `seamsadmin` as a site with a plan (it stays pending). Claude:
   load its DNS records from the inventory into the pending zone. Owner: start the Registrar
   move in the source account (Manage Domain → Configuration → Start) and accept it in
   `seamsadmin` within five days. The move carries only the registration ("No other
   configuration will be moved"): DNS records, certificates, Email Routing, Worker routes and
   Pages domains are made again in `seamsadmin`. This starts the maintenance window for all
   lanes. The registration is then transfer-locked for 30 days. `purin.io` can move only from
   2026-11-27 (more than 10 days after registration).
9. Claude: deploy each lane with public routes, create the fresh Console organisation,
   project and environment, record their IDs, activate, deploy the frontends and verify.
   Recreate the `seams.sh` Email Routing rules and check the Resend records.
10. Owner: confirm the retire list and sign `wrangler` in to the old account again. Claude:
    remove the source Seams resources.

## After the cutover

Done on 2026-11-20:

- `seams.sh` is a zone in `seamsadmin` (nameservers `jerry` and `novalee`), active since
  08:01 UTC. The registration moved with the Registrar inter-account move.
- Each lane has a fresh tenant: organisation "Seams", project "Seams Wallet", environment
  `:dev`. Activation passed for staging, production testnet and production mainnet, and the
  three Gateways answer 200 on `/readyz`.
- Old hosts redirect through `seams-host-redirects-staging` and `-production`.
- GitHub OAuth Apps and Google OAuth clients accept the new hosts. Email Routing is on.
- `purin.io` and `staging.purin.io` point at the company site projects in the source account.

Lessons:

- Routes, Worker custom domains and Pages domains attach to a pending zone. Do this before
  the Registrar move is accepted.
- A host with two labels under the zone (`staging.api.seams.sh`) needs its own certificate.
  Worker custom domains and Pages domains get one; a plain route does not. The certificates
  came 30 to 60 minutes after the zone turned active.
- Mainnet uses the `:dev` environment, because a fresh project has Production disabled.

Done after the cutover (2026-11-20):

- Email Routing for `seams.sh`: `confirm@`, `peita@` and `admin@` forward to the owner's
  address. A test message from `confirm@seams.sh` through Resend shows "Forwarded".
- The `seamsadmin` API token is rolled. The new value is in the six `~/.seams` values files
  and in the 24 GitHub environments.
- `purin.io` has Email Routing in the source account. `info@purin.io` forwards to the
  owner's address. Keep its MX and TXT records when the zone moves.
- The contact address in the company site and the Wallet Console is `info@purin.io`.
- `site:deploy:env-update` writes to the environment named after the site.
- The obsolete `regional-deployment-config` test is deleted.
- Pantry CI names `purin-labs/monorepo` (Pantry commit, local on its `main`).
- Mainnet keeps the `:dev` environment (owner decision, 2026-11-20).

Open:

- Resend sender, done in the dashboard and the target files (2026-11-21): Resend has the
  verified domain `purin.io` (Tokyo). The `purin.io` zone holds its records: CNAME `send`
  and `rsend`, TXT `resend._domainkey` and `_dmarc`. The one Resend key of all lanes had the
  domain `seams.sh`; it now has "All domains" (owner decision). `fromAddress` is
  `info@purin.io` in both target files. A test message from `info@purin.io` shows
  "Delivered" for each lane key. Production has the sender since 2026-11-21: `main` merge
  `0e6aed43`, full-stack runs 44760463374 (testnet) and 44762816205 (mainnet), both passed
  with activation. The deployed Consoles and all Gateways have `info@purin.io` in
  `CONSOLE_EMAIL_FROM` and `EMAIL_OTP_FROM_ADDRESS`. A real Email OTP message from
  production testnet passed on 2026-11-21: a test wallet from the `seams.sh` demo, "Unlock
  with email code", Resend shows "Your Seams wallet unlock code" from
  `Seams <info@purin.io>` as "Delivered", and the code unlocked the wallet. Not tested: the
  same on mainnet. Keep these four records when the zone moves.
- Production frontend, 2026-11-21: the Wallet frontend named the former Gateway hosts, so
  tenant discovery failed and the `seams.sh` demo was unavailable since the cutover. Fix
  `4017a423`, frontend run 44849337343 from `seams-tech/seams-console`; the demo works.
  `sign.seams.sh` then showed "Wallet settings are unavailable": the mainnet tenant ran on
  the `:dev` environment, so discovery said `development_testnet_v1`. Fixed on 2026-11-21:
  the owner signs in to the Console with Google only, and the former tenant organisation
  "Seams" (`org_ri0bh5kt0er2`) has only a GitHub owner. The owner chose the organisation
  "Seams Wallets II" (`org_bqzydcm176nt`, project `proj_65be6ecba1ff48d6a7294f0db59964ca`).
  A $10 support credit (`ble_mwprjgfn_bv20gsjk`) and a Wallet re-enable (revision 2) turned
  its `:prod` ACTIVE. Commit `544874cb` names `…:prod` as the mainnet tenant; full-stack run
  44853719629 passed with activation. Discovery on `api.seams.sh` says
  `production_mainnet_v1`, and `sign.seams.sh` loads. The recovery trust bundle and snapshot
  match the saved signed files before and after. Mainnet had zero wallets. "Seams" stays
  unused with its own $10 credit (`ble_mwpr820v_wkbv6vc4`). Production pauses new work if
  no card is on file by 2026-12-21.
- Phase 7, Wave 1 is done (2026-11-20): 52 Workers, 39 D1 databases, 11 R2 buckets, 15 Pages
  projects and 3 containers are deleted in the source account. The record is the private file
  `.artifacts/cloudflare-account-migration-20261120/retirement-list.md`. The idle watchbook
  tunnel is deleted too. The `watchbook-analytics` bucket is deleted too (2026-11-21, after its
  expiry rule emptied it), so 12 R2 buckets are gone and 7 stay.
- Phase 7, Wave 2 is done (2026-11-22). After Pantry Plan 95 step 5, the Pantry session
  deleted the old Seams stack in the source account with the owner's yes (Pantry Plan 93,
  "Follow-up results", Pantry `5ce9e228`). It first checked that no outside caller used the
  stack after 2026-11-21 08:00 UTC. Deleted: 15 Workers (`router-ab-*`, `seams-sdk-d1-*`,
  `seams-voice-intents-x-refresh`), 8 D1 databases, the `router-ab` and `outlayer1`
  buckets, the KV `seams-voice-intents-x-cache` and the custom domain `api.wallet.seams.sh`.
  On 2026-11-23 it also deleted the old `seams.sh` zone record (status Moved). Checked on
  2026-11-26 with Wrangler: the source account has 11 Workers (`hadimar-*`, `pantry*`,
  `purin-shop`), and none binds a Seams Worker; its D1 databases and R2 buckets are Pantry
  and `hadimar` only. See Refactor 260, "Progress".
- The owner deleted the `seams.tokyo` zone on purpose (2026-11-20). `shop.seams.tokyo` no
  longer resolves; the Worker `seams-shop` became `purin-shop` in the Purin plan.
- The Speak-to-Sign demo was not migrated. Its Worker `seams-voice-intents-x-refresh` and
  the KV `seams-voice-intents-x-cache` were deleted with Wave 2. Pages `speak-to-sign` and the
  KV `speak-to-sign-faucet-limits` stay in the source account for now.
  - Decided (owner, 2026-11-26): move the demo to `seamsadmin`. Facts on 2026-11-26: its
    source is `seams-tech/speak-to-sign` (`demo/frontend`, Pages with Functions; the
    Worker in `demo/x-refresh-worker`). The project has no custom domain, only
    `speak-to-sign.pages.dev`, and 25 deployments; the last one is `d186267`. Its Functions
    need the secrets and settings that the comments of `demo/frontend/wrangler.toml` list,
    and the KV bindings `FAUCET_LIMITS` and `X_CACHE`. The `X_CACHE` namespace is deleted,
    so the X posts route has no cache until the move. Cloudflare cannot read a Pages secret
    back: take each value from its local store or issue it again. The old project holds the
    host `speak-to-sign.pages.dev`; check which host a new project gets before the move.
- Purin account move: `purin.io` can move from 2026-11-27. The Purin account needs the
  Workers Paid plan and an API token first.

## Resource inventory

### Backend resources

These counts describe the configured baseline. They exclude diagnostic and benchmark resources.

| Resource                                   | Per lane | All three lanes | Destination action                          |
| ------------------------------------------ | -------: | --------------: | ------------------------------------------- |
| Regional Gateway Workers                   |        4 |              12 | Recreate with regional service bindings     |
| Regional Wallet Runtime Workers            |        4 |              12 | Recreate with regional signer D1 bindings   |
| Console Workers                            |        1 |               3 | Recreate with all regional bindings         |
| Router, A, B, SigningWorker, control plane |        5 |              15 | Recreate the complete service graph         |
| **Total backend Workers**                  |   **14** |          **42** | Preserve role separation                    |
| Console D1 databases                       |        1 |               3 | Create empty and apply Console migrations   |
| Regional signer D1 databases               |        4 |              12 | Create empty and apply signer migrations    |
| Role-private D1 databases                  |        3 |               9 | Create A, B, and SigningWorker storage      |
| **Total D1 databases**                     |    **8** |          **24** | Replace every source database ID            |
| Durable Object namespaces                  |        6 |              18 | Create through their owning Workers         |
| Deriver backup R2 buckets                  |        2 |               6 | Create empty with separate A and B bindings |

`deployment/wallet-system/targets.json` defines Gateway names.
Wallet Runtime names replace `gateway` with `wallet-runtime` in each regional Gateway name.
The APAC Gateway also serves as the public ingress in each lane.

The shared Console database must have the same destination ID in both target files.
Its current names are `seams-console-sin-candidate-20261014`, `seams-console-testnet-sin`, and `seams-console`.
The dated staging name can become `seams-console-staging-sin` in the destination.
Use the final name consistently in targets, manifests, and bindings.

### Regional placement

Worker placement, D1 placement, and Durable Object placement are separate settings.
Check all three for each region.

| Wallet region | Gateway and Runtime placement | D1 creation hint | Wallet and presign DO hint |
| ------------- | ----------------------------- | ---------------- | -------------------------- |
| `US`          | `aws:us-east-1`               | `enam`           | `enam`                     |
| `WEUR`        | `aws:eu-west-2`               | `weur`           | `weur`                     |
| `APAC`        | `aws:ap-southeast-1`          | `apac`           | `apac-se`                  |
| `OC`          | `aws:ap-southeast-2`          | `oc`             | `oc`                       |

The three private D1 databases in each lane require a primary in `SIN`, the Singapore data centre.
Deployment preflight enforces this requirement through `d1PrimaryColo`.
Create them with `apac`, then check primary query metadata before deployment.
A location hint cannot guarantee Singapore.
Keep this check and resolve a placement mismatch before proceeding.

The staging Console primary currently serves from Singapore.
Preserve that placement when recreating its database.
Measure the other Console primaries during inventory and preserve their required placement.
Record primary location and read-replication settings for all 24 destination databases.
Use a primary-served query when checking location.
Replica metadata alone does not establish primary placement.

Cloudflare treats location hints as preferences.
Jurisdiction restrictions are separate controls and require explicit preservation when present.
See [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).

### Durable Object ownership

| Owning Worker | Classes created per lane                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Router        | `RouterAbTenantRootCreationDurableObject`, `RouterAbRouterWalletDurableObject`                 |
| Deriver A     | `RouterAbDeriverAWalletDurableObject`                                                          |
| Deriver B     | `RouterAbDeriverBWalletDurableObject`                                                          |
| SigningWorker | `RouterAbSigningWorkerWalletDurableObject`, `RouterAbSigningWorkerPresignSessionDurableObject` |

The control plane and both derivers bind the Router's creation namespace externally.
They do not own additional copies of that namespace.

Regional wallet objects share these class namespaces.
Authenticated wallet-home metadata supplies their placement hints when the system creates objects.
Recreate all namespaces and preserve this regional routing behaviour.
New registrations must allocate destination object IDs.
Discard source object IDs, relocation records, alarms, and signing state.

Only the first location hint for an object takes effect.
Use a new wallet for each regional verification flow.
Check requested placement and observed host location separately.
See [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).

### Public hosts

Create a destination Pages project for every surface. Choose available destination project
names and update the existing `CF_PAGES_PROJECT_*` values.

| Surface                 | Account | Staging now                       | Staging after              | Production now                                    | Production after                    |
| ----------------------- | ------- | --------------------------------- | -------------------------- | ------------------------------------------------- | ----------------------------------- |
| Company site            | Purin   | `staging.seams.sh`                | `staging.purin.io`         | `seams.sh`                                        | `purin.io`                          |
| Wallet site and Console | Seams   | `staging.wallet.seams.sh`         | `staging.seams.sh`         | `wallet.seams.sh`                                 | `seams.sh`                          |
| Wallet docs             | Seams   | Pages preview                     | Pages preview              | `docs.wallet.seams.sh`                            | `docs.seams.sh`                     |
| Wallet host             | Seams   | `staging.sign.seams.sh`           | no change                  | `test.sign.seams.sh`, `sign.seams.sh`             | no change                           |
| Platform Console        | Seams   | `staging.console.seams.sh`        | `account.staging.seams.sh` | `console.seams.sh`                                | `account.seams.sh`                  |
| Wallet Console          | Seams   | `console.staging.wallet.seams.sh` | `console.staging.seams.sh` | `console.wallet.seams.sh`                         | `console.seams.sh`                  |
| Gateway                 | Seams   | `staging.api.wallet.seams.sh`     | `staging.api.seams.sh`     | `test.api.wallet.seams.sh`, `api.wallet.seams.sh` | `test.api.seams.sh`, `api.seams.sh` |
| Testnet Console backend | Seams   | —                                 | —                          | `test.console.seams.sh`                           | open: the owner asked to remove it  |

The owner chose `console.seams.sh` and `api.seams.sh`. The other new names are proposals.
`account.seams.sh` and `account.staging.seams.sh` are proposed for the Platform Console.

Rules for the host names:

- Passkeys do not move. The Wallet RP IDs are `sign.seams.sh` and `staging.sign.seams.sh`.
- Console step-up passkeys use the Wallet site host as the RP ID (`CONSOLE_STEP_UP_RP_ID`). The
  Wallet Console must be a subdomain of that host: `console.seams.sh` under `seams.sh`, and
  `console.staging.seams.sh` under `staging.seams.sh`.
- The Console API shares the Wallet site host (`/console/*`, `/account-platform/v1/*` and
  `/internal/tenant-deployment/v1/*`, from `buildConsoleRoutes`).
- `test.console.seams.sh` is the Console of the production testnet lane, with its own Worker
  and D1 database. The testnet demo calls it and `deploy-live-demo.yml` activates through it.
  It stays until the testnet lane uses another Console.
- An API host never redirects, because a browser does not follow a redirect for a CORS
  preflight.

Former hosts stay in the `seams.sh` zone, so they move to the Seams account with it:

- `formerWalletSiteOrigins` (Wallet targets), `formerPlatformOrigins` and
  `formerWalletConsoleOrigins` (Console targets) name them. `readHostRedirects` in
  `scripts/deployment-targets.mjs` maps each one to its successor.
- The `wallet-site` deploy deploys the Worker `seams-host-redirects-<site>`
  (`deployment/host-redirects/worker.mjs`). It sends a 301 to the same path and query on the
  successor, and the smoke checks each redirect.
- The Console Worker keeps its API routes on a former Wallet site host, and the Gateway keeps a
  former Gateway host as a second custom domain (`origins.formerGateways`).
- A company page on `seams.sh` (for example `/company/`) redirects to `purin.io` through the
  Wallet site `_redirects`.

The deploy token of the source account can bind Pages hosts but cannot read or change DNS. A
deploy waits until each Pages host is active. Give the destination deploy tokens the DNS
permission, or make each new Pages host's proxied CNAME in the dashboard.

## Phase 1 — Record the complete source inventory

1. Identify source and destination account IDs through Cloudflare account access.
2. Export all source Workers, their versions, settings, bindings, routes, domains, placement, limits, and cron schedules.
3. Export all DO namespaces with their owning Workers, classes, storage types, and external references.
4. Export all D1 databases with IDs, locations, replication settings, and migration state.
5. Export R2 bucket settings, locations, jurisdictions, lifecycle rules, public access, domains, and event notifications.
6. Export Pages projects, domains, build settings, deployment methods, variables, and secret names.
7. Export the `seams.sh` zone, registrar details, DNSSEC state, certificates, and zone settings.
8. Export relevant WAF, redirect, cache, rate-limit, Access, Tunnel, and email-routing configuration when present.
9. Enumerate KV, Queues, Workflows, Secrets Store, Analytics Engine, and other enabled products for additional Seams dependencies.
10. Record account subscriptions, Seams usage, renewal dates, quotas, and invoice delivery settings.
11. Inspect deployment credentials in both repositories, GitHub environments, organisation secrets, local files, and other deployment machines.
12. Assign every discovered Seams resource a destination resource and record its dependencies.

Inspect the full account inventory before filtering by names.
Shared resources and renamed Workers can have names without a `seams` prefix.
Record any shared dependency that must be separated before deletion.

The public repository contains Yao benchmarks, transport probes, fault scenarios, hosted fixtures, and ML-DSA experiments.
Move all deployed experiments and their companion Workers together.
Inspect embedded peer URLs and any intentional cross-account topology.
Do not omit deployed experiments because their configurations look old.
Preserve historical evidence files and the configuration needed to reproduce retained experiments.

Use a private evidence directory such as `.artifacts/cloudflare-account-migration-20261021/`.
Record source ID, destination ID, lane, role, region, dependencies, and disposition for every resource.
Reuse this inventory as the deletion checklist.
Store secret values only in the existing protected deployment files or secret manager.

**Exit condition:** every source Seams resource and shared dependency has a recorded disposition.

### Phase 1 result (Seams scope, 2026-11-20)

The private inventory is `.artifacts/cloudflare-account-migration-20261120/inventory.md`.

- Workers: 43 Seams Workers to recreate, 24 to retire, 8 Purin, 3 that stay.
- Durable Object namespaces: 18 Seams, 21 to retire, 12 Purin, 2 that stay.
- D1: the active Seams databases plus 9 retired copies; 14 experiment databases retire.
- Zones: `seams.sh` goes to the Seams account; `purin.io` and `seams.tokyo` (Pantry's
  `shop.seams.tokyo`) go to the Purin account. `seams.tech`, `getsignal.pro` and `tatchi.xyz`
  wait for an owner decision.
- `seams.sh` has 35 records and no zone rules. Two of them belong to Pantry
  (`*.voice.seams.sh`, `square-sandbox-webhook`).
- Email Routing on `seams.sh` forwards `confirm@`, `peita@` and `admin@`. `sales@seams.sh` has no
  rule, so contact mail to it does not arrive.
- The testnet and staging Routers have public `workers.dev` addresses (`workers_dev = true` in
  `seams-wallet`); the production Router does not.
- Durable Object SQL writes cost $49 of $51 this period; the fresh start resets that storage.

## Phase 2 — Prepare the destination accounts and billing

Do these steps for `seamsadmin@gmail.com` (Seams) and for `purinindustries@gmail.com` (Purin).
The Seams stack needs Workers Paid: the Free plan has 100,000 requests a day and short CPU
limits.

1. Verify the account and enable multi-factor authentication.
2. Store recovery codes and administrator access through the team's existing secure process.
3. Configure the Seams billing profile, payment method, invoice address, and budget alerts.
4. Enable the required Workers, D1, DO, R2, Pages, and other inventoried services.
5. Check quotas against the complete inventory, including deployed experiments and temporary verification resources.
6. Create destination-scoped deployment tokens using the existing Console and Wallet authority separation.
7. Configure the destination Workers subdomain and record its new `workers.dev` suffix.
8. Prepare the destination DNS zone and copy required zone settings.
9. Give each deploy token Pages, Workers, Workers Routes, D1, R2 and DNS permissions for its
   zone.

Use the explicit destination account ID even when Wrangler can discover only one account.
Keep source credentials separate for inventory and later removal.
Use fresh protected values files so old private D1 IDs and account credentials cannot enter destination preparation.
Check shell variables because the Wallet preparation command gives them precedence over values files.

**Exit condition:** the destination account can create every required resource with Seams billing attached.

## Phase 3 — Prepare fresh storage, keys, and deployment support

### Storage and configuration

1. Create the three Console databases, twelve regional signer databases, and nine private databases in the destination account.
2. Apply creation hints and any required jurisdiction settings from the inventory.
3. Check primary locations before accepting their IDs.
4. Replace Console and regional D1 IDs in `deployment/wallet-system/targets.json`.
5. Replace the matching Console IDs in `deployment/console/targets.json`.
6. Supply destination private D1 IDs through the existing `ROUTER_AB_*_PRIVATE_D1_ID` variables.
7. Create the six R2 buckets with the final names from the packaged deriver manifests.
8. Apply complete migration sets to the empty databases through the existing deployment commands.

Wallet environment preparation can create or discover the three private D1 databases.
It reads Console and regional signer database IDs from checked-in targets.
Console environment preparation also reads its target database directly.
Neither preparation command provisions the complete storage inventory.
Allocate that storage before generating manifests.

Copy no application rows, R2 recovery objects, pre-signature pools, sessions, or old organisation records.
Keep migration history and required system bootstrap data produced by the normal migration process.
Regenerate deployment files and artifacts after target changes.
Do not edit generated configurations or installed package files by hand.

### Keys and external dependencies

Generate fresh Wallet and Console manifests once per lane through their existing preparation commands.
Initialized targets require the existing explicit `--rotate` option for Wallet identity replacement.
Keep each generated manifest and apply that same generation throughout its lane.
Do not regenerate keys when resuming a failed deployment.

Replace internal service credentials, ceremony signing keys, online wrapping keys, encryption keys, and session-sealing keys.
Replace Console session, invitation, webhook-encryption, and grant-signing keys.
Update every corresponding public key, keyset, identifier, and verifier from the same generation.
Carry the Console manifest's grant-authority public handoff into Wallet configuration.
Keep the existing separation between signing roles.

Reissue recovery certificates and trust snapshots when their deployment authorities change.
Staging and mainnet require these trust artifacts.
Keep the offline recovery trust authority in its existing protected signing workflow.
An account migration alone does not require replacing the SDK's pinned recovery trust root.

Cloudflare does not reveal stored secret values through Wrangler or its dashboard.
Recover required external values from their authoritative store or issue replacement credentials.
See [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

| External dependency               | Required action                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mainnet Google Cloud KMS          | Preserve A/B key separation and provider bindings. Issue credentials for destination Workers where needed.                                                    |
| NEAR relayers and EVM sponsors    | Preserve or replace funded service identities deliberately. Check balances and network configuration.                                                         |
| Google OIDC and GitHub OAuth      | Preserve final callback origins. Reconfigure credentials only where account ownership or temporary origins require it.                                        |
| Resend                            | Install Wallet and Console credentials. Preserve sender verification and all email DNS records.                                                               |
| Stripe                            | Install the required credentials and webhook secret. Check old recurring subscriptions and pending webhook deliveries before discarding organisation records. |
| Satyr connection, when configured | Update necessary service assertions and provisioning credentials. Preserve unrelated Satyr infrastructure.                                                    |
| `info@purin.io`                   | Make it receive mail. Verify `purin.io` in Resend (SPF and DKIM) before it becomes the From address of Email OTP and Console mail.                            |

Cloudflare migration does not transfer ownership or billing for Google Cloud, Stripe, Resend, or blockchain accounts.
Deleting Cloudflare wallet records does not delete on-chain accounts or move their funds.

### Fresh-account deployment gap

Add fresh-account bootstrap support to the existing deployment scripts before execution.
Current deployment order assumes that the Router and its namespaces already exist.
It fails against an empty destination account.

The service graph contains several cycles:

- Router calls the control plane, which binds the Router's creation DO.
- Deriver A and Deriver B call each other and bind the Router's creation DO.
- Console calls regional Gateways and Runtime Workers, which call Console.
- Each regional Gateway binds every regional Gateway.

Extend the existing inert-Worker bootstrap pattern to reserve absent service target names.
An inert Worker returns HTTP 503 and has no public routes or scheduled work.
Then deploy the real Router with its namespace declarations before any external DO consumer.
Use the pinned package's existing DO migration syntax and class ownership.

Prepare generated deployment configurations without public routes and cron triggers for the preparation stage.
The standard deployment currently attaches these automatically.
Also defer Pages domain attachment until the destination zone can serve the domains.
Keep these changes in deployment orchestration and generated deployment configuration.
Do not add runtime compatibility paths, duplicate applications, or another infrastructure framework.

Keep writes gated until the fresh tenant deployment becomes active.
Retired tenant IDs in checked-in targets must never activate against the empty destination.
Use the existing inactive-deployment and activation flow for this stage.
Replace recorded organisation, project, and environment IDs after creating the destination tenant.

**Exit condition:** storage, keys, public verifiers, and a repeatable empty-account bootstrap are ready for every lane.

## Phase 4 — Deploy the destination without public traffic

Prepare all three lanes before moving the shared `seams.sh` zone.
Use staging to verify deployment support first.

For each lane:

1. Build exact pinned Wallet packages and private application artifacts once.
2. Apply Console, signer, and private D1 migrations.
3. Reserve absent service target names with inert Workers.
4. Deploy the real Router and its two owned DO namespaces without public routes.
5. Deploy SigningWorker, both derivers, and the control plane with destination bindings and secrets.
6. Deploy all four Wallet Runtime Workers.
7. Deploy all four Gateway Workers.
8. Deploy Console with its complete regional bindings.
9. Deploy the final Router configuration after all real peers exist.
10. Deploy every Pages surface to its destination project without moving public domains.
11. Deploy all inventoried benchmark and diagnostic resources with their destination dependencies.
12. Compare destination bindings and settings against the inventory.

The two derivers and SigningWorker create their own namespaces through their normal deployments.
External references must point to the destination Router's namespace.
DO namespace transfers between Workers operate within one account.
Create fresh destination namespaces for this reset.
See [DO namespace lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

Verify internal services through a temporary authenticated Worker in the destination account when public routes are unavailable.
Check Pages assets through destination preview URLs.
Use final public origins for full authentication and wallet tests after domain cutover.
Remove the temporary verifier when verification finishes.

**Exit condition:** all destination resources exist, migrations pass, and every final service target contains real application code.

## Phase 5 — Move domains and activate fresh tenants

### Domain preparation

Move `seams.sh` to the Seams account and `purin.io` to the Purin account.
Both domains use Cloudflare Registrar, and neither has DNSSEC (checked 2026-11-20). Use the
Registrar inter-account transfer. `purin.io` was registered on 2026-11-17, so check that it can
move before you plan the window.
Preserve unrelated DNS records and establish ownership for any shared zone settings before the move.
Check all dependent hostnames because one zone change affects staging and production together.

If another registrar owns the domain, prepare the destination zone and change nameservers at that registrar.
Handle DNSSEC by removing the old delegation signer record before the nameserver change.
Enable destination DNSSEC after delegation stabilises and publish its new signer record.
Export DNS records explicitly because automatic discovery can copy Cloudflare proxy addresses.
Recreate zone rules and certificates.
See [moving a domain between accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/).

If Cloudflare Registrar owns the domain, use its inter-account registration process.
Both accounts must confirm the move.
The destination then owns renewal billing, and other zone configuration requires recreation.
Confirm transfer eligibility before scheduling the maintenance window.
See [Registrar account transfer](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/).

### Cutover order

1. Pause Seams deployment automation and account configuration changes.
2. Place source Seams entry points into maintenance and drain active requests.
3. Disable source Seams cron schedules, event consumers, and queued external deliveries where applicable.
4. Prevent source DO alarms and direct Worker URLs from continuing application work.
5. Move DNS delegation or complete the Registrar account transfer.
6. Remove conflicting source Worker and Pages domain associations.
7. Attach destination Worker domains, Console path routes, and Pages domains.
8. Check certificates, DNS resolution, route precedence, email records, and required zone rules.
9. Create the fresh Seams administrator, organisations, projects, and environments through Console.
10. Activate each new environment through the protected deployment workflow and its resource verification.
11. Verify staging, then production testnet, then production mainnet.
12. Enable destination scheduled work after its owning lane passes verification.
13. Resume ordinary deployment automation after all public entry points pass.

Source DO alarms require explicit handling because disabling cron triggers does not stop object alarms.
Use a source-only teardown deployment or remove the source namespaces when rollback is no longer required.
Keep source writes fenced throughout the maintenance window.

Pages domain attachment must precede final DNS validation.
A CNAME record alone does not configure the Pages domain.
Check certificate coverage for nested Console and Gateway hostnames.
See [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Preserve the existing protected activation paths:

- Staging and mainnet use their backend workflows. Production testnet uses `deploy-live-demo.yml`.
- Each workflow reads the environment ID from `deployment/wallet-system/targets.json`, deploys Wallet and Console, then activates the tenant.
- The workflow then deploys the full frontend release and verifies the frontend surfaces, backend, and Console.
- `pnpm tenant:cutover` runs inside the protected GitHub workflow because it requires GitHub OIDC authentication.

Restore marketing, docs, and Console access before public wallet registration where needed for administrator provisioning.
Keep wallet entry points gated until resource challenges and tenant activation pass.

**Exit condition:** final public hostnames serve the destination account and fresh tenant activation succeeds in every lane.

## Phase 6 — Verify behaviour and retain repeatable evidence

Use a new organisation and wallet for each lane and home-region combination.
The minimum regional matrix contains twelve fresh wallet scenarios.
Extend existing deployed E2E tooling where it lacks a required flow.
Keep Wallet lifecycle contracts in `seams-wallet` and composed product tests in this repository.

Each regional scenario must:

1. Create or select its fresh Console organisation, project, and activated environment.
2. Register a wallet through the deployed browser flow.
3. Check the selected home region and its destination signer D1 database.
4. Check destination Router, A, B, SigningWorker, and presign object allocation and placement events.
5. Complete Ed25519 and ECDSA signing through the deployed services.
6. Verify signatures independently and reject an altered signed message.
7. Unlock a new browser session and sign again.
8. Exercise factor addition and recovery with fresh test wallets through the existing supported flows.
9. Exercise tenant-root managed backup creation and recovery, including mainnet KMS access.
10. Check Console persistence, project origin restrictions, email delivery mode, and scheduled work.

Use unfunded canary wallets and bounded sponsored operations for mainnet verification.
Record transaction hashes only when a scenario deliberately broadcasts a transaction.
Check actual product behaviour through the final public hostnames.

Also verify every frontend, hosted SDK asset manifest, public docs revision, OAuth callback, and configured webhook.
Check allowed and rejected browser origins.
Confirm that internal Workers remain inaccessible without their required authentication.
Confirm that old sessions and API credentials fail against the destination.

The existing `pnpm router:deploy:browser-evidence` command writes deployed browser evidence.
Its current flow covers Ed25519 prepare/finalize requests and browser-origin behaviour.
It needs a fresh flow module or fresh request material and does not cover this complete migration matrix.
Use it as one part of the acceptance run.

Retain these private artifacts:

- Source and destination resource inventories with a complete mapping.
- Deployed version IDs, package versions, Git revisions, and artifact digests.
- Migration heads and primary-location query metadata for every D1 database.
- DO namespace ownership, placement requests, and observed host events for every tested region.
- E2E results, browser traces, independent signature checks, and redacted operation identifiers.
- DNS, domain, certificate, cron, email, webhook, and backup verification results.
- A repeatable command or documented procedure for every acceptance scenario.
- Billing evidence before migration and after source removal.

Run `pnpm test:scripts` after implementing changes to deployment scripts or workflows.
Run the applicable type checks and existing boundary checks if those changes affect shared state or interfaces.
Classify any existing test failure under the repository testing policy before repairing it.
Create no new unit tests or source-text policy guards for this migration.

**Exit condition:** all required scenarios pass with reproducible evidence and no source-account runtime dependency.

## Phase 7 — Remove source resources and close billing

After acceptance, remove source Seams resources from the reconciled inventory:

1. Remove entry routes, custom domains, scheduled triggers, event consumers, and obsolete deployment hooks.
2. Remove external DO bindings before deleting their owning namespaces.
3. Delete source Seams DO namespaces and their stored objects through the supported lifecycle procedure.
4. Delete source Seams Workers, including retired experiments and diagnostic services.
5. Delete source Seams D1 databases, including retired migration copies and regional databases.
6. Empty and delete source Seams R2 buckets, including incomplete multipart uploads where present.
7. Delete source Seams Pages projects after domain reassignment succeeds.
8. Delete other inventoried Seams storage, queues, secrets, analytics resources, and account integrations.
9. Revoke source Seams deployment tokens and replace local default credentials on deployment machines.
10. Remove source account IDs, storage IDs, peer URLs, and obsolete tenant identities from active deployment inputs.
11. Cancel Seams-only subscriptions and remove obsolete zone plans or add-ons.
12. Preserve subscriptions and credentials still required by unrelated source workloads.

Check the complete source account inventory again after deletion.
An idle Worker or detached hostname does not prove that its storage and scheduled work disappeared.
Retain deletion results for all mapped resources.

Cloudflare subscription cancellation requires an explicit billing action.
Domain changes do not cancel subscriptions.
Cancellations generally apply at the billing-period boundary, and earlier usage can appear on later invoices.
See [Cloudflare subscription cancellation](https://developers.cloudflare.com/billing/manage/cancel-subscription/).

Check new Seams usage under the destination account after cutover.
Check source usage after reporting delays, then reconcile the next invoice.
Record any shared source subscription that remains and its unrelated owner.
Do not claim zero historical charges merely because new Seams usage stops.

**Exit condition:** the deletion evidence covers every mapped source resource and Seams-only renewal.
Future Seams usage belongs to the dedicated account.

## Failure handling

Before domain cutover, keep the source deployment available while repairing the destination.
Do not delete source resources during preparation.

After cutover, prefer repairing the destination while entry points remain in maintenance.
If traffic must return to the source, stop destination writes first.
Any wallets or organisations created in the destination then become another discarded dataset.
Never merge private signing storage or restore consumed signing material between accounts.
DNS and certificate changes can delay traffic restoration.

After source namespace or storage deletion, restoring the old service state is outside this reset plan.
Recovery means rebuilding a fresh service from the recorded artifacts and keys.

## Implementation locations and execution gates

| Location                                                                 | Required work                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `deployment/wallet-system/targets.json`                                  | Replace destination storage IDs and final tenant metadata                                     |
| `deployment/console/targets.json`                                        | Keep Console database targets consistent with Wallet targets                                  |
| `scripts/deploy-backend.mjs`                                             | Extend service-name bootstrap and support preparation without public routes or scheduled work |
| `packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs` | Render the preparation configuration through the existing path                                |
| `scripts/deploy-surface.mjs`                                             | Permit Pages upload before final domain attachment                                            |
| `deployment/host-redirects/worker.mjs` and the former-host fields        | Redirect former hosts; keep their API routes                                                  |
| `scripts/deploy-surface.mjs` and the frontend workflows                  | Deploy the company site with Purin account credentials, the Wallet surfaces with Seams ones   |
| Existing Wallet and Console environment commands                         | Generate and apply fresh protected manifests with destination account inputs                  |
| `.github/workflows/deploy-*.yml` and GitHub environments                 | Supply destination credentials and preserve protected activation                              |
| `seams-wallet` benchmark configurations and deployment inputs            | Recreate deployed experiments and replace account-specific peer origins                       |
| Existing E2E tooling                                                     | Cover the regional acceptance matrix and write repeatable evidence                            |

Update every existing deployment environment that holds Cloudflare credentials.
Backend prefixes are `staging`, `production-testnet`, and `production` for mainnet.
Each prefix has `gateway`, `mpc-router`, `deriver-a`, `deriver-b`, `signing-worker`, and `tenant-root-control-plane` environments.
Also update the three Console environments, both frontend environments, and `production-live-demo`.
Check repository, organisation, benchmark, and other environment scopes during inventory.

Commit implementation work on `dev` in the main checkouts.
Use the established release process to promote the reviewed revision to `main` for production deployment.
Preserve existing branch restrictions and environment protection rules.
Pin exact public package releases if the migration requires public source changes.

The execution gates are:

1. **Inventory complete:** account IDs, domain ownership, all resources, and all shared dependencies recorded.
2. **Destination ready:** billing, quotas, storage placement, secrets, and bootstrap support verified.
3. **Cutover ready:** every lane deployed, domains prepared, maintenance controls ready, and source writes can be fenced.
4. **Acceptance complete:** regional product scenarios and public entry points pass with retained evidence.
5. **Billing isolated:** source removal and Seams-only subscription cancellation verified.
