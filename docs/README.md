# Router — Comprehensive Documentation

> A production-grade client-side router built on URLPattern.  
> Lit-ready via a clean adapter layer. Framework-agnostic at its core.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
   - [Module Map](#21-module-map)
   - [Dependency Graph](#22-dependency-graph)
   - [Design Principles](#23-design-principles)
3. [Installation & Setup](#3-installation--setup)
4. [Core Concepts](#4-core-concepts)
   - [Routes vs Router](#41-routes-vs-router)
   - [The Navigation Lifecycle](#42-the-navigation-lifecycle)
   - [Route Matching](#43-route-matching)
5. [Route Configuration](#5-route-configuration)
   - [Path Routes](#51-path-routes)
   - [URLPattern Routes](#52-urlpattern-routes)
   - [Fallback Routes](#53-fallback-routes)
   - [Named Routes](#54-named-routes)
   - [Declarative Redirects](#55-declarative-redirects)
   - [Route Metadata](#56-route-metadata)
6. [Navigation](#6-navigation)
   - [goto()](#61-goto)
   - [NavigationResult](#62-navigationresult)
   - [History Modes](#63-history-modes)
   - [Query Strings & Fragments](#64-query-strings--fragments)
   - [back() and forward()](#65-back-and-forward)
7. [Rendering](#7-rendering)
   - [outlet()](#71-outlet)
   - [Named Outlets](#72-named-outlets)
   - [Layout Routes](#73-layout-routes)
   - [Lazy Loading & Code Splitting](#74-lazy-loading--code-splitting)
8. [Guards](#8-guards)
   - [enter()](#81-enter)
   - [leave()](#82-leave)
   - [Middleware Pipeline](#83-middleware-pipeline)
   - [Global beforeEach / afterEach](#84-global-beforeeach--aftereach)
9. [Nested Routing](#9-nested-routing)
   - [How Parent/Child Wiring Works](#91-how-parentchild-wiring-works)
   - [Tail Group Propagation](#92-tail-group-propagation)
   - [Relative Navigation](#93-relative-navigation)
   - [Outlet Slot Coordination](#94-outlet-slot-coordination)
   - [Sibling Communication](#95-sibling-communication)
10. [Active Link Directive (Lit)](#10-active-link-directive-lit)
11. [Navigation Events](#11-navigation-events)
12. [Accessibility](#12-accessibility)
13. [TypeScript API Reference](#13-typescript-api-reference)
14. [Security](#14-security)
15. [Base Path Support](#15-base-path-support)
16. [Debug Mode](#16-debug-mode)
17. [Extending the Router](#17-extending-the-router)
18. [Unimplemented Features](#18-unimplemented-features)
19. [Warnings & Caveats](#19-warnings--caveats)
20. [Change History](#20-change-history)

---

## 1. Overview

This is a client-side router built on the browser's native [`URLPattern`](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) API. It maps URL pathnames to render callbacks, runs guards and middleware, handles lazy loading, and manages the History API.

The router is split into focused modules — each covering one routing concern — assembled into two public classes: `Routes` (the reactive controller) and `Router` (the browser integration layer). A Lit-specific `activeLink` directive lives in a separate adapter file and is the only part that imports from Lit.

**Key properties:**

- **No global singletons.** The router lives inside your component as a controller. Its state is owned by that component.
- **Shadow DOM-safe.** Parent/child route discovery uses a bubbling, composed custom event so it works across shadow root boundaries without `querySelector`.
- **Async-first.** Guards, middleware, and lazy loading are all `async`. Concurrency is handled via a navigation ID counter — stale async navigations self-cancel without any explicit cleanup.
- **Typed end-to-end.** Route params, render callbacks, and guard return values are all TypeScript-generic.
- **Framework-agnostic core.** Only `routes.ts` and `router.ts` import from Lit. All feature modules (`patterns`, `matching`, `guards`, `middleware`, `lazy`, `outlets`) are pure TypeScript with no framework dependency.

---

## 2. Architecture

### 2.1 Module Map

```
router/
├── index.ts              Entry point — re-exports all public API
│
├── types.ts              All interfaces and type aliases. Zero logic, zero imports.
├── events.ts             NavigationEvent, RoutesConnectedEvent
│
├── patterns.ts           URLPattern cache, getTailGroup, sanitizePathname,
│                         resolveRelativePath
├── matching.ts           matchRoute() — finds the first matching RouteConfig
├── middleware.ts         runMiddlewarePipeline() — executes the middleware chain
├── guards.ts             runEnterGuard(), runLeaveGuard()
├── lazy.ts               loadLazyComponent() — dynamic import with navId safety
├── outlets.ts            applyLayouts(), renderDefaultOutlet(), renderNamedOutlet()
│
├── routes.ts             Routes class — Lit ReactiveController, assembles modules
├── router.ts             Router class — History API, click handling, a11y
│
└── adapters/
    └── lit.ts            activeLink directive — the only Lit-specific file
```

### 2.2 Dependency Graph

```
types.ts          ← (no imports)
events.ts         ← types
patterns.ts       ← types
matching.ts       ← types, patterns
middleware.ts     ← types
guards.ts         ← types
lazy.ts           ← types
outlets.ts        ← types
                         ↓
routes.ts         ← events, patterns, matching, middleware, guards, lazy, outlets
router.ts         ← routes
                         ↓
adapters/lit.ts   ← routes  (+ lit/directive.js — isolated here)
index.ts          ← everything above
```

The graph is a strict DAG. `types.ts` is the foundation — nothing it imports can create a circular dependency. All feature modules are pure functions; only `routes.ts` and `router.ts` are classes with state. The Lit directive is fully isolated: removing or replacing it requires no changes to any other file.

### 2.3 Design Principles

**Each module has one job.** `matching.ts` finds routes. `guards.ts` runs guards. `lazy.ts` loads components. Changing how any one of these works means editing one file.

**Feature modules are pure functions.** They take inputs and return outputs. No class state, no side effects. This makes them straightforward to test in isolation.

**`routes.ts` is the assembly layer.** It holds mutable state (`_currentRoute`, `_currentParams`, etc.) and wires the pure functions together into the `goto()` loop. It is the only file where the navigation lifecycle lives end-to-end.

**`router.ts` owns the browser boundary.** Every `window.*`, `document.*`, `history.*`, and `location.*` call lives here. If you want to understand what the router does to the browser, read only this file.

---

## 3. Installation & Setup

Copy the `router/` directory into your project. Then import from `router/index.ts`:

```ts
// my-app.ts
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { Router } from './router/index.js';

@customElement('my-app')
class MyApp extends LitElement {
  private _router = new Router(this, [
    { path: '/',          render: () => html`<home-page></home-page>` },
    { path: '/about',     render: () => html`<about-page></about-page>` },
    { path: '/users/:id', render: ({ id }) => html`<user-page .userId=${id}></user-page>` },
  ]);

  render() {
    return html`
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      <main>${this._router.outlet()}</main>
    `;
  }
}
```

`Router` registers itself as a `ReactiveController` on your Lit element. When the element connects to the DOM, the router installs its global click and popstate listeners and immediately navigates to the current URL.

The `activeLink` directive is a separate import:

```ts
import { activeLink } from './router/adapters/lit.js';
```

---

## 4. Core Concepts

### 4.1 Routes vs Router

| | `Routes` | `Router` |
|---|---|---|
| **Use in** | Any nested Lit element | Root app element only |
| **Route matching** | ✅ | ✅ (inherited) |
| **Click interception** | ❌ | ✅ |
| **History API** | ❌ | ✅ |
| **Scroll restoration** | ❌ | ✅ |
| **Focus management** | ❌ | ✅ |
| **ARIA announcements** | ❌ | ✅ |
| **beforeEach / afterEach** | ❌ | ✅ |
| **Multiple instances** | ✅ | ⚠️ One per page |

Use `Routes` for nested sub-routing within child elements. Use `Router` once at the root.

### 4.2 The Navigation Lifecycle

When `goto('/path')` is called, these steps run in order:

```
 1. Sanitize pathname         patterns.ts  — strip open-redirect / XSS
 2. Emit navigation-start     routes.ts    — first iteration only, not on redirects
 3. Depth cap check           routes.ts    — abort if redirect chain > 20 hops
 4. Match route               matching.ts  — first match wins; fallback if none
 5. Declarative redirect?     routes.ts    — loop back to step 1 with new target
 6. Run leave() guard         guards.ts    — on the outgoing route
 7. Check concurrency         routes.ts    — cancel if newer goto() started
 8. Run middleware pipeline   middleware.ts — beforeEach hooks + instance use()
 9. Middleware redirect?      routes.ts    — loop back to step 1 with new target
10. Run enter() guard         guards.ts    — on the incoming route
11. enter() redirect?         routes.ts    — loop back to step 1 with new target
12. Load lazy component       lazy.ts      — if route.component is set
13. Commit state              routes.ts    — _currentRoute, params, pathname, etc.
14. Update document.title     routes.ts    — SSR-safe guard
15. Propagate tail to children routes.ts   — child Routes.goto(tail)
16. requestUpdate()           routes.ts    — trigger Lit re-render
17. Emit navigation-end       routes.ts
```

Steps 5, 9, and 11 share the same redirect resolution logic — they update `targetPathname` and `continue redirectLoop`, which loops back to step 1. This is an iterative loop, not recursion.

Any step can cancel navigation. When cancelled, **no state is mutated** — the router remains on the previous route.

### 4.3 Route Matching

Routes are tested in **array order**. First match wins. Under the hood, each path string is compiled into a `URLPattern` instance by `patterns.ts` and cached in a module-level `WeakMap` — compilation happens once per route object, never again.

Named segments (`:id`), wildcards (`*`), and full `URLPattern` instances are all supported. A trailing `/*` passes the unmatched remainder down to nested `Routes` controllers as the tail group.

The matching logic lives entirely in `matching.ts` and is a single pure function:

```ts
matchRoute(routes, fallback, pathname) → RouteConfig | undefined
```

---

## 5. Route Configuration

Every route is either a `PathRouteConfig` (path string) or a `URLPatternRouteConfig` (URLPattern instance). Both extend `BaseRouteConfig` which defines all the optional fields.

### 5.1 Path Routes

```ts
{
  path: '/users/:id',
  render: ({ id }) => html`<user-detail .userId=${id}></user-detail>`,
}
```

Path syntax follows `URLPattern` conventions:
- `:name` — named capture group
- `*` — unnamed wildcard (greedy)
- `/*` at the end — tail wildcard; passes remainder to child routes

### 5.2 URLPattern Routes

For advanced matching (query params in the pattern, custom regex groups):

```ts
{
  pattern: new URLPattern({ pathname: '/articles/:year(\\d{4})/:slug' }),
  render: ({ year, slug }) => html`<article-page .year=${year} .slug=${slug}></article-page>`,
}
```

> ⚠️ Named links (`link({ name: '...' })`) do not work with URLPattern routes — there is no path string to interpolate params back into.

### 5.3 Fallback Routes

A fallback is rendered when no route matches. Internally it behaves like a `/*` catch-all.

```ts
new Router(this, routes, {
  fallback: {
    render: () => html`<not-found-page></not-found-page>`,
  }
});
```

> ⚠️ The fallback does **not** run `enter()` guards. For a guarded 404 page, use an explicit catch-all route: `{ path: '/*', enter: ..., render: ... }`.

### 5.4 Named Routes

```ts
{ path: '/users/:id/posts/:postId', name: 'user-post', render: ... }
```

```ts
// Generates: '/users/42/posts/7'
const href = this._router.link({ name: 'user-post', params: { id: '42', postId: '7' } });
```

Named routes are indexed at construction. Use `addRoutes()` / `setRoutes()` / `removeRoute()` to mutate routes after construction — these methods rebuild the index atomically. Direct `routes.push()` works for unnamed routes but will not update the named index.

### 5.5 Declarative Redirects

```ts
{ path: '/old-about', redirect: '/about' },
{ path: '/home',      redirect: '/' },
```

Redirects are resolved before any guards run. They loop back to the top of the navigation loop iteratively — no recursion, no stack growth. Cycles are detected and terminated with a `navigation-error` event.

### 5.6 Route Metadata

```ts
{
  path: '/dashboard',
  meta: { title: 'Dashboard', requiresAuth: true },
  render: () => html`<dashboard-page></dashboard-page>`,
}
```

`meta.title` automatically updates `document.title` on navigation. All other `meta` fields are accessible on `routes.currentMeta` and in middleware via `ctx.meta`. Meta is **inherited and merged** from parent to child routes — child values override parent values on conflicting keys.

```ts
// Auth middleware using meta
router.use(async (ctx) => {
  if (ctx.meta?.requiresAuth && !isLoggedIn()) {
    sessionStorage.setItem('redirectAfterLogin', ctx.to);
    ctx.redirect('/login');
  } else {
    await ctx.next();
  }
});
```

---

## 6. Navigation

### 6.1 goto()

```ts
await this._router.goto('/users/42');
await this._router.goto('/search?q=lit&page=2', { preserveSearch: false });
await this._router.goto('/dashboard', { replace: true });
await this._router.goto('/page#section', { state: { from: 'home' } });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `replace` | `boolean` | `false` | Use `replaceState` instead of `pushState` |
| `preserveSearch` | `boolean` | `false` | Keep the current query string |
| `state` | `unknown` | `{}` | Arbitrary state stored in the history entry |

`goto()` always returns a `Promise<NavigationResult>` and never throws.

### 6.2 NavigationResult

```ts
const result = await this._router.goto('/protected');

switch (result.status) {
  case 'success':    console.log('Navigated'); break;
  case 'cancelled':  console.log('Blocked by guard or middleware'); break;
  case 'redirected': console.log('Redirected to', result.to); break;
  case 'error':      console.error('Navigation failed', result.error); break;
}
```

Useful in tests for asserting exactly what happened without relying on side effects.

### 6.3 History Modes

**History mode** (default) — uses `pushState`/`replaceState`. Requires your server to serve the app shell for all routes.

```ts
new Router(this, routes, { mode: 'history' }); // default
```

**Hash mode** — routes via URL fragment (`/#/about`). Works on any static file host.

```ts
new Router(this, routes, { mode: 'hash' });
```

In hash mode, link interception reads from `anchor.hash` and `popstate` reads from `window.location.hash`. Route definitions are identical in both modes — the `#` prefix is handled transparently by `router.ts`.

### 6.4 Query Strings & Fragments

```ts
await this._router.goto('/search?q=lit&page=2#results');

this._router.search;        // '?q=lit&page=2'
this._router.searchParams;  // URLSearchParams instance
this._router.hash;          // '#results'
this._router.searchParams.get('q'); // 'lit'

// Preserve the current query string across navigations
await this._router.goto('/search', { preserveSearch: true });
```

Hash fragments trigger `scrollIntoView()` automatically if a matching element exists.

### 6.5 back() and forward()

```ts
this._router.back();    // history.back()
this._router.forward(); // history.forward()
```

Both are SSR-safe no-ops when `window` is not available.

---

## 7. Rendering

### 7.1 outlet()

`outlet()` calls the current route's `render` function and returns the result. Use it inside your element's `render()`.

```ts
render() {
  return html`
    <header>...</header>
    <main>${this._router.outlet()}</main>
  `;
}
```

If `render` throws, the error is caught, a `navigation-error` event is dispatched, and `undefined` is returned — no unhandled exception breaks the render cycle.

During lazy-load transitions (`isPending === true`), `outlet()` returns the **previous route's content** to prevent a blank flash.

You can handle load states explicitly:

```ts
render() {
  if (this._router.componentError) {
    return html`<p>Failed to load page. <a href="/">Go home</a></p>`;
  }
  if (this._router.isPending) {
    return html`<loading-spinner></loading-spinner>`;
  }
  return html`
    <main>${this._router.outlet()}</main>
  `;
}
```

The outlet rendering logic lives in `outlets.ts` as `renderDefaultOutlet()` — a pure function that can be read and understood independently of the class.

### 7.2 Named Outlets

When a route needs to populate multiple independent regions simultaneously, declare an `outlets` map:

```ts
{
  path: '/dashboard',
  outlets: {
    main:    (p) => html`<dashboard-main></dashboard-main>`,
    sidebar: (p) => html`<dashboard-sidebar></dashboard-sidebar>`,
    header:  (p) => html`<h1>Dashboard</h1>`,
  }
}
```

```ts
render() {
  return html`
    <header>${this._router.outlet('header')}</header>
    <aside>${this._router.outlet('sidebar')}</aside>
    <main>${this._router.outlet('main')}</main>
  `;
}
```

**Slot coordination:** When sibling `Routes` controllers exist under the same parent, each named slot can only be owned by one controller at a time. The first one whose current route declares that outlet name wins. Siblings calling `outlet('same-name')` receive `undefined`. Slots are released automatically on `hostDisconnected`.

Named outlet rendering is implemented in `outlets.ts` as `renderNamedOutlet()`.

### 7.3 Layout Routes

A `layout` function wraps rendered outlet content. It receives the child content and current params, and returns the wrapped template.

```ts
const appShellLayout: LayoutFn = (outlet, params) => html`
  <app-shell>
    <nav slot="nav">...</nav>
    <div slot="content">${outlet}</div>
  </app-shell>
`;

{
  path: '/admin/*',
  layout: appShellLayout,
  render: () => html`<admin-dashboard></admin-dashboard>`,
}
```

**Layout composition:** If both a parent route and a child route declare layouts, they compose correctly at any depth. The child's layout wraps the content first, then each ancestor's layout wraps that result outward. There is no depth limit.

```
Root layout      (outermost)
  └── Section layout
        └── Page layout
              └── Route content  (innermost)
```

Layout composition is implemented in `outlets.ts` as `applyLayouts()` — a pure function that takes the ancestor chain as an array argument.

### 7.4 Lazy Loading & Code Splitting

Use `component` instead of `render` to dynamically import a module:

```ts
{
  path: '/settings',
  component: () => import('./pages/settings-page.js'),
}
```

The exported `default` can be a render function `(params) => TemplateResult` or a value (e.g. a Lit element class — it will be treated as a value, not called).

While loading, `isPending` is `true` and `outlet()` returns the previous content. On failure, `componentError` is set.

The lazy loading logic lives in `lazy.ts` as `loadLazyComponent()`. The key correctness property: the loaded module's default export is stored on the route as a render function `(p: RouteParams) => unknown` — params are passed at render call time, not captured at load time. This prevents stale param bugs on second visits to the same lazy route with different URL params.

**Prefetching** — load a module before the user navigates there:

```ts
anchor.addEventListener('mouseover', () => {
  this._router.prefetch('/settings');
});
```

Prefetch failures are silent — they surface only if the user actually navigates.

---

## 8. Guards

Guards are per-route lifecycle hooks that run as part of the navigation pipeline. They differ from middleware: middleware runs globally (every navigation), guards run per-route (only when that route is being entered or left). Guard logic is implemented in `guards.ts`.

### 8.1 enter()

Called before entering a route. Receives the matched URL params.

```ts
{
  path: '/admin',
  enter: async (params) => {
    const user = await getUser();
    if (!user.isAdmin) return '/login';   // string → redirect
    if (!user.verified) return false;      // false → cancel
    // true / void → proceed
  },
  render: () => html`<admin-page></admin-page>`,
}
```

| Return value | Effect |
|---|---|
| `true` or `void` | Allow navigation |
| `false` | Cancel; stay on current route |
| `string` | Redirect to that pathname |

If `enter()` throws, navigation is cancelled and `navigation-error` is dispatched with the thrown error.

### 8.2 leave()

Called before leaving the current route.

```ts
{
  path: '/editor',
  leave: async (params) => {
    if (this._isDirty) {
      return confirm('Discard unsaved changes?');
    }
    // void → allow leaving
  },
  render: () => html`<editor-page></editor-page>`,
}
```

| Return value | Effect |
|---|---|
| `true` or `void` | Allow leaving |
| `false` | Block; stay on current route |

`leave()` covers all in-app navigation. For address-bar navigation, tab closure, and page reload, the router registers a `beforeunload` listener that triggers the browser's native "Leave site?" dialog whenever the current route has a `leave` guard. See §19 for why the async `leave()` function itself cannot run in `beforeunload`.

### 8.3 Middleware Pipeline

Middleware runs before every navigation's `enter()` guard. Each function receives a `NavigationContext` and must call `ctx.next()` to proceed. The middleware pipeline is implemented in `middleware.ts` as `runMiddlewarePipeline()`.

```ts
// Auth middleware
this._router.use(async (ctx) => {
  if (ctx.meta?.requiresAuth && !isAuthenticated()) {
    sessionStorage.setItem('redirectAfterLogin', ctx.to);
    ctx.redirect('/login');
  } else {
    await ctx.next();
  }
});

// Logging middleware
this._router.use(async (ctx) => {
  console.log(`[nav] ${ctx.from ?? 'initial'} → ${ctx.to}`);
  await ctx.next();
  console.log('[nav] complete');
});
```

Multiple middleware functions execute in insertion order. If a middleware calls `ctx.cancel()` or `ctx.redirect()` without calling `ctx.next()`, the chain stops.

| `NavigationContext` field | Type | Description |
|---|---|---|
| `from` | `string \| undefined` | Previous pathname |
| `to` | `string` | Target pathname |
| `params` | `RouteParams` | Matched URL params |
| `meta` | `RouteMeta \| undefined` | Route metadata |
| `next()` | `() => Promise<void>` | Proceed to next middleware |
| `cancel()` | `() => void` | Cancel navigation |
| `redirect(path)` | `(string) => void` | Redirect to path |

### 8.4 Global beforeEach / afterEach

`beforeEach` is equivalent to adding global middleware that runs before any instance-level `use()` middleware. `afterEach` runs after every navigation regardless of result status. Both are only available on `Router`, not `Routes`.

```ts
this._router.beforeEach(async (ctx) => {
  startProgressBar();
  await ctx.next();
});

this._router.afterEach(async (result) => {
  stopProgressBar();
  analytics.track('page_view', { status: result.status });
});
```

`beforeEach` and `use()` middleware are composed into a single immutable array for each navigation call — no shared state is mutated, eliminating the concurrent-navigation race condition described in §20.

---

## 9. Nested Routing

### 9.1 How Parent/Child Wiring Works

When a nested `Routes` controller's host connects to the DOM, it fires a `RoutesConnectedEvent` — a bubbling, composed custom event defined in `events.ts`. Any ancestor `Routes` controller catches it, registers the child, and sets an `onDisconnect` callback on the event so the child can cleanly deregister itself later.

This is Shadow DOM-safe because `composed: true` means the event crosses shadow root boundaries. No `querySelector` or direct reference needed.

```ts
// Child element — uses Routes, not Router
@customElement('user-section')
class UserSection extends LitElement {
  private _routes = new Routes(this, [
    { path: '/profile',  render: () => html`<user-profile></user-profile>` },
    { path: '/settings', render: () => html`<user-settings></user-settings>` },
  ]);

  render() {
    return html`${this._routes.outlet()}`;
  }
}

// Parent route — hands off the tail via `/*`
{
  path: '/users/:id/*',
  render: ({ id }) => html`<user-section .userId=${id}></user-section>`,
}
```

### 9.2 Tail Group Propagation

When a parent route ends in `/*`, the unmatched remainder is the **tail group**. The parent forwards it to all registered child `Routes` by calling `childRoutes.goto(tail)`. Tail extraction is handled by `getTailGroup()` in `patterns.ts`.

Navigating to `/users/42/profile`:
1. Parent matches `/users/:id/*` → params: `{ id: '42', 0: '/profile' }`
2. Tail: `/profile`
3. Parent calls `childRoutes.goto('/profile')`
4. Child matches `/profile` → renders `<user-profile>`

A `Routes` controller with **no routes and no fallback** acts as a pure pass-through: it treats the entire pathname as a tail and forwards it to its children.

### 9.3 Relative Navigation

`link()` supports relative paths resolved via `resolveRelativePath()` in `patterns.ts`:

```ts
// Current path: /users/42/profile
this._routes.link('./settings')  // → '/users/42/settings'
this._routes.link('../')         // → '/users/42/'
this._routes.link('/absolute')   // → '/absolute'
```

Child route components can navigate relatively without knowing their absolute position in the URL hierarchy.

### 9.4 Outlet Slot Coordination

When sibling `Routes` controllers render into the same named outlet slots, slot coordination — implemented in `renderNamedOutlet()` in `outlets.ts` — ensures only one controller owns each slot at a time.

The first controller whose current route declares an outlet name wins. Any other sibling gets `undefined`. Slots are released on `hostDisconnected`, allowing the next active controller to claim them.

### 9.5 Sibling Communication

Sibling `Routes` controllers under the same parent can communicate without DOM events or a shared store.

```ts
// Broadcast from one sibling
this._routes.broadcastToSiblings({
  type: 'filters-updated',
  payload: { category: 'framework', tag: 'lit' },
});

// Receive in another sibling
const unsubscribe = this._routes.onSiblingMessage((msg) => {
  if (msg.type === 'filters-updated') {
    this._applyFilters(msg.payload);
    this.requestUpdate();
  }
});

// Clean up
unsubscribe();
```

The sender never receives its own messages. Handler errors are caught and logged without crashing the sender or any other sibling.

---

## 10. Active Link Directive (Lit)

The `activeLink` directive is the only Lit-specific feature. It lives in `adapters/lit.ts` and imports from `lit/directive.js`. Nothing else in the router depends on it.

```ts
import { activeLink } from './router/adapters/lit.js';
```

Apply it directly to `<a>` tags:

```ts
render() {
  return html`
    <nav>
      <a href="/"      ${activeLink(this._router)}>Home</a>
      <a href="/about" ${activeLink(this._router)}>About</a>
      <a href="/users" ${activeLink(this._router, { exact: false })}>Users</a>
      <a href="/admin" ${activeLink(this._router, { activeClass: 'selected' })}>Admin</a>
    </nav>
  `;
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `activeClass` | `string` | `'active'` | CSS class applied when the link is active |
| `exact` | `boolean` | `true` | Exact match vs. prefix match |
| `ariaCurrent` | `boolean` | `true` | Set `aria-current="page"` when active |

**How it works:** The directive subscribes to `navigation-end` on the router's host element. On each navigation it reads the anchor's `pathname`, calls `router.isActive()`, and toggles the class and attribute. The subscription is cleaned up on `disconnected()` and re-established on the next `update()` call after reconnect.

`exact: false` is useful for section-level nav items:

```ts
html`<a href="/users" ${activeLink(this._router, { exact: false })}>Users</a>`
// Active for: /users, /users/42, /users/42/posts, etc.
```

> ⚠️ The directive must be applied to an `<a>` element. Applying it to any other element type throws at construction time.

---

## 11. Navigation Events

Events are dispatched on the host element at each lifecycle stage. All bubble and are composed, so they can be intercepted by any ancestor. Event classes are defined in `events.ts`.

```ts
this.addEventListener('navigation-start', (e: NavigationEvent) => {
  const { from, to } = e.detail;
  showProgressBar();
});

this.addEventListener('navigation-end', (e: NavigationEvent) => {
  hideProgressBar();
  analytics.track('pageview', { path: e.detail.to });
});

this.addEventListener('navigation-error', (e: NavigationEvent) => {
  reportToSentry(e.detail.error);
});
```

| Event | Fired when |
|---|---|
| `navigation-start` | `goto()` is called, before any guards. Once per user-initiated navigation — not on redirect hops. |
| `navigation-end` | Navigation committed successfully |
| `navigation-cancel` | A guard returned `false` or middleware cancelled |
| `navigation-error` | A guard threw, a lazy import failed, or no route matched |
| `navigation-redirect` | A redirect was triggered (declarative, `enter()`, or middleware) |

```ts
interface NavigationEventDetail {
  from: string | undefined; // Previous pathname (undefined on first load)
  to: string;               // Target pathname
  result?: NavigationResult;
  error?: unknown;
}
```

---

## 12. Accessibility

`Router` implements several accessibility features automatically. All live in `router.ts`.

**ARIA live region** — A visually-hidden `<div aria-live="polite">` is appended to `document.body` on connect. After each navigation, it announces `"Navigated to <title>"` where the title comes from `route.meta.title` or `document.title`. The announcement uses a rAF + `setTimeout(0)` double-yield to ensure the live region mutation lands in a separate browser task from Lit's render cycle, maximising reliability across assistive technologies.

**`aria-current="page"` management** — After each navigation, all `<a href>` elements in the document are scanned. The one matching the current route gets `aria-current="page"`; all others have it removed.

**Focus management** — After each navigation, focus moves to the first element matching `'main, [autofocus], body'`, deferred via `requestAnimationFrame` to run after Lit's render cycle.

```ts
// Customise the focus target
this._router.setFocusTarget('h1');
this._router.setFocusTarget('#skip-to-content');
```

**Document title** — Set `meta.title` on each route:

```ts
{ path: '/about', meta: { title: 'About Us — My App' }, render: ... }
```

---

## 13. TypeScript API Reference

### `Routes` class (`routes.ts`)

```ts
class Routes implements ReactiveController {
  // Route configuration
  routes: RouteConfig[];
  fallback: BaseRouteConfig | undefined;
  readonly basePath: string;

  // Route mutation (rebuilds named index atomically)
  addRoutes(...routes: RouteConfig[]): this;
  setRoutes(routes: RouteConfig[]): this;
  removeRoute(route: RouteConfig): this;

  // Navigation
  goto(pathname: string, options?: NavigationOptions): Promise<NavigationResult>;
  prefetch(pathname: string): Promise<void>;

  // Rendering
  outlet(name?: string): unknown;
  link(pathname?: string | NamedLinkDescriptor): string;
  isActive(pathname: string, options?: { exact?: boolean }): boolean;

  // Middleware
  use(...middleware: NavigationMiddleware[]): this;

  // Sibling communication
  onSiblingMessage(handler: SiblingMessageHandler): () => void;
  broadcastToSiblings(message: Omit<SiblingMessage, 'from'>): void;

  // State
  get params(): RouteParams;
  get search(): string;
  get searchParams(): URLSearchParams;
  get hash(): string;
  get isPending(): boolean;
  get componentError(): unknown;
  get currentMeta(): RouteMeta | undefined;
}
```

### `Router` class (`router.ts`, extends `Routes`)

```ts
class Router extends Routes {
  constructor(host, routes, options?: RouterOptions);

  // Global hooks (Router only)
  beforeEach(middleware: NavigationMiddleware): this;
  afterEach(cb: (result: NavigationResult) => void | Promise<void>): this;

  // Browser navigation
  back(): void;
  forward(): void;

  // Accessibility
  setFocusTarget(selector: string): this;
}

interface RouterOptions extends RoutesOptions {
  mode?: 'history' | 'hash';
  onError?: (error: unknown, pathname: string) => void;
  debug?: boolean;
  allowMultiple?: boolean; // Test environments only
}
```

### Key types (`types.ts`)

```ts
type RouteParams = Record<string, string | undefined>;

type RouteConfig<P extends RouteParams = RouteParams> =
  | PathRouteConfig<P>
  | URLPatternRouteConfig<P>;

interface BaseRouteConfig<P extends RouteParams> {
  render?: (params: P) => unknown;
  component?: () => Promise<{ default: unknown }>;
  outlets?: OutletMap<P>;
  layout?: LayoutFn<P>;
  enter?: (params: P) => EnterResult | Promise<EnterResult>;
  leave?: (params: P) => LeaveResult | Promise<LeaveResult>;
  redirect?: string;
  name?: string;
  meta?: RouteMeta;
}

type EnterResult  = boolean | void | string;
type LeaveResult  = boolean | void;
type LayoutFn<P>  = (outlet: unknown, params: P) => unknown;
type OutletMap<P> = Record<string, (params: P) => unknown>;

type NavigationMiddleware = (ctx: NavigationContext) => Promise<void> | void;

type NavigationResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'redirected'; to: string }
  | { status: 'error'; error: unknown };
```

### Exported utilities (`index.ts`)

The feature-module functions are re-exported from `index.ts` for use in custom adapters and extensions:

```ts
// Pattern utilities (patterns.ts)
getPattern(route)              → URLPattern
getTailGroup(groups)           → string | undefined
sanitizePathname(pathname)     → string
resolveRelativePath(base, rel) → string
isPatternConfig(route)         → boolean

// Matching (matching.ts)
matchRoute(routes, fallback, pathname) → RouteConfig | undefined

// Middleware (middleware.ts)
runMiddlewarePipeline(input)   → Promise<MiddlewarePipelineResult>

// Guards (guards.ts)
runLeaveGuard(route, params)   → Promise<LeaveGuardResult>
runEnterGuard(route, params)   → Promise<EnterGuardOutcome>

// Lazy loading (lazy.ts)
loadLazyComponent(route, navId, getNavId, onPending) → Promise<LazyLoadResult>

// Outlets (outlets.ts)
applyLayouts(content, route, params, ancestors) → unknown
renderDefaultOutlet(...)  → unknown
renderNamedOutlet(...)    → unknown
```

---

## 14. Security

All security logic lives in `patterns.ts`.

**Pathname sanitization** (`sanitizePathname`) — every pathname entering `goto()` is sanitized. The sanitizer first checks for a single leading `/` — inputs starting with `//`, absolute URLs, `javascript:` injections, and empty strings are rejected immediately and return `/`. Then `new URL()` is used as a normaliser for percent-encoding and dot-segment resolution. A defence-in-depth assertion verifies the parsed host is still `localhost` before returning.

```ts
sanitizePathname('//evil.com')        // → '/'  (protocol-relative blocked)
sanitizePathname('https://evil.com')  // → '/'  (absolute URL blocked)
sanitizePathname('javascript:alert()')// → '/'  (protocol injection blocked)
sanitizePathname('/users/../admin')   // → '/admin'  (normalised)
```

**XSS via History API** — because all input goes through the sanitizer before reaching `pushState` or `replaceState`, it is not possible to inject arbitrary content into browser history via `goto()`.

**Cross-origin link interception** — the click handler in `router.ts` compares `anchor.origin` against the current origin. Links to different origins are never intercepted.

**`tel:` and `mailto:` links** — explicitly excluded from interception.

**`rel="external"` and `download` links** — also excluded from interception.

**Hash+basePath click interception** — in hash mode with a `basePath`, the click handler validates that `anchor.pathname.startsWith(basePath)` before intercepting. Links to other static paths on the same origin are left alone.

---

## 15. Base Path Support

For apps deployed under a sub-path (e.g. served at `https://example.com/my-app/`):

```ts
new Router(this, routes, { basePath: '/my-app' });
```

With `basePath` set:
- `link('/about')` returns `/my-app/about`
- The router strips the base path before matching, so route definitions are always written as plain paths (`/`, `/about`, etc.)
- `_getLocationPathname()` strips the base path when reading the browser URL on `popstate` and initial load

**Combined with hash mode:**

```ts
new Router(this, routes, { mode: 'hash', basePath: '/my-app' });
// /dashboard → https://example.com/my-app/#/dashboard
```

`basePath` lives in the real pathname; the routed path lives in the fragment. The two concerns are independent and compose cleanly.

---

## 16. Debug Mode

```ts
new Router(this, routes, { debug: true });
```

Each navigation logs:
```
[Router] navigating to: /dashboard { replace: false }
[Router] result: { status: 'success' }
```

> ⚠️ Disable in production. Never ship `debug: true`.

---

## 17. Extending the Router

The module structure is designed for extension. Because the feature modules are pure functions, you can replace any single piece without touching the others.

**Custom match strategy** — replace or wrap `matchRoute` from `matching.ts`:

```ts
import { matchRoute } from './router/matching.js';

// Scored matching instead of first-match
const scoredMatchRoute = (routes, fallback, pathname) => {
  // ... custom logic
};
```

**Custom middleware pipeline** — `runMiddlewarePipeline` from `middleware.ts` accepts any array of `NavigationMiddleware` functions. You can build a parallel middleware runner or add tracing without modifying anything else.

**Custom adapter** — to use the router without Lit, subclass `Routes` and swap `ReactiveController` for your framework's equivalent. The `_host` field needs to satisfy `{ addController(c): void; requestUpdate(): void }` — a small interface that most reactive frameworks can satisfy.

```ts
// Hypothetical React adapter (conceptual sketch)
class ReactRoutes extends Routes {
  constructor(setState: () => void, routes: RouteConfig[]) {
    const fakeHost = {
      addController: () => {},
      requestUpdate: () => setState(),
      // ...
    };
    super(fakeHost as any, routes);
  }
}
```

**New adapter** — add a file under `adapters/` that imports from `routes.ts` and your framework's runtime. The existing `adapters/lit.ts` is the reference implementation. The core never imports from adapters.

---

## 18. Unimplemented Features

The following were identified in audits and have **not yet been implemented**. They represent the next phase of work.

**Route transition lifecycle** — no `entering`/`leaving` states are exposed for CSS transition coordination. There is no mechanism to animate the outgoing route out while the incoming route animates in, because both states are not simultaneously accessible. Work needed: expose `_previousRoute` and a transition phase enum, hold both in render until the transition completes.

**Named outlet flicker protection during lazy load** — the default `outlet()` correctly returns `_previousOutlet` while `isPending` is true. Named outlets and layout-wrapped outlets do not have equivalent flicker protection.

**Transition event hooks** — no `before-render` or `after-render` events around the actual DOM update. `navigation-end` fires after state commits but before Lit's render cycle completes. True post-render hooks would require integrating with `updated()` on the host element.

**SSR first-class support** — browser API calls in `router.ts` are guarded with `this._browser`, and `document.title` in `routes.ts` is guarded with `typeof document !== 'undefined'`. But there is no documented server-side `goto()` path for initial render, and no built-in hydration mechanism. The router always re-runs `goto(window.location.pathname)` on connect, which may cause a flash if the SSR output is already correct.

**Route inspection** — no `debug()` or `inspect()` method returning a structured summary of registered routes and current state. Useful in complex nested trees.

**Test utilities** — no `MockRouter` or test helper that accepts a starting pathname and suppresses History API calls. Currently requires a real DOM (`@web/test-runner`) or manual host construction.

**Suspense helper** — `isPending` and `componentError` are exposed, but there is no built-in `<route-suspense>` element or render helper for declarative per-route loading and error UI.

---

## 19. Warnings & Caveats

**One `Router` per page — enforced.** A second `Router` attempting to connect throws immediately. In tests, pass `allowMultiple: true` to suppress the check. The router releases its singleton slot on `hostDisconnected` so the next test can connect cleanly.

**Redirect cycles are detected and terminated.** All redirect sources — declarative `redirect:`, `enter()` returning a string, middleware `ctx.redirect()` — share the same iterative loop in `goto()`. A local `Set<string>` tracks visited pathnames. If a redirect target appears twice, navigation terminates with `navigation-error` and an error message showing the full chain (e.g. `"/login → /dashboard → /login"`). A hard cap of 20 hops also catches non-cyclic unbounded chains.

**`leave()` guard covers address-bar navigation.** The router's `beforeunload` listener triggers the browser's native "Leave site?" dialog when the current route has a `leave` guard. The async `leave()` function itself cannot run in `beforeunload` — browsers prohibit async operations there. The native dialog is the closest approximation available within browser constraints.

**Route mutation — use the mutation API for named routes.** Direct `routes.push()` works for unnamed routes. For routes with a `name`, use `addRoutes()`, `setRoutes()`, or `removeRoute()` — these methods rebuild the named route index atomically. Direct array mutation leaves the index stale, causing `link({ name: '...' })` to miss the new route silently.

**Middleware is composed, not mutated.** `Router.goto()` builds a local composed array of `[...beforeEachHooks, ...middleware]` for each navigation. It does not mutate `this._middleware`. Two concurrent navigations each get their own snapshot and never interfere.

**`activeLink` reads `anchor.pathname`.** If `href` is dynamically bound and not yet resolved at directive application time, a `requestAnimationFrame` defers the first check until after Lit's render cycle. In rare cases with rapid `href` changes there may be a one-frame delay before the active class updates.

**SSR environments.** `router.ts` is fully guarded — will not throw in Node.js. `routes.ts` is safe: `document.title` has a `typeof document !== 'undefined'` guard. `requestAnimationFrame` is not available in Node — `adapters/lit.ts` should not be used in SSR contexts.

---

## 20. Change History

This section documents the issues fixed across two audit rounds. Each entry states what was wrong, what changed, and where in the codebase it lives.

---

### Round 1 — Architectural Gaps

---

#### 20.1 One Router Per Page — From Silent Bug to Enforced Contract

**File:** `router.ts`

Two active `Router` instances caused every anchor click to be handled twice, two ARIA live regions to exist in the DOM, and both instances to race on `aria-current`. No error was surfaced.

A module-level `WeakMap<typeof globalThis, Router>` now acts as a singleton registry. `hostConnected()` checks it and throws a descriptive error if another instance is already registered. `hostDisconnected()` releases the slot. `allowMultiple: true` in `RouterOptions` suppresses the check for test environments.

---

#### 20.2 Redirect Cycles — From Stack Overflow to a Caught Error

**File:** `routes.ts`

Redirects called `this.goto(target)` recursively. A cycle exhausted the call stack with an uncaught `RangeError`, surfacing with no context about which routes were involved.

`goto()` now runs an explicit `redirectLoop: while (true)` iterative loop. A local `Set<string>` (`redirectChain`) tracks visited pathnames per navigation invocation. If a redirect target is already in the set, navigation terminates with a `navigation-error` event showing the full chain. A depth cap of 20 (`MAX_REDIRECT_DEPTH`) catches non-cyclic unbounded chains.

---

#### 20.3 Layout Composition Depth — From Two Levels to Unlimited

**File:** `outlets.ts`

The original `_applyLayout` hard-coded a two-level lookup. Any layout on a grandparent or higher was silently ignored.

`applyLayouts()` now walks the full ancestor chain passed as an array parameter, collecting every `{ layout, params }` pair from innermost to root and applying them in order. There is no depth limit.

---

#### 20.4 `leave()` and Address-Bar Navigation

**File:** `router.ts`

The `leave()` guard ran for in-app navigation but not for address-bar navigation, tab closure, or page reload.

`Router` registers a `beforeunload` listener that calls `event.preventDefault()` and sets `event.returnValue = ''` when the current route has a `leave` guard. The async `leave()` cannot run in `beforeunload` (browsers prohibit async there); the native dialog is the closest approximation.

---

#### 20.5 Hash Mode + `basePath` — From Incompatible to Correctly Composed

**File:** `router.ts`

`mode: 'hash'` and `basePath` were documented as mutually exclusive. `_updateHistory` reused `window.location.pathname` verbatim in hash mode, ignoring `basePath`. The click handler did not validate the static pathname before intercepting.

`_updateHistory` now computes the static base and fragment path independently: `${staticBase}#${routedPath}`. `_getLocationPathname` reads only the fragment in hash mode. The click handler validates `anchor.pathname.startsWith(this.basePath)` in hash+basePath mode.

---

### Round 2 — Security and Correctness Audit

---

#### 20.6 `sanitizePathname` — Protocol-Relative URL Bypass

**File:** `patterns.ts`

`new URL("//evil.com", "http://localhost")` is valid URL syntax. Depending on the parser, it could resolve to `host=evil.com`, constituting an open-redirect vector.

An explicit prefix check now runs before `new URL()` is called:

```ts
if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
```

Any input not starting with exactly one `/` is rejected immediately.

---

#### 20.7 Redirect Handling — From Recursive to Iterative

**File:** `routes.ts`

The Round 1 fix for redirect cycles used a `_redirectChain` parameter threaded through recursive `goto()` calls. This bounded stack depth but didn't eliminate recursion — and the parameter leaked into the public `goto()` signature, allowing callers to interfere with cycle detection.

All redirect recursion was eliminated. `goto()` now uses an explicit `while(true)` loop labelled `redirectLoop`. Redirect sources set `targetPathname` and `continue redirectLoop`. The `_redirectChain` parameter is gone from the public signature entirely.

---

#### 20.8 `_namedRoutes` Index — From Fragile Proxy to Explicit Mutation API

**File:** `routes.ts`

`routes` was wrapped in a `Proxy` to rebuild the named index on `set` traps. `Array.prototype.splice()` calls `set` multiple times in engine-specific order, triggering multiple redundant rebuilds mid-mutation and leaving the index in an intermediate invalid state.

The Proxy was removed. Three explicit mutation methods — `addRoutes()`, `setRoutes()`, `removeRoute()` — each mutate the array then call `_buildNamedRouteIndex()` exactly once. The operation is atomic from the index's perspective.

---

#### 20.9 Lazy Loading Failure — From Silent Blank to Exposed Error State

**File:** `lazy.ts`, `routes.ts`

When a lazy import failed, `_pendingComponent` reset to `false` and `outlet()` returned the previous content — but the template had no signal distinguishing "pending", "failed", and "navigated". The app silently showed stale content.

`loadLazyComponent()` in `lazy.ts` now returns a typed `LazyLoadResult`. `routes.ts` exposes `_componentError` via the `componentError` getter. It is set on failure, cleared at the start of the next load attempt, and cleared on any successful navigation commit. `requestUpdate()` is called on failure so the host can re-render into an error branch immediately.

---

#### 20.10 `resolveRelativePath` — From Accidental Correctness to Explicit Safety

**File:** `patterns.ts`

The original implementation split the base path on `/` without filtering empty segments. `..` traversal near the root produced incorrect results depending on incidental array state. A `|| '/'` fallback masked the bug for some inputs.

The implementation now uses a filtered stack (`split('/').filter(Boolean)`), explicitly pops the last segment before resolving (treating base as a directory), and clamps `..` at an empty stack rather than relying on fallbacks. `'/' + stack.join('/')` is always the return form.
