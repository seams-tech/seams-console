import React from 'react';
import { consoleLocale, t } from '@core/i18n';
import {
  canDashboardManageProjects,
  useDashboardConsoleSession,
} from '@core/dashboard/consoleSession';
import {
  useDashboardSelectedContext,
  useDashboardSelectedContextDisplay,
} from '@core/dashboard/selectedContext';
import {
  listDashboardEnvironments,
  updateDashboardEnvironmentWalletSessionLimits,
  type DashboardConsoleEnvironment,
  type DashboardWalletSessionLimits,
} from '@core/dashboard/consoleContextApi';
import {
  DEFAULT_TENANT_WALLET_SESSION_LIMITS,
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
} from '@seams/mpc-wallet/client';
import './walletSessions.css';

const DAY_MS = 86_400_000;
// The wallet gateway's own numbers. The Console route checks each value again.
const DEFAULT_SIGNATURES = DEFAULT_TENANT_WALLET_SESSION_LIMITS.maxRemainingUses;
const DEFAULT_DAYS = DEFAULT_TENANT_WALLET_SESSION_LIMITS.maxTtlMs / DAY_MS;
const MAX_SIGNATURES = MAX_WALLET_SESSION_REMAINING_USES;
const MAX_DAYS = MAX_WALLET_SESSION_TTL_MS / DAY_MS;

const countFormat = new Intl.NumberFormat(consoleLocale, { maximumFractionDigits: 2 });

type LimitFields = { readonly signatures: string; readonly days: string };

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly environments: readonly DashboardConsoleEnvironment[] };

type SaveState =
  | { readonly kind: 'idle' | 'saving' | 'saved' }
  | { readonly kind: 'error'; readonly message: string };

type ParsedFields =
  | { readonly ok: true; readonly limits: DashboardWalletSessionLimits | null }
  | { readonly ok: false; readonly message: string };

function fieldsFor(limits: DashboardWalletSessionLimits | null): LimitFields {
  if (!limits) return { signatures: '', days: '' };
  // A length that is not a whole number of days shows as it is, so a save must replace it.
  return {
    signatures: String(limits.maxRemainingUses),
    days: String(Number((limits.maxTtlMs / DAY_MS).toFixed(4))),
  };
}

/** An empty field gives its default. A value outside 1..max gives null. */
function readWholeNumber(text: string, fallback: number, max: number): number | null {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

/** Both fields empty means the defaults, so the Console stores no setting. */
function parseFields(fields: LimitFields): ParsedFields {
  if (!fields.signatures.trim() && !fields.days.trim()) return { ok: true, limits: null };
  const signatures = readWholeNumber(fields.signatures, DEFAULT_SIGNATURES, MAX_SIGNATURES);
  if (signatures === null) {
    return {
      ok: false,
      message: t('walletSessionsSignaturesInvalid', { max: countFormat.format(MAX_SIGNATURES) }),
    };
  }
  const days = readWholeNumber(fields.days, DEFAULT_DAYS, MAX_DAYS);
  if (days === null) {
    return { ok: false, message: t('walletSessionsDaysInvalid', { max: MAX_DAYS }) };
  }
  return { ok: true, limits: { maxRemainingUses: signatures, maxTtlMs: days * DAY_MS } };
}

function limitsSummary(limits: DashboardWalletSessionLimits | null): string {
  if (!limits) {
    return t('walletSessionsUsesDefaults', {
      signatures: countFormat.format(DEFAULT_SIGNATURES),
      days: countFormat.format(DEFAULT_DAYS),
    });
  }
  return t('walletSessionsCurrent', {
    signatures: countFormat.format(limits.maxRemainingUses),
    days: countFormat.format(limits.maxTtlMs / DAY_MS),
  });
}

function isEditableEnvironment(environment: DashboardConsoleEnvironment): boolean {
  return environment.status !== 'ARCHIVED';
}

/** One whole-number field. The label names the input; the hint describes it. */
function LimitField(props: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly placeholder: number;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const hintId = React.useId();
  return (
    <label className="dashboard-form-field">
      <span id={labelId}>{props.label}</span>
      <input
        className="dashboard-input"
        inputMode="numeric"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        value={props.value}
        placeholder={String(props.placeholder)}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="dashboard-form-hint" id={hintId}>
        {props.hint}
      </p>
    </label>
  );
}

function WalletSessionLimitsForm(props: {
  readonly environment: DashboardConsoleEnvironment;
  readonly canEdit: boolean;
  readonly onSaved: (environment: DashboardConsoleEnvironment) => void;
}): React.JSX.Element {
  const { environment, canEdit, onSaved } = props;
  const headingId = React.useId();
  const [fields, setFields] = React.useState<LimitFields>(() =>
    fieldsFor(environment.walletSessionLimits),
  );
  const [save, setSave] = React.useState<SaveState>({ kind: 'idle' });
  const saving = save.kind === 'saving';

  async function store(limits: DashboardWalletSessionLimits | null): Promise<void> {
    setSave({ kind: 'saving' });
    try {
      const saved = await updateDashboardEnvironmentWalletSessionLimits(environment.id, limits);
      setFields(fieldsFor(saved.walletSessionLimits));
      setSave({ kind: 'saved' });
      onSaved(saved);
    } catch (error: unknown) {
      setSave({
        kind: 'error',
        message: error instanceof Error ? error.message : t('walletSessionsSaveFailed'),
      });
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = parseFields(fields);
    if (!parsed.ok) {
      setSave({ kind: 'error', message: parsed.message });
      return;
    }
    void store(parsed.limits);
  }

  return (
    <section className="wallet-sessions-environment" aria-labelledby={headingId}>
      <div className="wallet-sessions-environment-copy">
        <h2 id={headingId}>{environment.name}</h2>
        <p>{limitsSummary(environment.walletSessionLimits)}</p>
      </div>
      <form className="wallet-sessions-form" onSubmit={submit} noValidate>
        <LimitField
          label={t('walletSessionsSignaturesLabel')}
          hint={t('walletSessionsSignaturesHint', {
            max: countFormat.format(MAX_SIGNATURES),
            default: countFormat.format(DEFAULT_SIGNATURES),
          })}
          value={fields.signatures}
          placeholder={DEFAULT_SIGNATURES}
          disabled={!canEdit || saving}
          onChange={(signatures) => setFields((current) => ({ ...current, signatures }))}
        />
        <LimitField
          label={t('walletSessionsDaysLabel')}
          hint={t('walletSessionsDaysHint', { max: MAX_DAYS, default: DEFAULT_DAYS })}
          value={fields.days}
          placeholder={DEFAULT_DAYS}
          disabled={!canEdit || saving}
          onChange={(days) => setFields((current) => ({ ...current, days }))}
        />
        {save.kind === 'error' ? (
          <p
            className="dashboard-form-hint dashboard-form-hint--error wallet-sessions-feedback"
            role="alert"
          >
            {save.message}
          </p>
        ) : null}
        {save.kind === 'saved' ? (
          <p className="dashboard-form-hint wallet-sessions-feedback" role="status">
            {t('walletSessionsSaved')}
          </p>
        ) : null}
        {canEdit ? (
          <div className="dashboard-form-actions">
            <button
              type="submit"
              className="dashboard-pagination-button dashboard-pagination-button--primary"
              disabled={saving}
            >
              {saving ? t('walletSessionsSaving') : t('walletSessionsSave')}
            </button>
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              disabled={saving || environment.walletSessionLimits === null}
              onClick={() => void store(null)}
            >
              {t('walletSessionsUseDefaults')}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export function WalletSessionsPage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const selectedContextDisplay = useDashboardSelectedContextDisplay();
  const projectId = selectedContext.project;
  const [load, setLoad] = React.useState<LoadState>({ kind: 'loading' });
  const canEdit = canDashboardManageProjects(session.claims);

  React.useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    listDashboardEnvironments({ projectId })
      .then((environments) => {
        if (!cancelled) {
          setLoad({ kind: 'ready', environments: environments.filter(isEditableEnvironment) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            kind: 'error',
            message: error instanceof Error ? error.message : t('walletSessionsLoadFailed'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const replaceEnvironment = React.useCallback((saved: DashboardConsoleEnvironment) => {
    setLoad((current) =>
      current.kind === 'ready'
        ? {
            kind: 'ready',
            environments: current.environments.map((environment) =>
              environment.id === saved.id ? saved : environment,
            ),
          }
        : current,
    );
  }, []);

  return (
    <section className="dashboard-view wallet-sessions-page">
      <p className="wallet-sessions-lead">
        {t('walletSessionsLead', { project: selectedContextDisplay.project })}
      </p>
      {!canEdit && !session.loading ? (
        <p className="dashboard-form-alert dashboard-form-alert--notice" role="status">
          {t('walletSessionsReadOnly')}
        </p>
      ) : null}
      {load.kind === 'loading' ? (
        <p className="dashboard-form-hint" role="status">
          {t('walletSessionsLoading')}
        </p>
      ) : null}
      {load.kind === 'error' ? (
        <p className="dashboard-form-alert" role="alert">
          {load.message}
        </p>
      ) : null}
      {load.kind === 'ready' && load.environments.length === 0 ? (
        <p className="dashboard-form-hint">{t('walletSessionsNoEnvironments')}</p>
      ) : null}
      {load.kind === 'ready'
        ? load.environments.map((environment) => (
            <WalletSessionLimitsForm
              key={environment.id}
              environment={environment}
              canEdit={canEdit}
              onSaved={replaceEnvironment}
            />
          ))
        : null}
    </section>
  );
}

export default WalletSessionsPage;
