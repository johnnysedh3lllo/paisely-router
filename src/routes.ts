/**
 * routes.ts
 *
 * The Routes reactive controller — the core of the router.
 *
 * Routes is a Lit ReactiveController that:
 *   - Holds route configuration and current navigation state
 *   - Runs the goto() navigation loop (redirect-iterative, concurrency-safe)
 *   - Delegates to feature modules for matching, guards, middleware, lazy
 *     loading, and outlet rendering
 *   - Discovers parent/child Routes controllers via RoutesConnectedEvent
 *   - Exposes a public API for templates: outlet(), link(), isActive(), params
 *
 * Nested routing: child elements can create their own Routes instances.
 * Parent-child relationships are established automatically via DOM events
 * when the host connects — no direct references needed.
 *
 * This file is the Lit adapter layer. The feature modules (matching.ts,
 * guards.ts, etc.) are framework-agnostic pure functions.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  RouteConfig,
  RouteParams,
  NavigationOptions,
  NavigationResult,
  NavigationMiddleware,
  RoutesOptions,
  NamedLinkDescriptor,
  RouteMeta,
  SiblingMessageHandler,
  SiblingMessage,
  BaseRouteConfig,
  PathRouteConfig,
} from './types.js';

import { NavigationEvent, RoutesConnectedEvent } from './events.js';
import { sanitizePathname, resolveRelativePath, getPattern, getTailGroup, isPatternConfig } from './patterns.js';
import { matchRoute } from './matching.js';
import { runMiddlewarePipeline } from './middleware.js';
import { runLeaveGuard, runEnterGuard } from './guards.js';
import { loadLazyComponent } from './lazy.js';
import { applyLayouts, renderDefaultOutlet, renderNamedOutlet } from './outlets.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum redirect hops in a single navigation. Prevents unbounded chains. */
const MAX_REDIRECT_DEPTH = 20;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export class Routes implements ReactiveController {
  // -- Route configuration ---------------------------------------------------

  /**
   * The ordered route config array. First match wins.
   *
   * Mutate via addRoutes() / removeRoute() / setRoutes() to keep the named
   * route index in sync. Direct push() is fine for unnamed routes.
   */
  routes: RouteConfig[] = [];

  /** Rendered when no route matches. Behaves like a `/*` catch-all. */
  fallback: BaseRouteConfig | undefined;

  /** Base path prefix (e.g. `/app`). Stripped before matching. */
  readonly basePath: string;

  // -- Framework adapter -----------------------------------------------------

  protected _host: ReactiveControllerHost & EventTarget;

  // -- Parent / child routing ------------------------------------------------

  protected _parentRoutes: Routes | undefined;
  protected _childRoutes: Routes[] = [];

  // -- Current navigation state ----------------------------------------------

  protected _currentRoute: RouteConfig | undefined;
  protected _currentParams: RouteParams = {};
  protected _currentPathname: string | undefined;
  protected _currentSearch: string = '';
  protected _currentHash: string = '';

  // -- Internal ---------------------------------------------------------------

  /** Incremented on every goto() call. Used to cancel stale async operations. */
  private _navigationId = 0;

  /** Middleware functions applied to every navigation, in insertion order. */
  protected _middleware: NavigationMiddleware[] = [];

  /** Named route index, rebuilt by _buildNamedRouteIndex(). */
  private _namedRoutes = new Map<string, RouteConfig>();

  /** True while a lazy component is being fetched. */
  private _pendingComponent = false;

  /**
   * Set when a lazy component load fails. Exposed via `componentError`.
   * Cleared at the start of the next successful navigation.
   */
  private _componentError: unknown = undefined;

  /** Snapshot of the last rendered outlet content, shown during transitions. */
  private _previousOutlet: unknown = undefined;

  /**
   * The set of named outlet slots this controller currently owns.
   * Used for sibling slot coordination.
   */
  private _activeOutlets = new Set<string>();

  /** Handlers registered via onSiblingMessage(). */
  private _siblingHandlers: SiblingMessageHandler[] = [];

  /** Called by the parent when this controller disconnects. */
  private _onDisconnect: (() => void) | undefined;

  // -- Child discovery -------------------------------------------------------

  private _onRoutesConnected = (e: RoutesConnectedEvent) => {
    if (e.routes === this) return;

    const child = e.routes as Routes;
    this._childRoutes.push(child);
    child._parentRoutes = this;
    e.stopImmediatePropagation();

    e.onDisconnect = () => {
      this._childRoutes.splice(this._childRoutes.indexOf(child) >>> 0, 1);
      // Release outlet slots held by the departing child
      child._activeOutlets.forEach((name) => this._activeOutlets.delete(name));
    };

    // Forward current tail to newly connected child
    const tail = getTailGroup(this._currentParams);
    if (tail !== undefined) child.goto(tail);
  };

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    host: ReactiveControllerHost & EventTarget,
    routes: RouteConfig[],
    options?: RoutesOptions
  ) {
    (this._host = host).addController(this);
    this.basePath = options?.basePath?.replace(/\/$/, '') ?? '';
    this.fallback = options?.fallback;
    this.routes = [...routes];
    this._buildNamedRouteIndex();
  }

  // ---------------------------------------------------------------------------
  // Route mutation API
  // ---------------------------------------------------------------------------

  /**
   * Append routes and rebuild the named route index.
   * Prefer this over `routes.push()` for named routes.
   */
  addRoutes(...newRoutes: RouteConfig[]): this {
    this.routes.push(...newRoutes);
    this._buildNamedRouteIndex();
    return this;
  }

  /** Replace the entire routes array and rebuild the named route index. */
  setRoutes(routes: RouteConfig[]): this {
    this.routes = [...routes];
    this._buildNamedRouteIndex();
    return this;
  }

  /** Remove a route by reference and rebuild the named route index. */
  removeRoute(route: RouteConfig): this {
    const idx = this.routes.indexOf(route);
    if (idx !== -1) this.routes.splice(idx, 1);
    this._buildNamedRouteIndex();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigate to `pathname`.
   *
   * Runs the full navigation lifecycle:
   *   sanitize → match → leave guard → middleware → enter guard
   *   → lazy load → commit state → propagate tail → re-render
   *
   * All redirect sources (declarative redirect:, enter() string return,
   * middleware ctx.redirect()) are resolved in an iterative loop — no
   * recursion, no call-stack growth, no risk of stack overflow.
   *
   * Concurrent safety: each call increments _navigationId. Any async
   * operation that resolves and finds a different _navigationId returns
   * 'cancelled' immediately without committing state.
   */
  async goto(
    pathname: string,
    options: NavigationOptions = {},
    _activeMiddleware: NavigationMiddleware[] | undefined = undefined
  ): Promise<NavigationResult> {
    const navId = ++this._navigationId;
    const middleware = _activeMiddleware ?? this._middleware;

    // Redirect resolution is iterative. Each `continue redirectLoop` replaces
    // targetPathname and loops back to the top. The cycle detector and depth
    // cap ensure termination.
    const redirectChain = new Set<string>();
    let targetPathname = pathname;

    redirectLoop: while (true) {
      const safe = sanitizePathname(targetPathname);
      const [pathOnly, searchAndHash = ''] = safe.split(/(?=[?#])/);
      const search = searchAndHash.startsWith('?')
        ? searchAndHash.split('#')[0]
        : options.preserveSearch
        ? this._currentSearch
        : '';
      const hash = safe.includes('#') ? '#' + safe.split('#')[1] : '';

      // Depth cap — catches non-cyclic but unbounded chains
      if (redirectChain.size >= MAX_REDIRECT_DEPTH) {
        const err = new Error(
          `Redirect depth limit (${MAX_REDIRECT_DEPTH}) exceeded navigating to "${pathOnly}". ` +
          `Chain: ${[...redirectChain].join(' → ')}`
        );
        this._host.dispatchEvent(
          new NavigationEvent('navigation-error', { from: this._currentPathname, to: pathOnly, error: err })
        );
        return { status: 'error', error: err };
      }

      const from = this._currentPathname;

      // navigation-start fires once per user-initiated navigation, not on each redirect hop
      if (redirectChain.size === 0) {
        this._host.dispatchEvent(
          new NavigationEvent('navigation-start', { from, to: pathOnly })
        );
      }

      // -- Empty controller: pass everything as a tail to children -----------
      if (this.routes.length === 0 && this.fallback === undefined) {
        this._currentPathname = '';
        this._currentSearch = search;
        this._currentHash = hash;
        this._currentParams = { 0: pathOnly };

        if (navId !== this._navigationId) return { status: 'cancelled' };

        await this._propagateTail(pathOnly);
        this._host.requestUpdate();
        return { status: 'success' };
      }

      // -- Match -------------------------------------------------------------
      const route = matchRoute(this.routes, this.fallback, pathOnly);
      if (route === undefined) {
        const err = new Error(`No route found for ${pathOnly}`);
        this._host.dispatchEvent(
          new NavigationEvent('navigation-error', { from, to: pathOnly, error: err })
        );
        return { status: 'error', error: err };
      }

      // -- Declarative redirect ----------------------------------------------
      if (route.redirect) {
        const target = route.redirect;
        if (redirectChain.has(target)) {
          const err = new Error(`Redirect cycle detected: ${[...redirectChain, target].join(' → ')}`);
          this._host.dispatchEvent(
            new NavigationEvent('navigation-error', { from, to: target, error: err })
          );
          return { status: 'error', error: err };
        }
        redirectChain.add(pathOnly);
        this._host.dispatchEvent(new NavigationEvent('navigation-redirect', { from, to: target }));
        targetPathname = target;
        continue redirectLoop;
      }

      // -- Extract params and tail -------------------------------------------
      const pattern = getPattern(route);
      const matchResult = pattern.exec({ pathname: pathOnly });
      const params: RouteParams = matchResult?.pathname.groups ?? {};
      const tailGroup = getTailGroup(params);

      // -- Leave guard -------------------------------------------------------
      const leaveResult = await runLeaveGuard(this._currentRoute, this._currentParams);
      if (!leaveResult.allowed) {
        if (leaveResult.error) return { status: 'error', error: leaveResult.error };
        this._host.dispatchEvent(new NavigationEvent('navigation-cancel', { from, to: pathOnly }));
        return { status: 'cancelled' };
      }

      if (navId !== this._navigationId) return { status: 'cancelled' };

      // -- Middleware pipeline -----------------------------------------------
      const mwResult = await runMiddlewarePipeline({
        middleware,
        from,
        to: pathOnly,
        params,
        meta: route.meta,
      });

      if (mwResult.result.status === 'cancelled') {
        this._host.dispatchEvent(new NavigationEvent('navigation-cancel', { from, to: pathOnly }));
        return mwResult.result;
      }

      if (mwResult.result.status === 'redirected' && mwResult.redirectTarget) {
        const target = mwResult.redirectTarget;
        if (redirectChain.has(target)) {
          const err = new Error(`Redirect cycle detected: ${[...redirectChain, target].join(' → ')}`);
          this._host.dispatchEvent(
            new NavigationEvent('navigation-error', { from, to: target, error: err })
          );
          return { status: 'error', error: err };
        }
        redirectChain.add(pathOnly);
        this._host.dispatchEvent(new NavigationEvent('navigation-redirect', { from, to: target }));
        targetPathname = target;
        continue redirectLoop;
      }

      if (navId !== this._navigationId) return { status: 'cancelled' };

      // -- Enter guard -------------------------------------------------------
      const enterOutcome = await runEnterGuard(route, params);

      if (navId !== this._navigationId) return { status: 'cancelled' };

      if (enterOutcome.type === 'cancel') {
        this._host.dispatchEvent(new NavigationEvent('navigation-cancel', { from, to: pathOnly }));
        return { status: 'cancelled' };
      }

      if (enterOutcome.type === 'error') {
        this._host.dispatchEvent(
          new NavigationEvent('navigation-error', { from, to: pathOnly, error: enterOutcome.error })
        );
        return { status: 'error', error: enterOutcome.error };
      }

      if (enterOutcome.type === 'redirect') {
        const target = enterOutcome.target;
        if (redirectChain.has(target)) {
          const err = new Error(`Redirect cycle detected: ${[...redirectChain, target].join(' → ')}`);
          this._host.dispatchEvent(
            new NavigationEvent('navigation-error', { from, to: target, error: err })
          );
          return { status: 'error', error: err };
        }
        redirectChain.add(pathOnly);
        this._host.dispatchEvent(new NavigationEvent('navigation-redirect', { from, to: target }));
        targetPathname = target;
        continue redirectLoop;
      }

      // -- Lazy component load -----------------------------------------------
      if (route.component && !route.render) {
        this._pendingComponent = true;
        this._componentError = undefined;
        this._host.requestUpdate();

        const lazyResult = await loadLazyComponent(
          route,
          navId,
          () => this._navigationId,
          (pending) => { this._pendingComponent = pending; }
        );

        if (lazyResult.status === 'cancelled') return { status: 'cancelled' };

        if (lazyResult.status === 'error') {
          this._componentError = lazyResult.error;
          this._host.requestUpdate();
          this._host.dispatchEvent(
            new NavigationEvent('navigation-error', { from, to: pathOnly, error: lazyResult.error })
          );
          return { status: 'error', error: lazyResult.error };
        }
      }

      // Clear any prior load error before committing
      this._componentError = undefined;

      // -- Commit state ------------------------------------------------------
      this._previousOutlet = this._currentRoute?.render?.(this._currentParams);
      this._currentRoute = route;
      this._currentParams = params;
      this._currentSearch = search;
      this._currentHash = hash;
      this._currentPathname =
        tailGroup === undefined
          ? pathOnly
          : pathOnly.substring(0, pathOnly.length - tailGroup.length);

      if (route.meta?.title && typeof document !== 'undefined') {
        document.title = String(route.meta.title);
      }

      // navId check before propagation: a newer goto() may have fired during
      // guards or lazy loading. Don't send stale tail data to children.
      if (navId !== this._navigationId) return { status: 'cancelled' };

      await this._propagateTail(tailGroup);
      this._host.requestUpdate();

      this._host.dispatchEvent(
        new NavigationEvent('navigation-end', { from, to: pathOnly, result: { status: 'success' } })
      );

      return { status: 'success' };
    } // end redirectLoop
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns a full URL string for the given pathname or named route,
   * prefixed with any parent route paths.
   *
   * Supports:
   *   - Absolute paths:  link('/foo')
   *   - Relative paths:  link('./child'), link('../sibling')
   *   - Named routes:    link({ name: 'user', params: { id: '1' } })
   */
  link(pathname?: string | NamedLinkDescriptor): string {
    if (typeof pathname === 'object') return this._namedLink(pathname);

    if (pathname === undefined) {
      return (this._parentRoutes?.link() ?? this.basePath) + (this._currentPathname ?? '');
    }

    if (pathname.startsWith('/')) return this.basePath + pathname;

    if (pathname.startsWith('.')) {
      const resolved = resolveRelativePath(this._currentPathname ?? '/', pathname);
      return (this._parentRoutes?.link() ?? this.basePath) + resolved;
    }

    return (this._parentRoutes?.link() ?? this.basePath) + pathname;
  }

  /**
   * Returns true if `pathname` matches the currently active route.
   * Pass `exact: false` for prefix matching (useful for nav section links).
   */
  isActive(pathname: string, { exact = true }: { exact?: boolean } = {}): boolean {
    const current = this._currentPathname ?? '';
    return exact ? current === pathname : current.startsWith(pathname);
  }

  /**
   * Returns the rendered content for the current route.
   *
   * - `outlet()`        — default outlet (route.render callback)
   * - `outlet('name')`  — named outlet (route.outlets[name] callback)
   *
   * Named outlets allow a route to populate multiple independent regions
   * (sidebar, main, header, etc.) simultaneously.
   *
   * All outlets automatically apply ancestor layout wrappers.
   * During lazy-load transitions the default outlet returns the previous
   * content to prevent a flash of empty content.
   */
  outlet(name?: string): unknown {
    const ancestorChain = this._buildAncestorChain();

    const layoutWrapper = (content: unknown) =>
      applyLayouts(content, this._currentRoute, this._currentParams, ancestorChain);

    if (name !== undefined) {
      const siblingOutlets = this._childRoutes
        .filter((c) => c !== this)
        .map((c) => c._activeOutlets);

      return renderNamedOutlet(
        name,
        this._currentRoute,
        this._currentParams,
        this._activeOutlets,
        siblingOutlets,
        (err) => this._dispatchRenderError(err),
        layoutWrapper
      );
    }

    return renderDefaultOutlet(
      this._currentRoute,
      this._currentParams,
      this._pendingComponent,
      this._previousOutlet,
      (err) => this._dispatchRenderError(err),
      layoutWrapper
    );
  }

  /** Current parsed route parameters. */
  get params(): RouteParams { return this._currentParams; }

  /** Current query string (including leading `?`). */
  get search(): string { return this._currentSearch; }

  /** Parsed URLSearchParams for the current query string. */
  get searchParams(): URLSearchParams { return new URLSearchParams(this._currentSearch); }

  /** Current hash fragment (including leading `#`). */
  get hash(): string { return this._currentHash; }

  /** True while a lazy-loaded component is being fetched. */
  get isPending(): boolean { return this._pendingComponent; }

  /**
   * The error from the most recent failed lazy component load.
   * Undefined if the last load succeeded.
   * Cleared automatically on the next successful navigation.
   *
   * @example
   * ```ts
   * render() {
   *   if (this._routes.componentError) {
   *     return html`<p>Failed to load page. <a href="/">Go home</a></p>`;
   *   }
   *   return html`${this._routes.outlet()}`;
   * }
   * ```
   */
  get componentError(): unknown { return this._componentError; }

  /**
   * The meta object of the current route, merged with parent meta.
   * Child meta overrides parent meta on conflicting keys.
   */
  get currentMeta(): RouteMeta | undefined {
    const parentMeta = this._parentRoutes?.currentMeta;
    const routeMeta = this._currentRoute?.meta;
    if (!parentMeta && !routeMeta) return undefined;
    return { ...parentMeta, ...routeMeta };
  }

  /** Add middleware to the navigation pipeline. Runs in insertion order. */
  use(...middleware: NavigationMiddleware[]): this {
    this._middleware.push(...middleware);
    return this;
  }

  /**
   * Prefetch a lazy route's component without navigating to it.
   * Useful for hover-intent preloading.
   */
  async prefetch(pathname: string): Promise<void> {
    const route = matchRoute(this.routes, this.fallback, pathname);
    if (route?.component && !route.render) {
      try { await route.component(); } catch { /* silent — will surface on actual navigation */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Sibling communication
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for messages from sibling Routes controllers
   * that share the same parent.
   *
   * @returns An unsubscribe function.
   */
  onSiblingMessage(handler: SiblingMessageHandler): () => void {
    this._siblingHandlers.push(handler);
    return () => {
      this._siblingHandlers.splice(this._siblingHandlers.indexOf(handler) >>> 0, 1);
    };
  }

  /**
   * Broadcast a message to all sibling Routes controllers.
   * The sender does not receive its own message.
   */
  broadcastToSiblings(message: Omit<SiblingMessage, 'from'>): void {
    if (!this._parentRoutes) return;

    const full: SiblingMessage = { ...message, from: this };

    for (const sibling of this._parentRoutes._childRoutes) {
      if (sibling === this) continue;
      for (const handler of sibling._siblingHandlers) {
        try { handler(full); }
        catch (err) { console.error('[Router] sibling message handler error:', err); }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lit ReactiveController lifecycle
  // ---------------------------------------------------------------------------

  hostConnected(): void {
    this._host.addEventListener(
      RoutesConnectedEvent.eventName,
      this._onRoutesConnected as EventListener
    );
    const event = new RoutesConnectedEvent(this);
    this._host.dispatchEvent(event);
    this._onDisconnect = event.onDisconnect;
  }

  hostDisconnected(): void {
    this._onDisconnect?.();
    this._parentRoutes = undefined;
    this._host.removeEventListener(
      RoutesConnectedEvent.eventName,
      this._onRoutesConnected as EventListener
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _propagateTail(tail: string | undefined): Promise<void> {
    if (tail !== undefined) {
      await Promise.all(this._childRoutes.map((child) => child.goto(tail!)));
    }
  }

  private _buildNamedRouteIndex(): void {
    this._namedRoutes.clear();
    for (const route of this.routes) {
      if (route.name) this._namedRoutes.set(route.name, route);
    }
  }

  private _namedLink(descriptor: NamedLinkDescriptor): string {
    const route = this._namedRoutes.get(descriptor.name);
    if (!route) throw new Error(`No route named "${descriptor.name}"`);

    if (isPatternConfig(route)) {
      throw new Error('Named link for URLPattern routes is not supported');
    }

    let path = (route as PathRouteConfig).path;
    if (descriptor.params) {
      for (const [key, value] of Object.entries(descriptor.params)) {
        path = path.replace(`:${key}`, encodeURIComponent(value));
      }
    }
    return this.link(path.replace(/\/\*$/, ''));
  }

  /**
   * Build the ancestor chain for layout composition.
   * Returns an array from immediate parent to root, each with their
   * current route and params.
   */
  private _buildAncestorChain(): Array<{ route: RouteConfig | undefined; params: RouteParams }> {
    const ancestors: Array<{ route: RouteConfig | undefined; params: RouteParams }> = [];
    let ancestor = this._parentRoutes;
    while (ancestor) {
      ancestors.push({ route: ancestor._currentRoute, params: ancestor._currentParams });
      ancestor = ancestor._parentRoutes;
    }
    return ancestors;
  }

  private _dispatchRenderError(error: unknown): void {
    this._host.dispatchEvent(
      new NavigationEvent('navigation-error', {
        from: this._currentPathname,
        to: this._currentPathname ?? '',
        error,
      })
    );
  }
}
