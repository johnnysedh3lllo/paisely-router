/**
 * lazy.ts
 *
 * Lazy component loading.
 *
 * Routes can defer their render function behind a dynamic import:
 *
 *   { path: '/settings', component: () => import('./pages/settings.js') }
 *
 * On first navigation to such a route, the module is fetched. Its default
 * export is stored back on the route config as a `render` function so that
 * subsequent navigations to the same route skip the load entirely.
 *
 * Key correctness properties:
 *
 *   1. Params are NOT captured in the closure. The stored render function
 *      receives params at call time, not at load time. This prevents a bug
 *      where revisiting the same lazy route with different URL params would
 *      render with stale params.
 *
 *   2. If the load is superseded by a newer navigation (navId mismatch),
 *      we return 'cancelled' immediately without committing anything.
 *
 *   3. On failure, navigation state is NOT committed. The previous route
 *      remains active. The error is exposed via the `componentError` property
 *      on Routes so templates can render a fallback UI.
 */

import type { RouteConfig, RouteParams, BaseRouteConfig } from './types.js';

export interface LazyLoadResult {
  status: 'success' | 'cancelled' | 'error';
  error?: unknown;
}

/**
 * Load a lazy route's component module and attach its render function.
 *
 * @param route           - The route with a `component` factory.
 * @param currentNavId    - The navId at the time this load was initiated.
 * @param getNavId        - Returns the current navId (may have advanced).
 * @param onPending       - Called with `true` when load starts, `false` when done.
 * @returns               - Load outcome.
 */
export const loadLazyComponent = async (
  route: RouteConfig,
  currentNavId: number,
  getNavId: () => number,
  onPending: (pending: boolean) => void
): Promise<LazyLoadResult> => {
  // Only load if there's a component factory and no render function yet
  if (!route.component || route.render) return { status: 'success' };

  onPending(true);

  try {
    const mod = await route.component();

    // Check if a newer navigation started while we were awaiting
    if (currentNavId !== getNavId()) {
      onPending(false);
      return { status: 'cancelled' };
    }

    // Attach the render function to the route for future navigations.
    // The closure captures `defaultExport` but NOT the current `params` —
    // params are passed at render call time to avoid stale closures.
    const defaultExport = mod.default;
    (route as BaseRouteConfig).render = (p: RouteParams) =>
      typeof defaultExport === 'function'
        ? (defaultExport as (p: RouteParams) => unknown)(p)
        : defaultExport;

    onPending(false);
    return { status: 'success' };
  } catch (error) {
    onPending(false);
    return { status: 'error', error };
  }
};
