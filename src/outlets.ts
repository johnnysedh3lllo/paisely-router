/**
 * outlets.ts
 *
 * Outlet rendering and layout composition.
 *
 * An "outlet" is the rendered output of the current route, injected into
 * the host element's template. This module handles three concerns:
 *
 *   1. Default outlet  — calls route.render(params)
 *   2. Named outlets   — calls route.outlets[name](params), with sibling
 *                        slot coordination to prevent two siblings rendering
 *                        into the same named region
 *   3. Layout wrapping — walks the full ancestor chain and composes all
 *                        layout functions from innermost to outermost
 *
 * These are implemented as standalone functions rather than class methods
 * so they can be read and tested in isolation.
 */

import type { RouteConfig, RouteParams, LayoutFn } from './types.js';

// ---------------------------------------------------------------------------
// Layout composition
// ---------------------------------------------------------------------------

/**
 * Describes one ancestor that contributes a layout.
 * Collected bottom-up then applied top-down.
 */
interface LayoutLayer {
  layout: LayoutFn;
  params: RouteParams;
}

/**
 * Apply all layout wrappers from the ancestor chain to `content`.
 *
 * Walks ancestor routes from innermost (own route) to outermost (root),
 * collecting every `layout` function. Then applies them in that order —
 * innermost wraps the raw content first, outermost is the final shell.
 *
 * There is no depth limit.
 *
 * @param content   - The raw rendered content from route.render().
 * @param route     - The current matched route (may have its own layout).
 * @param params    - Current route params (passed to the route's own layout).
 * @param ancestors - Array of ancestor `{ route, params }` pairs, from
 *                    immediate parent to root. Callers build this by walking
 *                    the _parentRoutes chain.
 */
export const applyLayouts = (
  content: unknown,
  route: RouteConfig | undefined,
  params: RouteParams,
  ancestors: Array<{ route: RouteConfig | undefined; params: RouteParams }>
): unknown => {
  const layers: LayoutLayer[] = [];

  if (route?.layout) {
    layers.push({ layout: route.layout as LayoutFn, params });
  }

  for (const ancestor of ancestors) {
    if (ancestor.route?.layout) {
      layers.push({
        layout: ancestor.route.layout as LayoutFn,
        params: ancestor.params,
      });
    }
  }

  for (const { layout, params: p } of layers) {
    content = layout(content, p);
  }

  return content;
};

// ---------------------------------------------------------------------------
// Default outlet
// ---------------------------------------------------------------------------

/**
 * Render the default outlet for the current route.
 *
 * Returns `previousContent` during a lazy-load transition (while
 * `isPending` is true) to prevent a flash of empty content.
 *
 * On render error, calls `onError` with the thrown error and returns undefined.
 */
export const renderDefaultOutlet = (
  currentRoute: RouteConfig | undefined,
  currentParams: RouteParams,
  isPending: boolean,
  previousContent: unknown,
  onError: (err: unknown) => void,
  applyLayout: (content: unknown) => unknown
): unknown => {
  if (isPending) return previousContent;

  try {
    const content = currentRoute?.render?.(currentParams);
    return applyLayout(content);
  } catch (err) {
    onError(err);
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Named outlet
// ---------------------------------------------------------------------------

/**
 * Render a named outlet for the current route.
 *
 * Enforces slot coordination: if a sibling Routes controller has already
 * claimed this outlet name, returns undefined to yield to that sibling.
 *
 * @param name          - The outlet name (e.g. 'sidebar', 'header').
 * @param currentRoute  - The currently matched route.
 * @param currentParams - Current route params.
 * @param activeOutlets - The Set of outlet names this controller currently owns.
 * @param siblingActiveOutlets - Iterator over sibling controllers' active outlet Sets.
 * @param onError       - Called if the outlet render function throws.
 * @param applyLayout   - Layout composition function (same as default outlet).
 */
export const renderNamedOutlet = (
  name: string,
  currentRoute: RouteConfig | undefined,
  currentParams: RouteParams,
  activeOutlets: Set<string>,
  siblingActiveOutlets: Iterable<Set<string>>,
  onError: (err: unknown) => void,
  applyLayout: (content: unknown) => unknown
): unknown => {
  // Slot coordination: yield if a sibling already owns this slot
  for (const siblingOutlets of siblingActiveOutlets) {
    if (siblingOutlets.has(name)) return undefined;
  }

  const outletFn = currentRoute?.outlets?.[name];
  if (!outletFn) {
    activeOutlets.delete(name);
    return undefined;
  }

  try {
    const content = outletFn(currentParams);
    activeOutlets.add(name);
    return applyLayout(content);
  } catch (err) {
    onError(err);
    activeOutlets.delete(name);
    return undefined;
  }
};
