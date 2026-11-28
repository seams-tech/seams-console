import { buildHostedAuthMenuOpenRequest, hostedAuthMenuSessionIdFromBoundary } from '@seams/mpc-wallet/client';
import type { HostedAuthMenuMode } from '@seams/mpc-wallet/react';
import React from 'react';
import '@wallet-ui/sdk/wallet-ui.css';
import {
  mountAuthMenuSurface,
  type AuthMenuSurfaceHandle,
} from '@wallet-ui/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface';
import type { AuthMenuViewModel } from '@wallet-ui/SeamsWeb/walletIframe/host/auth-menu/domain';
import type { AppearanceConfig } from '@wallet-ui/core/types/seams';
import { SITE_APPEARANCE } from '@/context/siteThemeOverrides';

type AuthMenuPreviewProps = {
  readonly initialMode: HostedAuthMenuMode;
  /** False while the hosted menu opens over it: the preview is then only a picture. */
  readonly usable: boolean;
  /**
   * Called on the first use of the preview, with the preview's height. The caller
   * then mounts the hosted menu at that height.
   */
  readonly onUse: (previewHeightCssPx: number) => void;
};

const PREVIEW_APPEARANCE: AppearanceConfig = SITE_APPEARANCE;

function previewSessionId() {
  const id = hostedAuthMenuSessionIdFromBoundary('landing-auth-menu-preview');
  if (!id) throw new Error('Landing auth-menu preview identity is invalid');
  return id;
}

/**
 * The hosted menu's first view, drawn from the same copy the wallet host uses.
 * It carries no wallet logic, so the landing page loads no wallet runtime, crypto
 * worker or Google script until a visitor uses the demo.
 */
function previewViewModel(initialMode: HostedAuthMenuMode) {
  const request = buildHostedAuthMenuOpenRequest({
    authMenuSessionId: previewSessionId(),
    initialMode,
    registrationAccountInput: 'implicit_wallet',
    showRegistrationInput: false,
    enabledExternalProviders: ['google'],
  });
  const modeCopy = request.copy[initialMode];
  const common = {
    kind: 'passkey' as const,
    appearance: PREVIEW_APPEARANCE,
    hostname: window.location.hostname,
    closeLabel: request.copy.common.closeLabel,
    heading: modeCopy.title,
    subtitle: modeCopy.subtitle,
    ctaLabel: modeCopy.passkeyCta,
    showProgress: false,
    enabledExternalProviders: request.enabledExternalProviders,
    status: { kind: 'idle' as const, interaction: 'actionable' as const },
  };
  const viewModel: AuthMenuViewModel =
    initialMode === 'register'
      ? {
          ...common,
          mode: 'register',
          showRegistrationInput: false,
          passkeyNameReadOnly: true,
          passkeyName: '',
          passkeyNameLabel: request.copy.register.passkeyNameLabel,
        }
      : { ...common, mode: 'login', accountOptions: [], selectedAccount: null };
  return viewModel;
}

function reportUse(
  parentRef: React.RefObject<HTMLDivElement | null>,
  onUse: AuthMenuPreviewProps['onUse'],
): void {
  // The layout height: the hero's scale transform changes the painted height only,
  // and the hosted menu's anchor takes its height in layout pixels.
  if (parentRef.current) onUse(parentRef.current.offsetHeight);
}

function mountPreview(
  parentRef: React.RefObject<HTMLDivElement | null>,
  initialMode: HostedAuthMenuMode,
  onUse: () => void,
): () => void {
  const parent = parentRef.current;
  if (!parent) return noop;
  // The surface focuses its first control when it mounts; an inert parent keeps the
  // page's focus where it is, as the showcase does.
  parent.inert = true;
  const handle: AuthMenuSurfaceHandle = mountAuthMenuSurface({
    parent,
    viewModel: previewViewModel(initialMode),
    onIntent: onUse,
  });
  parent.inert = false;
  return handle.dispose.bind(handle);
}

function noop(): void {}

function syncPreviewInert(parentRef: React.RefObject<HTMLDivElement | null>, usable: boolean): void {
  // React 18 has no inert prop; set the property on the element.
  if (parentRef.current) parentRef.current.inert = !usable;
}

export function AuthMenuPreview({ initialMode, usable, onUse }: AuthMenuPreviewProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const use = React.useCallback(reportUse.bind(null, parentRef, onUse), [onUse]);
  // The preview mounts once per mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(mountPreview.bind(null, parentRef, initialMode, use), [initialMode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(syncPreviewInert.bind(null, parentRef, usable), [usable]);
  return (
    <div
      ref={parentRef}
      className="landing-auth-menu-preview"
      aria-hidden={usable ? undefined : true}
      onPointerEnter={usable ? use : undefined}
      onPointerDown={usable ? use : undefined}
      onKeyDown={usable ? use : undefined}
    />
  );
}
