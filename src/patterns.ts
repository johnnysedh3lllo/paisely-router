/**
 * patterns.ts
 *
 * URL pattern management and pathname utilities.
 *
 * Responsibilities:
 *   - Cache URLPattern instances (creation is expensive; reuse is free)
 *   - Resolve which routes are pattern-based vs path-string-based
 *   - Extract wildcard tail groups from match results
 *   - Sanitize incoming pathnames against open-redirect / XSS
 *   - Resolve relative pathnames (../sibling, ./child) against a base
 *
 * All exports are pure functions. No class references, no side effects.
 */

import type { RouteConfig, RouteParams, PathRouteConfig, URLPatternRouteConfig } from './types.js';

// ---------------------------------------------------------------------------
// Pattern cache
// ---------------------------------------------------------------------------

/**
 * WeakMap cache of URLPattern instances for PathRouteConfig objects.
 *
 * URLPattern construction has measurable cost. By keying on the route
 * config object itself (which is stable across navigations), we create
 * each pattern at most once per route.
 */
const patternCache = new WeakMap<PathRouteConfig, URLPattern>();

/** True if this route was configured with an explicit URLPattern. */
export const isPatternConfig = (
  route: RouteConfig
): route is URLPatternRouteConfig =>
  (route as URLPatternRouteConfig).pattern !== undefined;

/**
 * Returns the URLPattern for a route, creating and caching it if needed.
 */
export const getPattern = (route: RouteConfig): URLPattern => {
  if (isPatternConfig(route)) return route.pattern;

  let pattern = patternCache.get(route as PathRouteConfig);
  if (pattern === undefined) {
    patternCache.set(
      route as PathRouteConfig,
      (pattern = new URLPattern({ pathname: (route as PathRouteConfig).path }))
    );
  }
  return pattern;
};

// ---------------------------------------------------------------------------
// Tail group extraction
// ---------------------------------------------------------------------------

/**
 * Returns the tail wildcard group from a URLPattern match result.
 *
 * When a route has a trailing `/*`, the matched remainder is stored
 * as a numeric key in the groups object (e.g. `{ '0': '/rest/of/path' }`).
 * This tail is forwarded to child Routes controllers for nested routing.
 *
 * We find the highest numeric key to support patterns with multiple
 * wildcard segments (though in practice only one tail group is used).
 */
export const getTailGroup = (groups: RouteParams): string | undefined => {
  let tailKey: string | undefined;

  for (const key of Object.keys(groups)) {
    if (/^\d+$/.test(key) && (tailKey === undefined || key > tailKey)) {
      tailKey = key;
    }
  }

  return tailKey !== undefined ? groups[tailKey] : undefined;
};

// ---------------------------------------------------------------------------
// Pathname sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a pathname before use in goto() or history manipulation.
 *
 * Attack vectors closed:
 *   "//evil.com"      — protocol-relative URL (parses host as evil.com)
 *   "https://evil.com" — absolute URL
 *   "javascript:..."  — protocol injection
 *   ""                — empty string (ambiguous)
 *
 * Strategy: require a single leading `/` before delegating to `new URL()`
 * for normalisation (percent-encoding, dot-segment removal). The `new URL()`
 * call is defence-in-depth only — the prefix check is the real guard.
 */
export const sanitizePathname = (pathname: string): string => {
  const trimmed = pathname.trim();

  // Must start with exactly one `/`. Catches `//`, absolute URLs, empty strings.
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/';
  }

  try {
    const url = new URL(trimmed, 'http://localhost');
    // Defence-in-depth: if the parser somehow resolved a different host, bail.
    if (url.host !== 'localhost') return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
};

// ---------------------------------------------------------------------------
// Relative path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a relative path segment (e.g. `../sibling`, `./child`) against
 * a base pathname.
 *
 * Rules:
 *   - Absolute paths (starting with `/`) are returned as-is.
 *   - `..` traversal is clamped at the root — cannot go above `/`.
 *   - `.` and empty segments are skipped.
 *   - Base is treated as a directory, so the last segment is popped first
 *     (consistent with browser URL resolution).
 *
 * @example
 *   resolveRelativePath('/users/123', '../settings') → '/settings'
 *   resolveRelativePath('/a/b/c',    '../../x')      → '/x'
 *   resolveRelativePath('/',         '../escape')    → '/escape' (clamped)
 */
export const resolveRelativePath = (base: string, relative: string): string => {
  if (relative.startsWith('/')) return relative;

  // Filter empty segments so `'/'` doesn't produce `['', '']`
  const stack = base.split('/').filter(Boolean);

  // Treat base as a directory — drop the trailing filename/segment
  if (stack.length > 0) stack.pop();

  for (const part of relative.split('/')) {
    if (part === '..') {
      // Explicit clamp: `..` at root is a no-op, not an error
      if (stack.length > 0) stack.pop();
    } else if (part !== '.' && part !== '') {
      stack.push(part);
    }
  }

  return '/' + stack.join('/');
};
