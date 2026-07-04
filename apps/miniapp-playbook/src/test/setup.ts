import { vi } from 'vitest';

vi.stubGlobal('defineAppConfig', (config: Record<string, unknown>) => config);
vi.stubGlobal('definePageConfig', (config: Record<string, unknown>) => config);
