/**
 * types.ts
 *
 * All shared types, interfaces, and type aliases for the router.
 * No logic lives here — zero imports, no circular dependency risk.
 */

// ---------------------------------------------------------------------------
// URL / Navigation
// ---------------------------------------------------------------------------

/**
 * Parsed URL parameters from a matched route pattern.
 * Keys are named groups (`:id`) or numeric wildcard indices (`0`).
 */
export type RouteParams = Record<string, string | undefined>;

/** Options passed to goto(). */
export interface NavigationOptions {
  /** Use replaceState instead of pushState. Defaults to false. */
  replace?: boolean;
  /** Preserve the current query string. Defaults to false. */
  preserveSearch?: boolean;
  /** State object passed to the history API. */
  state?: unknown;
}

/**
 * Result returned from goto(). Lets callers detect cancellation,
 * redirects, and errors — important for testing navigation guards.
 */
export type NavigationResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'redirected'; to: string }
  | { status: 'error'; error: unknown };

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Return value from an enter() guard:
 *   true / void  → allow navigation
 *   false        → cancel navigation
 *   string       → redirect to this pathname
 */
export type EnterResult = boolean | void | string;

/**
 * Return value from a leave() guard:
 *   true / void  → allow leaving
 *   false        → block navigation
 */
export type LeaveResult = boolean | void;

// ---------------------------------------------------------------------------
// Route configuration
// ---------------------------------------------------------------------------

/** Arbitrary metadata attached to a route and inherited by child routes. */
export interface RouteMeta {
  title?: string;
  [key: string]: unknown;
}

/**
 * A map of outlet name → render callback.
 * Used when a single route populates multiple named regions simultaneously.
 *
 * @example
 * ```ts
 * outlets: {
 *   main:    (p) => html`<dashboard-main .params=${p}></dashboard-main>`,
 *   sidebar: (p) => html`<dashboard-nav></dashboard-nav>`,
 * }
 * ```
 */
export type OutletMap<P extends RouteParams = RouteParams> = Record<
  string,
  (params: P) => unknown
>;

/**
 * A layout wrapper function. Receives the rendered child content and current
 * params, returns the wrapped template.
 *
 * @example
 * ```ts
 * const appLayout: LayoutFn = (outlet, params) =>
 *   html`<app-shell>${outlet}</app-shell>`;
 * ```
 */
export type LayoutFn<P extends RouteParams = RouteParams> = (
  outlet: unknown,
  params: P
) => unknown;

/** Base shape shared by all route config variants. */
export interface BaseRouteConfig<P extends RouteParams = RouteParams> {
  /** Called before entering. Return false to cancel, string to redirect, true/void to proceed. */
  enter?: (params: P) => EnterResult | Promise<EnterResult>;

  /** Called before leaving. Return false to block navigation. */
  leave?: (params: P) => LeaveResult | Promise<LeaveResult>;

  /** Render callback. Receives typed URL params. */
  render?: (params: P) => unknown;

  /**
   * Lazy-load a module exporting a default render function or component.
   * e.g. `() => import('./pages/home.js')`
   */
  component?: () => Promise<{ default: unknown }>;

  /** Declarative redirect — navigating here immediately redirects. */
  redirect?: string;

  /** Optional name for use with `link({ name: 'user', params: { id: '1' } })`. */
  name?: string;

  /**
   * Named outlet render map. Populates multiple named regions simultaneously.
   * If both `render` and `outlets` are present, `outlets` is used for named
   * outlet calls; `render` is used for the default outlet.
   */
  outlets?: OutletMap<P>;

  /**
   * Layout wrapper for this route and all its children.
   * Applied automatically — child routes rendered inside a layout route
   * are wrapped unless they declare their own layout.
   */
  layout?: LayoutFn<P>;

  /** Arbitrary metadata (title, auth requirements, etc). Inherited by children. */
  meta?: RouteMeta;
}

/** Route configured with a path string (converted to URLPattern internally). */
export interface PathRouteConfig<P extends RouteParams = RouteParams>
  extends BaseRouteConfig<P> {
  path: string;
  pattern?: never;
}

/** Route configured directly with a URLPattern instance. */
export interface URLPatternRouteConfig<P extends RouteParams = RouteParams>
  extends BaseRouteConfig<P> {
  pattern: URLPattern;
  path?: never;
}

export type RouteConfig<P extends RouteParams = RouteParams> =
  | PathRouteConfig<P>
  | URLPatternRouteConfig<P>;

/** Options passed to the Routes constructor. */
export interface RoutesOptions {
  fallback?: BaseRouteConfig;
  /**
   * Base path prefix for all routes.
   * Required when the app is deployed at a sub-path (e.g. `/app`).
   */
  basePath?: string;
}

/** Named-route link descriptor. */
export interface NamedLinkDescriptor {
  name: string;
  params?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface NavigationContext {
  from: string | undefined;
  to: string;
  params: RouteParams;
  meta: RouteMeta | undefined;
  /** Call to proceed through the middleware chain. */
  next: () => Promise<void>;
  /** Cancel this navigation. */
  cancel: () => void;
  /** Redirect to another pathname. */
  redirect: (pathname: string) => void;
}

export type NavigationMiddleware = (ctx: NavigationContext) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Sibling communication
// ---------------------------------------------------------------------------

export type SiblingMessageHandler = (message: SiblingMessage) => void | Promise<void>;

export interface SiblingMessage {
  /** The sender Routes controller. */
  from: unknown;
  /** Arbitrary message type — consumers define their own protocol. */
  type: string;
  /** Arbitrary payload. */
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Navigation events
// ---------------------------------------------------------------------------

export type NavigationEventType =
  | 'navigation-start'
  | 'navigation-end'
  | 'navigation-cancel'
  | 'navigation-error'
  | 'navigation-redirect';

export interface NavigationEventDetail {
  from: string | undefined;
  to: string;
  result?: NavigationResult;
  error?: unknown;
}
