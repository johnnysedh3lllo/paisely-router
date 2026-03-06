/**
 * matching.ts
 *
 * Route matching — finding which RouteConfig to use for a given pathname.
 *
 * This is intentionally a thin layer. All it knows is:
 *   - Iterate routes in order (first match wins)
 *   - If nothing matches and there's a fallback, synthesise a `/*` route
 *   - Return undefined if nothing matches and there's no fallback
 *
 * The URLPattern testing itself is delegated to patterns.ts (getPattern).
 * Guards, rendering, and state updates live elsewhere.
 */

import type { RouteConfig, BaseRouteConfig } from './types.js';
import { getPattern } from './patterns.js';

/**
 * Find the first route that matches `pathname`.
 *
 * @param routes   - The ordered route config array (first match wins).
 * @param fallback - Optional catch-all route rendered when nothing matches.
 * @param pathname - The sanitized pathname to match against.
 *
 * @returns The matched RouteConfig, or undefined if no route and no fallback.
 */
export const matchRoute = (
  routes: RouteConfig[],
  fallback: BaseRouteConfig | undefined,
  pathname: string
): RouteConfig | undefined => {
  const matched = routes.find((r) => getPattern(r).test({ pathname }));

  if (matched !== undefined) return matched;

  if (fallback === undefined) return undefined;

  // Fallback route behaves like it has path `/*` — the wildcard ensures
  // getTailGroup() produces a tail if needed, and pattern matching succeeds.
  return { ...fallback, path: '/*' } as RouteConfig;
};
