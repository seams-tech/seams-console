import { parseWalletSessionLimits } from '@seams/mpc-wallet/client';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from './consoleHttp';
import { decodeConsoleStatus } from './consoleDecode';

export const DASHBOARD_ENVIRONMENTS_UPDATED_EVENT = 'dashboard:wallet-environments-updated';

export interface DashboardConsoleOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardConsoleProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** The tenant's maximum Wallet Session budget for one environment. */
export interface DashboardWalletSessionLimits {
  maxTtlMs: number;
  maxRemainingUses: number;
}

export interface DashboardConsoleEnvironment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  status: string;
  /** Null when the tenant set none, so the wallet gateway uses its defaults. */
  walletSessionLimits: DashboardWalletSessionLimits | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCreateProjectRequest {
  id?: string;
  name: string;
}

export interface DashboardUpdateProjectRequest {
  name: string;
}

interface ConsoleResponseBase {
  ok?: boolean;
  code?: string;
  message?: string;
}

interface ConsoleOrganizationResponse extends ConsoleResponseBase {
  org?: unknown;
}

interface ConsoleProjectsResponse extends ConsoleResponseBase {
  projects?: unknown;
  project?: unknown;
}

interface ConsoleEnvironmentsResponse extends ConsoleResponseBase {
  environments?: unknown;
  environment?: unknown;
}

function decodeOrganization(raw: unknown): DashboardConsoleOrganization | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(row.name || '').trim() || id,
    slug: String(row.slug || '').trim(),
    status: decodeConsoleStatus(row.status),
    createdAt: String(row.createdAt || '').trim(),
    updatedAt: String(row.updatedAt || '').trim(),
  };
}

function decodeProject(raw: unknown): DashboardConsoleProject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(row.name || '').trim() || id,
    slug: String(row.slug || '').trim(),
    status: decodeConsoleStatus(row.status),
    createdAt: String(row.createdAt || '').trim(),
    updatedAt: String(row.updatedAt || '').trim(),
  };
}

/**
 * The gateway's own parser. A value that does not parse is an error, so the
 * page never shows a bad setting as "uses the defaults".
 */
function decodeWalletSessionLimits(raw: unknown): DashboardWalletSessionLimits | null {
  if (raw === undefined || raw === null) return null;
  return parseWalletSessionLimits(raw, 'walletSessionLimits');
}

function decodeEnvironment(raw: unknown): DashboardConsoleEnvironment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const projectId = String(row.projectId || '').trim();
  if (!id || !projectId) return null;
  return {
    id,
    projectId,
    key: String(row.key || '').trim(),
    name: String(row.name || '').trim() || id,
    status: decodeConsoleStatus(row.status),
    walletSessionLimits: decodeWalletSessionLimits(row.walletSessionLimits),
    createdAt: String(row.createdAt || '').trim(),
    updatedAt: String(row.updatedAt || '').trim(),
  };
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const base = requireConsoleBaseUrl();
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await parseConsoleJson(response);
  if (!response.ok || (body as ConsoleResponseBase | null)?.ok !== true) {
    throw new Error(consoleErrorMessage(response, body, 'Console request failed'));
  }
  return body;
}

function fetchJson(path: string): Promise<unknown> {
  return requestJson(path, { method: 'GET', headers: buildConsoleAcceptHeaders() });
}

function mutateJson(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
): Promise<unknown> {
  return requestJson(path, {
    method,
    headers: buildConsoleJsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function getDashboardOrganization(): Promise<DashboardConsoleOrganization> {
  const body = (await fetchJson('/console/org')) as ConsoleOrganizationResponse;
  const organization = decodeOrganization(body.org);
  if (!organization) {
    throw new Error('Console organization response did not include a valid organization');
  }
  return organization;
}

export async function listDashboardProjects(
  input: { status?: 'ACTIVE' | 'ARCHIVED' } = {},
): Promise<DashboardConsoleProject[]> {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/projects${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleProjectsResponse;
  const rows = Array.isArray(body.projects) ? body.projects : [];
  return rows
    .map((entry) => decodeProject(entry))
    .filter((entry): entry is DashboardConsoleProject => entry !== null);
}

export async function listDashboardEnvironments(
  input: { projectId?: string; status?: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' } = {},
): Promise<DashboardConsoleEnvironment[]> {
  const params = new URLSearchParams();
  if (input.projectId) params.set('projectId', input.projectId);
  if (input.status) params.set('status', input.status);
  const suffix = params.toString();
  const body = (await fetchJson(
    `/console/environments${suffix ? `?${suffix}` : ''}`,
  )) as ConsoleEnvironmentsResponse;
  const rows = Array.isArray(body.environments) ? body.environments : [];
  return rows
    .map((entry) => decodeEnvironment(entry))
    .filter((entry): entry is DashboardConsoleEnvironment => entry !== null);
}

/** Sets the maximum Wallet Session budget of one environment. Null returns it to the defaults. */
export async function updateDashboardEnvironmentWalletSessionLimits(
  environmentId: string,
  walletSessionLimits: DashboardWalletSessionLimits | null,
): Promise<DashboardConsoleEnvironment> {
  const normalizedId = String(environmentId || '').trim();
  if (!normalizedId) throw new Error('Environment id is required');
  const body = (await mutateJson(
    `/console/environments/${encodeURIComponent(normalizedId)}/wallet-session-limits`,
    'PUT',
    { walletSessionLimits },
  )) as ConsoleEnvironmentsResponse;
  const environment = decodeEnvironment(body.environment);
  if (!environment) throw new Error('Console environment update response was invalid');
  return environment;
}

export async function createDashboardProject(
  input: DashboardCreateProjectRequest,
): Promise<DashboardConsoleProject> {
  const body = (await mutateJson('/console/projects', 'POST', input)) as ConsoleProjectsResponse;
  const project = decodeProject(body.project);
  if (!project) throw new Error('Console project create response was invalid');
  return project;
}

export async function updateDashboardProject(
  projectId: string,
  input: DashboardUpdateProjectRequest,
): Promise<DashboardConsoleProject> {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) throw new Error('Project id is required');
  const body = (await mutateJson(
    `/console/projects/${encodeURIComponent(normalizedId)}`,
    'PATCH',
    input,
  )) as ConsoleProjectsResponse;
  const project = decodeProject(body.project);
  if (!project) throw new Error('Console project update response was invalid');
  return project;
}

export async function archiveDashboardProject(projectId: string): Promise<DashboardConsoleProject> {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) throw new Error('Project id is required');
  const body = (await mutateJson(
    `/console/projects/${encodeURIComponent(normalizedId)}/archive`,
    'POST',
    {},
  )) as ConsoleProjectsResponse;
  const project = decodeProject(body.project);
  if (!project) throw new Error('Console project archive response was invalid');
  return project;
}
