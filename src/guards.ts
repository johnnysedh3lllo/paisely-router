/**
 * guards.ts
 *
 * Navigation guard execution — enter() and leave().
 *
 * Guards are per-route lifecycle hooks:
 *
 *   leave()  — called on the *current* route before navigating away.
 *              Returning false blocks the navigation.
 *
 *   enter()  — called on the *target* route before committing.
 *              Returning false cancels, returning a string redirects.
 *
 * Both are async-safe. If a guard throws, the error is surfaced as
 * a navigation-error result rather than an unhandled rejection.
 *
 * Guards are intentionally separate from middleware: middleware runs
 * globally (every navigation), guards run per-route (only when that
 * specific route is being entered or left).
 */

import type { RouteConfig, RouteParams, NavigationResult } from './types.js';

// ---------------------------------------------------------------------------
// Leave guard
// ---------------------------------------------------------------------------

export interface LeaveGuardResult {
  allowed: boolean;
  error?: unknown;
}

/**
 * Run the leave() guard on `currentRoute` (if any).
 *
 * @returns `{ allowed: true }` if navigation may proceed,
 *          `{ allowed: false }` if the guard blocked it,
 *          `{ allowed: false, error }` if the guard threw.
 */
export const runLeaveGuard = async (
  currentRoute: RouteConfig | undefined,
  currentParams: RouteParams
): Promise<LeaveGuardResult> => {
  if (!currentRoute?.leave) return { allowed: true };

  try {
    const result = await currentRoute.leave(currentParams);
    return { allowed: result !== false };
  } catch (error) {
    return { allowed: false, error };
  }
};

// ---------------------------------------------------------------------------
// Enter guard
// ---------------------------------------------------------------------------

export type EnterGuardOutcome =
  | { type: 'allow' }
  | { type: 'cancel' }
  | { type: 'redirect'; target: string }
  | { type: 'error'; error: unknown };

/**
 * Run the enter() guard on `route` (if any).
 *
 * @returns An outcome descriptor:
 *   allow    — proceed with navigation
 *   cancel   — guard returned false
 *   redirect — guard returned a string pathname
 *   error    — guard threw
 */
export const runEnterGuard = async (
  route: RouteConfig,
  params: RouteParams
): Promise<EnterGuardOutcome> => {
  if (typeof route.enter !== 'function') return { type: 'allow' };

  try {
    const result = await route.enter(params);

    if (result === false) return { type: 'cancel' };
    if (typeof result === 'string') return { type: 'redirect', target: result };
    return { type: 'allow' };
  } catch (error) {
    return { type: 'error', error };
  }
};
