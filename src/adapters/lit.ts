/**
 * adapters/lit.ts
 *
 * Lit-specific adapter: the `activeLink` directive.
 *
 * This is the only file in the router that imports from 'lit/directive.js'.
 * Everything else in the router is framework-agnostic. If you're not using
 * Lit, simply don't import this file — nothing else depends on it.
 *
 * The directive reactively manages active state on <a> elements based on
 * the current router location. It applies an `activeClass` CSS class and
 * optionally sets `aria-current="page"` when the element's href matches
 * the active route.
 *
 * @example
 * ```ts
 * import { activeLink } from './adapters/lit.js';
 *
 * html`
 *   <nav>
 *     <a href="/home"    ${activeLink(this._router)}>Home</a>
 *     <a href="/about"   ${activeLink(this._router, { exact: false })}>About</a>
 *     <a href="/profile" ${activeLink(this._router, { activeClass: 'selected' })}>Profile</a>
 *   </nav>
 * `
 * ```
 */

import { directive, Directive, PartInfo, PartType } from "lit/directive.js";
import type { ElementPart } from "lit/directive.js";
import type { Routes } from "../routes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveLinkOptions {
  /**
   * CSS class applied when the link is active. Defaults to `'active'`.
   */
  activeClass?: string;

  /**
   * If true, only marks active on an exact pathname match.
   * If false, marks active for any path starting with href.
   * Defaults to `true`.
   */
  exact?: boolean;

  /**
   * If true, sets `aria-current="page"` when active.
   * Defaults to `true`.
   */
  ariaCurrent?: boolean;
}

// ---------------------------------------------------------------------------
// Directive implementation
// ---------------------------------------------------------------------------

class ActiveLinkDirective extends Directive {
  private _routes: Routes | undefined;
  private _options: Required<ActiveLinkOptions> = {
    activeClass: "active",
    exact: true,
    ariaCurrent: true,
  };
  private _unlisten: (() => void) | undefined;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("activeLink directive must be used on an element.");
    }
  }

  render(_routes: Routes, _options?: ActiveLinkOptions) {
    // All work happens in update() — render() is required by the Directive API
  }

  update(
    part: ElementPart,
    [routes, options = {}]: [Routes, ActiveLinkOptions?]
  ) {
    this._routes = routes;
    this._options = {
      activeClass: options.activeClass ?? "active",
      exact: options.exact ?? true,
      ariaCurrent: options.ariaCurrent ?? true,
    };

    const el = part.element as HTMLAnchorElement;

    // Apply immediately after Lit sets href attributes
    requestAnimationFrame(() => this._apply(el));

    // Subscribe once to navigation-end for reactive updates.
    // If _unlisten is undefined (first render or post-reconnect), subscribe.
    if (!this._unlisten) {
      const host = (routes as unknown as { _host: EventTarget })._host;
      const handler = () => this._apply(el);
      host.addEventListener("navigation-end", handler);
      this._unlisten = () =>
        host.removeEventListener("navigation-end", handler);
    }
  }

  private _apply(el: HTMLAnchorElement): void {
    if (!this._routes) return;

    // Support both real anchor pathname and plain href attributes
    const href =
      el.pathname !== "/" ? el.pathname : el.getAttribute("href") ?? undefined;

    if (!href) return;

    const isActive = this._routes.isActive(href, {
      exact: this._options.exact,
    });

    el.classList.toggle(this._options.activeClass, isActive);

    if (this._options.ariaCurrent) {
      if (isActive) {
        el.setAttribute("aria-current", "page");
      } else {
        el.removeAttribute("aria-current");
      }
    }
  }

  disconnected(): void {
    this._unlisten?.();
    this._unlisten = undefined;
  }

  reconnected(): void {
    // _unlisten was cleared by disconnected(). Leave it undefined — update()
    // will be called by Lit on the next render and will re-subscribe then.
    // Between reconnect and next render, navigation-end is not reflected, but
    // update() calls _apply() immediately and snaps to the current state.
    this._unlisten = undefined;
  }
}

/**
 * Lit element directive for declarative active link styling.
 *
 * Apply directly to any `<a>` element. Automatically adds/removes the
 * active CSS class and `aria-current` whenever the route changes.
 *
 * @param routes  - The `Routes` or `Router` controller instance.
 * @param options - Optional: `activeClass`, `exact`, `ariaCurrent`.
 */
export const activeLink = directive(ActiveLinkDirective);
