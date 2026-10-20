// The two deployables built from this codebase (ADR-006). `APP` picks one at startup.

export const APP_NAMES = ["river", "identity"] as const;

export type AppName = (typeof APP_NAMES)[number];

export function isAppName(value: string): value is AppName {
  return (APP_NAMES as readonly string[]).includes(value);
}

/** Each app's local port, so both can run side by side (spec Appendix A). */
export const DEFAULT_PORTS: Record<AppName, number> = { river: 3000, identity: 3001 };
