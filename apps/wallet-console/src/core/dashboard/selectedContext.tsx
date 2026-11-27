import React from 'react';
import type { ConsoleNetwork } from '@core/runtime';
import type { DashboardNetworkSwitch } from './layout/AccountMenuToggles';
import type { TopbarContextState } from './types';

/** The selected project has no environment that the selected network can use. */
export type DashboardNoEnvironment = {
  readonly kind: 'none';
  /** The network whose environments the menu shows; null when it shows all of them. */
  readonly network: ConsoleNetwork | null;
  readonly networkSwitch: DashboardNetworkSwitch | null;
};

/** Whether the selected project has an environment that the selected network can use. */
export type DashboardEnvironmentAvailability =
  | { readonly kind: 'loading' }
  | { readonly kind: 'selectable' }
  | DashboardNoEnvironment;

const EMPTY_DASHBOARD_SELECTED_CONTEXT: TopbarContextState = {
  organization: '',
  project: '',
  environment: '',
  accountSettings: '',
};

const LOADING_ENVIRONMENT_AVAILABILITY: DashboardEnvironmentAvailability = { kind: 'loading' };

const DashboardSelectedContext = React.createContext<TopbarContextState>(
  EMPTY_DASHBOARD_SELECTED_CONTEXT,
);
const DashboardSelectedContextDisplay = React.createContext<TopbarContextState>(
  EMPTY_DASHBOARD_SELECTED_CONTEXT,
);
const DashboardEnvironmentAvailabilityContext =
  React.createContext<DashboardEnvironmentAvailability>(LOADING_ENVIRONMENT_AVAILABILITY);

export function DashboardSelectedContextProvider({
  value,
  displayValue,
  environmentAvailability,
  children,
}: {
  value: TopbarContextState;
  displayValue?: TopbarContextState;
  environmentAvailability: DashboardEnvironmentAvailability;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <DashboardSelectedContext.Provider value={value}>
      <DashboardSelectedContextDisplay.Provider value={displayValue || value}>
        <DashboardEnvironmentAvailabilityContext.Provider value={environmentAvailability}>
          {children}
        </DashboardEnvironmentAvailabilityContext.Provider>
      </DashboardSelectedContextDisplay.Provider>
    </DashboardSelectedContext.Provider>
  );
}

export function useDashboardSelectedContext(): TopbarContextState {
  return React.useContext(DashboardSelectedContext);
}

export function useDashboardSelectedContextDisplay(): TopbarContextState {
  return React.useContext(DashboardSelectedContextDisplay);
}

export function useDashboardEnvironmentAvailability(): DashboardEnvironmentAvailability {
  return React.useContext(DashboardEnvironmentAvailabilityContext);
}
