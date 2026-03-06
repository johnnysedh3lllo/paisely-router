/**
 * events.ts
 *
 * Custom event classes fired during navigation and used for parent-child
 * Routes controller discovery.
 *
 * Kept separate from types.ts because these are runtime values (classes),
 * not just type declarations.
 */

import type {
  NavigationEventType,
  NavigationEventDetail,
} from './types.js';

// Re-export so consumers can import from a single place
export type { NavigationEventType, NavigationEventDetail };

/**
 * Fired on the host element during navigation lifecycle.
 *
 * Event types:
 *   navigation-start    — goto() was called, before any guards
 *   navigation-end      — navigation committed successfully
 *   navigation-cancel   — a guard or middleware cancelled navigation
 *   navigation-error    — an error occurred (no-match, guard throw, lazy load failure)
 *   navigation-redirect — a redirect was triggered (declarative, enter(), or middleware)
 *
 * All events bubble and are composed, so they cross shadow DOM boundaries.
 */
export class NavigationEvent extends CustomEvent<NavigationEventDetail> {
  constructor(type: NavigationEventType, detail: NavigationEventDetail) {
    super(type, { bubbles: true, composed: true, detail });
  }
}

/**
 * Fired from a Routes controller when its host element connects to the DOM.
 *
 * Bubbles up through the shadow DOM until a parent Routes controller
 * intercepts it via `stopImmediatePropagation()`. This is how nested
 * Routes instances discover their parent without any direct reference.
 *
 * The parent sets `onDisconnect` on the event so the child can deregister
 * itself when it disconnects — no direct parent reference needed.
 */
export class RoutesConnectedEvent extends Event {
  static readonly eventName = 'lit-routes-connected';

  readonly routes: unknown;

  /**
   * Set by the parent Routes controller so the child can call it on
   * disconnect to remove itself from the parent's child list.
   */
  onDisconnect: (() => void) | undefined;

  constructor(routes: unknown) {
    super(RoutesConnectedEvent.eventName, {
      bubbles: true,
      composed: true,
      cancelable: false,
    });
    this.routes = routes;
  }
}
