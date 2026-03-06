/**
 * index.ts
 *
 * Public entry point for the router package.
 *
 * Import from here in application code:
 *
 *   import { Router, Routes, type RouteConfig } from './router/index.js';
 *
 * The Lit-specific adapter (activeLink directive) is intentionally NOT
 * re-exported here — it imports from 'lit/directive.js' and should only
 * be included by apps that use Lit:
 *
 *   import { activeLink } from './router/adapters/lit.js';
 */

// Core classes
export { Routes } from './routes.js';
export { Router } from './router.js';
export type { RouterOptions } from './router.js';

// Events
export { NavigationEvent, RoutesConnectedEvent } from './events.js';

// All public types
export type {
  RouteParams,
  NavigationOptions,
  NavigationResult,
  EnterResult,
  LeaveResult,
  RouteMeta,
  OutletMap,
  LayoutFn,
  BaseRouteConfig,
  PathRouteConfig,
  URLPatternRouteConfig,
  RouteConfig,
  RoutesOptions,
  NamedLinkDescriptor,
  NavigationContext,
  NavigationMiddleware,
  SiblingMessageHandler,
  SiblingMessage,
  NavigationEventType,
  NavigationEventDetail,
} from './types.js';

// Utility functions (useful for custom adapters and extensions)
export {
  getPattern,
  getTailGroup,
  sanitizePathname,
  resolveRelativePath,
  isPatternConfig,
} from './patterns.js';

export { matchRoute } from './matching.js';
export { runMiddlewarePipeline } from './middleware.js';
export { runLeaveGuard, runEnterGuard } from './guards.js';
export { loadLazyComponent } from './lazy.js';
export { applyLayouts, renderDefaultOutlet, renderNamedOutlet } from './outlets.js';
