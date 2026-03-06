/**
 * router.ts
 *
 * The Router class — the top-level browser integration layer.
 *
 * Router extends Routes and adds everything that touches browser globals:
 *
 *   History API     — pushState / replaceState, popstate listener
 *   Click interception — intercepts same-origin <a> clicks
 *   Hash mode       — routes via URL fragment instead of pathname
 *   basePath        — app deployed at a sub-path (e.g. /my-app/)
 *   Scroll          — restore to top on new navigations, or to hash target
 *   Focus           — move keyboard focus after route change (a11y)
 *   ARIA announcer  — live region for screen reader route announcements
 *   aria-current    — marks matching anchors with aria-current="page"
 *   beforeunload    — native dialog when current route has a leave guard
 *   beforeEach      — global navigation middleware
 *   afterEach       — post-navigation callbacks
 *   Singleton check — one Router per page; throws if a second connects
 *   Debug logging   — opt-in console output
 *
 * There should be exactly one Router per page. Use Routes for nested
 * sub-routing within child elements.
 */

import type { ReactiveControllerHost } from 'lit';
import { Routes } from './routes.js';
import type {
  RouteConfig,
  RoutesOptions,
  NavigationOptions,
  NavigationResult,
  NavigationMiddleware,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterOptions extends RoutesOptions {
  /**
   * 'history' — HTML5 pushState (default)
   * 'hash'    — hash-based routing (e.g. /#/about)
   */
  mode?: 'history' | 'hash';

  /** Global error handler for unhandled navigation errors. */
  onError?: (error: unknown, pathname: string) => void;

  /** Log all navigation events to the console. Development only. */
  debug?: boolean;

  /**
   * Suppress the one-Router-per-page singleton check.
   * Only set this in test environments.
   */
  allowMultiple?: boolean;
}

// ---------------------------------------------------------------------------
// Singleton registry
// ---------------------------------------------------------------------------

/**
 * One Router per browsing context. Keyed by globalThis so the entry is
 * garbage-collected when the host element is removed.
 */
const _routerRegistry = new WeakMap<typeof globalThis, Router>();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class Router extends Routes {
  private readonly _mode: 'history' | 'hash';
  private readonly _onError: RouterOptions['onError'];
  private readonly _debug: boolean;
  private readonly _allowMultiple: boolean;

  /**
   * Cached once at construction. window/document presence never changes
   * mid-session, so re-checking on every call is unnecessary.
   */
  private readonly _browser: boolean;

  private _beforeEachHooks: NavigationMiddleware[] = [];
  private _afterEachHooks: Array<(result: NavigationResult) => void | Promise<void>> = [];

  private _announcer: HTMLElement | undefined;
  private _focusTarget: string | undefined;

  // ---------------------------------------------------------------------------
  // Event handlers (arrow functions preserve `this` without .bind())
  // ---------------------------------------------------------------------------

  private _onClick = (e: MouseEvent): void => {
    const isNonNav = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey;
    if (e.defaultPrevented || isNonNav) return;

    const anchor = e
      .composedPath()
      .find((n): n is HTMLAnchorElement => (n as Element).tagName === 'A');

    if (
      anchor === undefined ||
      anchor.target !== '' ||
      anchor.hasAttribute('download') ||
      anchor.getAttribute('rel') === 'external'
    ) return;

    const href = anchor.href;
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (anchor.origin !== this._origin) return;

    // In hash+basePath mode, only intercept links whose static pathname
    // matches our base. Links to other static paths on the same origin
    // (e.g. a docs section) should pass through.
    if (this._mode === 'hash' && this.basePath) {
      if (!anchor.pathname.startsWith(this.basePath)) return;
    }

    e.preventDefault();

    const options: NavigationOptions = {
      replace: anchor.hasAttribute('data-replace'),
      preserveSearch: anchor.hasAttribute('data-preserve-search'),
    };

    const destination =
      this._mode === 'hash'
        ? anchor.hash.slice(1) || '/'
        : anchor.pathname + anchor.search + anchor.hash;

    if (destination !== this._currentHref) {
      this._navigate(destination, options);
    }
  };

  private _onPopState = (_e: PopStateEvent): void => {
    this._navigate(this._getLocationPathname(), { replace: true });
  };

  private _onBeforeUnload = (e: BeforeUnloadEvent): void => {
    // Cannot run the async leave() guard here — browsers disallow async
    // in beforeunload. If the current route declares a leave guard, trigger
    // the browser's native "Leave site?" dialog instead.
    if (this._currentRoute?.leave) {
      e.preventDefault();
      e.returnValue = ''; // legacy cross-browser support
    }
  };

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    host: ReactiveControllerHost & EventTarget,
    routes: RouteConfig[],
    options: RouterOptions = {}
  ) {
    super(host, routes, options);
    this._browser = typeof window !== 'undefined' && typeof document !== 'undefined';
    this._mode = options.mode ?? 'history';
    this._onError = options.onError;
    this._debug = options.debug ?? false;
    this._allowMultiple = options.allowMultiple ?? false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Register a global guard that runs before every navigation. */
  beforeEach(middleware: NavigationMiddleware): this {
    this._beforeEachHooks.push(middleware);
    return this;
  }

  /** Register a callback invoked after every completed navigation. */
  afterEach(cb: (result: NavigationResult) => void | Promise<void>): this {
    this._afterEachHooks.push(cb);
    return this;
  }

  /** Navigate back in history. */
  back(): void { if (this._browser) window.history.back(); }

  /** Navigate forward in history. */
  forward(): void { if (this._browser) window.history.forward(); }

  /**
   * Set the CSS selector for the element that receives focus after navigation.
   * Defaults to `'main, [autofocus], body'`.
   */
  setFocusTarget(selector: string): this {
    this._focusTarget = selector;
    return this;
  }

  // ---------------------------------------------------------------------------
  // goto() override — compose global middleware, run afterEach
  // ---------------------------------------------------------------------------

  /**
   * Navigate to `pathname`.
   *
   * Composes beforeEach hooks with instance middleware into a single
   * immutable local slice and passes it to Routes.goto(). Each concurrent
   * navigation gets its own snapshot — shared state is never mutated.
   */
  override async goto(
    pathname: string,
    options: NavigationOptions = {},
    _activeMiddleware: NavigationMiddleware[] | undefined = undefined
  ): Promise<NavigationResult> {
    const composed: NavigationMiddleware[] =
      _activeMiddleware ?? [...this._beforeEachHooks, ...this._middleware];

    const result = await super.goto(pathname, options, composed);

    for (const hook of this._afterEachHooks) {
      await hook(result);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Lit lifecycle
  // ---------------------------------------------------------------------------

  override hostConnected(): void {
    if (!this._browser) return;

    // Singleton enforcement
    if (!this._allowMultiple) {
      const existing = _routerRegistry.get(globalThis);
      if (existing !== undefined && existing !== this) {
        throw new Error(
          '[Router] Only one Router instance may be active per page. ' +
          'Use the `Routes` class for nested sub-routing. ' +
          'Pass `allowMultiple: true` in RouterOptions to suppress this check in tests.'
        );
      }
      _routerRegistry.set(globalThis, this);
    }

    super.hostConnected();

    window.addEventListener('click', this._onClick);
    window.addEventListener('popstate', this._onPopState);
    window.addEventListener('beforeunload', this._onBeforeUnload);

    this._setupAnnouncer();
    this._setupNavigationListeners();

    // Initial navigation from current URL
    this._navigate(this._getLocationPathname());
  }

  override hostDisconnected(): void {
    if (!this._browser) return;

    if (!this._allowMultiple && _routerRegistry.get(globalThis) === this) {
      _routerRegistry.delete(globalThis);
    }

    super.hostDisconnected();

    window.removeEventListener('click', this._onClick);
    window.removeEventListener('popstate', this._onPopState);
    window.removeEventListener('beforeunload', this._onBeforeUnload);

    this._announcer?.remove();
    this._announcer = undefined;
  }

  // ---------------------------------------------------------------------------
  // Private — History API
  // ---------------------------------------------------------------------------

  private async _navigate(
    pathname: string,
    options: NavigationOptions = {}
  ): Promise<void> {
    if (this._debug) console.debug(`[Router] navigating to: ${pathname}`, options);

    const result = await this.goto(pathname, options);

    if (this._debug) console.debug(`[Router] result:`, result);

    if (result.status === 'success' || result.status === 'redirected') {
      const target = result.status === 'redirected' ? result.to : pathname;
      this._updateHistory(target, options);
      this._updateScrollPosition(options);
      this._manageFocus();
      this._announce(target);
    } else if (result.status === 'error') {
      this._onError?.(
        (result as { status: 'error'; error: unknown }).error,
        pathname
      );
    }
  }

  private _updateHistory(pathname: string, options: NavigationOptions): void {
    if (!this._browser) return;

    let fullPath: string;

    if (this._mode === 'hash') {
      // basePath lives in the real pathname; the routed path lives in the fragment.
      // Example: basePath='/my-app', pathname='/about' → /my-app/#/about
      const staticBase = this.basePath || window.location.pathname;
      fullPath = `${staticBase}#${pathname}`;
    } else {
      fullPath = this.basePath + pathname + this.search + this.hash;
    }

    const newHref = new URL(fullPath, window.location.origin).href;
    if (newHref === window.location.href) return;

    if (options.replace) {
      window.history.replaceState(options.state ?? {}, '', fullPath);
    } else {
      window.history.pushState(options.state ?? {}, '', fullPath);
    }
  }

  private _updateScrollPosition(options: NavigationOptions): void {
    if (!this._browser) return;

    if (this.hash) {
      const target = document.querySelector(this.hash);
      if (target) { target.scrollIntoView(); return; }
    }

    if (!options.replace) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }

  private _manageFocus(): void {
    if (!this._browser) return;

    requestAnimationFrame(() => {
      const selector = this._focusTarget ?? 'main, [autofocus], body';
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Private — Accessibility
  // ---------------------------------------------------------------------------

  /**
   * Announce route changes to screen readers via an ARIA live region.
   *
   * Pattern: clear → rAF → setTimeout(0) → set text.
   * The double yield ensures the empty state is committed to the AT tree
   * before the new announcement lands, so assistive technologies reliably
   * detect it as a new update.
   */
  private _announce(pathname: string): void {
    if (!this._announcer || !this._browser) return;

    const title = this.currentMeta?.title ?? document.title ?? pathname;

    this._announcer.textContent = '';

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (this._announcer) {
          this._announcer.textContent = `Navigated to ${title}`;
        }
      }, 0);
    });
  }

  /** Inject a visually-hidden ARIA live region into document.body. */
  private _setupAnnouncer(): void {
    if (!this._browser || this._announcer) return;

    this._announcer = document.createElement('div');
    Object.assign(this._announcer.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    this._announcer.setAttribute('aria-live', 'polite');
    this._announcer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(this._announcer);
  }

  /** Listen for navigation-end to update aria-current on anchor elements. */
  private _setupNavigationListeners(): void {
    if (!this._browser) return;

    this._host.addEventListener('navigation-end', () => {
      this._updateAriaCurrent();
    });
  }

  private _updateAriaCurrent(): void {
    if (!this._browser) return;

    requestAnimationFrame(() => {
      const currentPath = this._currentPathname ?? '';
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        const anchorPath =
          this._mode === 'hash'
            ? anchor.hash.slice(1) || '/'
            : anchor.pathname;

        if (anchorPath === currentPath) {
          anchor.setAttribute('aria-current', 'page');
        } else {
          anchor.removeAttribute('aria-current');
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private — URL helpers
  // ---------------------------------------------------------------------------

  private _getLocationPathname(): string {
    if (!this._browser) return '/';

    if (this._mode === 'hash') {
      return window.location.hash.slice(1) || '/';
    }

    const full =
      window.location.pathname +
      window.location.search +
      window.location.hash;

    if (this.basePath && full.startsWith(this.basePath)) {
      return full.slice(this.basePath.length) || '/';
    }

    return full;
  }

  private get _currentHref(): string {
    if (!this._browser) return '/';

    if (this._mode === 'hash') {
      return window.location.hash.slice(1) || '/';
    }

    const full = window.location.pathname + window.location.search + window.location.hash;
    if (this.basePath && full.startsWith(this.basePath)) {
      return full.slice(this.basePath.length) || '/';
    }
    return full;
  }

  private get _origin(): string {
    if (!this._browser) return '';
    return window.location.origin || window.location.protocol + '//' + window.location.host;
  }
}
