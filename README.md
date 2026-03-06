# paisely-router

A production-grade client-side router built on `URLPattern`, with first-class Lit integration.

## Install

```bash
npm i paisely-router
```

## Quick Start

```ts
import { Router } from "paisely-router";
import { LitElement, html } from "lit";

class AppRoot extends LitElement {
  private readonly router = new Router(this, [
    { path: "/", render: () => html`<h1>Home</h1>` },
    { path: "/about", render: () => html`<h1>About</h1>` },
  ]);

  render() {
    return html`
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      ${this.router.outlet()}
    `;
  }
}

customElements.define("app-root", AppRoot);
```

## Features

- URLPattern-based route matching
- Async enter/leave guards
- Middleware pipeline (`cancel`, `redirect`)
- Lazy route component loading
- Nested routes and named outlets
- Accessibility helpers (`aria-current`, live region announcements)

## Docs

- Full documentation: <https://github.com/johnnysedh3lllo/paisely-router/docs/#readme>
- Publishing guide: `Publishing to NPM.md`
- Testing workflow: `testing-workflow.md`

## License

MIT
