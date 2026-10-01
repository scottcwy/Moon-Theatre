import { createContext, useContext, type ReactNode } from 'react';

export interface LayoutMetrics {
  statusBarHeight: number;
  navBarHeight: number;
  capsule: {
    top: number;
    right: number;
    width: number;
    height: number;
  };
  tabBarHeight: number;
  safeAreaBottom: number;
}

export const DEFAULT_LAYOUT_METRICS: LayoutMetrics = {
  statusBarHeight: 44,
  navBarHeight: 92,
  capsule: { top: 6, right: 16, width: 87, height: 32 },
  tabBarHeight: 100,
  safeAreaBottom: 34,
};

export type LayoutMetricOverrides = Omit<Partial<LayoutMetrics>, 'capsule'> & {
  capsule?: Partial<LayoutMetrics['capsule']>;
};

const LayoutContext = createContext<LayoutMetrics>(DEFAULT_LAYOUT_METRICS);

export interface LayoutProviderProps {
  children: ReactNode;
  metrics?: LayoutMetricOverrides;
  value?: LayoutMetricOverrides;
}

export function LayoutProvider({ children, metrics: providedMetrics, value }: LayoutProviderProps) {
  const supplied = providedMetrics ?? value;
  const metrics: LayoutMetrics = {
    ...DEFAULT_LAYOUT_METRICS,
    ...supplied,
    capsule: { ...DEFAULT_LAYOUT_METRICS.capsule, ...supplied?.capsule },
  };

  return <LayoutContext.Provider value={metrics}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutMetrics {
  return useContext(LayoutContext);
}
