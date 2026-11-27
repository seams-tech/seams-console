import type {
  RouterApiKeyAuthAdapter,
  RouterApiProjectEnvironmentResolver,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiUsageMeterAdapter,
} from '@seams/wallet-server/cloud-host';
import type { TenantRootIdentityV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import type { ConsoleWalletEnvironmentService } from '../environments/service';
import type { LaneEnvironmentKeys } from './environmentKeys';

/*
 * The guards of one Wallet lane (Refactor 261). A lane serves only the environments of its
 * network, so every Wallet call of a lane passes one of these wrappers: an environment of
 * another lane is not found, and a key of another lane is refused. Each guard returns the
 * wrapped service itself when the lane serves every environment, which is the only lane of
 * a Console.
 */

/**
 * The environments that the lane's Wallet routes can see. The dashboard's environment list
 * and edits keep the unfiltered service, because they act on every network of a project.
 */
export function laneWalletEnvironments(
  service: ConsoleWalletEnvironmentService,
  keys: LaneEnvironmentKeys,
): ConsoleWalletEnvironmentService {
  if (keys.admitsAll) return service;
  return {
    setProjectAvailability: (context, request) => service.setProjectAvailability(context, request),
    async findOrganizationForEnvironment(request) {
      if (!keys.admitsEnvironmentId(request.environmentId)) return null;
      return await service.findOrganizationForEnvironment(request);
    },
    async listEnvironments(context, request) {
      const environments = await service.listEnvironments(context, request);
      return environments.filter((environment) => keys.admitsKey(environment.key));
    },
    createEnvironment: (context, request) => service.createEnvironment(context, request),
    updateEnvironment: (context, environmentId, request) =>
      service.updateEnvironment(context, environmentId, request),
    archiveEnvironment: (context, environmentId) =>
      service.archiveEnvironment(context, environmentId),
    archiveProjectEnvironments: (context, projectId) =>
      service.archiveProjectEnvironments(context, projectId),
    provisionProjectEnvironments: (context, request) =>
      service.provisionProjectEnvironments(context, request),
  };
}

export function laneSecretKeyAuth(
  adapter: RouterApiKeyAuthAdapter,
  keys: LaneEnvironmentKeys,
): RouterApiKeyAuthAdapter {
  if (keys.admitsAll) return adapter;
  const refused = {
    ok: false as const,
    status: 403 as const,
    code: 'secret_key_environment_mismatch' as const,
    message: 'This key belongs to an environment of another network',
  };
  return {
    async authenticate(input) {
      if (input.environmentId && !keys.admitsEnvironmentId(input.environmentId)) return refused;
      const result = await adapter.authenticate(input);
      if (result.ok && !keys.admitsEnvironmentId(result.principal.environmentId)) return refused;
      return result;
    },
  };
}

export function lanePublishableKeyAuth(
  adapter: RouterApiPublishableKeyAuthAdapter,
  keys: LaneEnvironmentKeys,
): RouterApiPublishableKeyAuthAdapter {
  if (keys.admitsAll) return adapter;
  const refused = {
    ok: false as const,
    status: 403 as const,
    code: 'publishable_key_environment_mismatch' as const,
    message: 'This key belongs to an environment of another network',
  };
  return {
    async authenticate(input) {
      if (!keys.admitsEnvironmentId(input.environmentId)) return refused;
      const result = await adapter.authenticate(input);
      if (result.ok && !keys.admitsEnvironmentId(result.principal.environmentId)) return refused;
      return result;
    },
  };
}

export function laneProjectEnvironments(
  resolver: RouterApiProjectEnvironmentResolver,
  keys: LaneEnvironmentKeys,
): RouterApiProjectEnvironmentResolver {
  if (keys.admitsAll) return resolver;
  return {
    async listEnvironments(context, filters) {
      if (context.environmentId && !keys.admitsEnvironmentId(context.environmentId)) return [];
      const environments = await resolver.listEnvironments(context, filters);
      return environments.filter((environment) => keys.admitsKey(environment.key));
    },
  };
}

/** Usage follows an authenticated call of the same lane, so another lane's event is a fault. */
export function laneUsageMeter(
  meter: RouterApiUsageMeterAdapter,
  keys: LaneEnvironmentKeys,
): RouterApiUsageMeterAdapter {
  if (keys.admitsAll) return meter;
  return {
    async recordEvent(event) {
      if (!keys.admitsEnvironmentId(event.environmentId)) {
        throw new Error('A usage event names an environment of another Wallet lane');
      }
      await meter.recordEvent(event);
    },
  };
}

export interface TenantRootActiveLineageResolver<Lineage> {
  resolveActiveLineage(identity: TenantRootIdentityV1): Promise<Lineage | null>;
}

export function laneTenantRootActiveLineage<Lineage>(
  resolver: TenantRootActiveLineageResolver<Lineage>,
  keys: LaneEnvironmentKeys,
): TenantRootActiveLineageResolver<Lineage> {
  if (keys.admitsAll) return resolver;
  return {
    async resolveActiveLineage(identity) {
      if (!keys.admitsEnvironmentId(identity.envId)) return null;
      return await resolver.resolveActiveLineage(identity);
    },
  };
}
