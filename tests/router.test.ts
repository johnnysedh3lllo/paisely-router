import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import * as fc from "fast-check";
import { Router } from "../src/router.js";
import { FakeHost } from "./fake-host.js";
import type { RouteConfig } from "../src/types.js";

const activeHosts: FakeHost[] = [];

const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createRouter = (routes: RouteConfig[]): { host: FakeHost; router: Router } => {
  const host = new FakeHost();
  const router = new Router(host, routes, { allowMultiple: true });
  // FakeHost connects controllers immediately during super(), before Router
  // has initialized browser flags, so connect once more after construction.
  router.hostConnected();
  activeHosts.push(host);
  return { host, router };
};

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  document.title = "";

  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(0);
    return 1;
  });
});

afterEach(() => {
  for (const host of activeHosts.splice(0)) {
    host.disconnectAll();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Router integration tests", () => {
  it("intercepts same-origin link clicks and navigates without reload", async () => {
    const { router } = createRouter([
      { path: "/", render: () => "home" },
      { path: "/about", render: () => "about" },
    ]);

    const anchor = document.createElement("a");
    anchor.href = "/about";
    document.body.appendChild(anchor);

    const gotoSpy = vi.spyOn(router, "goto");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    const dispatchResult = anchor.dispatchEvent(event);
    await flushAsync();

    expect(dispatchResult).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(gotoSpy).toHaveBeenCalledWith("/about", {
      replace: false,
      preserveSearch: false,
    });
    expect(window.location.pathname).toBe("/about");
  });

  it("invokes history.back when back() is called", () => {
    const { router } = createRouter([{ path: "/", render: () => "home" }]);
    const backSpy = vi.spyOn(window.history, "back");

    router.back();

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("invokes history.forward when forward() is called", () => {
    const { router } = createRouter([{ path: "/", render: () => "home" }]);
    const forwardSpy = vi.spyOn(window.history, "forward");

    router.forward();

    expect(forwardSpy).toHaveBeenCalledTimes(1);
  });

  it("updates aria-current on active links after navigation", async () => {
    const home = document.createElement("a");
    home.href = "/";
    const about = document.createElement("a");
    about.href = "/about";
    const contact = document.createElement("a");
    contact.href = "/contact";
    document.body.append(home, about, contact);

    const { router } = createRouter([
      { path: "/", render: () => "home" },
      { path: "/about", render: () => "about" },
      { path: "/contact", render: () => "contact" },
    ]);

    await router.goto("/about");

    expect(about.getAttribute("aria-current")).toBe("page");
    expect(home.hasAttribute("aria-current")).toBe(false);
    expect(contact.hasAttribute("aria-current")).toBe(false);

    await router.goto("/contact");

    expect(contact.getAttribute("aria-current")).toBe("page");
    expect(about.hasAttribute("aria-current")).toBe(false);
    expect(home.hasAttribute("aria-current")).toBe(false);
  });

  it("updates the ARIA live region with the route title", async () => {
    const { host, router } = createRouter([
      { path: "/", render: () => "home" },
      {
        path: "/reports",
        render: () => "reports",
        meta: { title: "Reports" },
      },
    ]);
    await flushAsync();

    const anchor = document.createElement("a");
    anchor.href = "/reports";
    document.body.appendChild(anchor);

    const navigationCompleted = new Promise<void>((resolve) => {
      const done = (): void => {
        host.removeEventListener("navigation-end", done as EventListener);
        resolve();
      };
      host.addEventListener("navigation-end", done as EventListener);
    });
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    );
    await navigationCompleted;
    await flushAsync();

    const announcer = document.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(announcer).toBeTruthy();
    expect(announcer?.textContent).toContain("Reports");
    expect(window.location.pathname).toBe("/reports");
    expect(router.currentMeta?.title).toBe("Reports");
  });
});

describe("Router property-based tests", () => {
  test("Property 14: Same-origin link interception", async () => {
    // Feature: router-testing-and-publishing, Property 14: Same-origin link interception
    // **Validates: Requirements 5.1**
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 500 }),
        fc.boolean(),
        fc.boolean(),
        async (id, includeQuery, includeHash) => {
          window.history.replaceState({}, "", "/");
          createRouter([
            { path: "/", render: () => "home" },
            { path: "/next", render: () => "next" },
          ]);

          const anchor = document.createElement("a");
          const query = includeQuery ? `?id=${id}` : "";
          const hash = includeHash ? "#details" : "";
          anchor.href = `/next${query}${hash}`;
          document.body.appendChild(anchor);

          const event = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
          });

          anchor.dispatchEvent(event);
          await flushAsync();

          return event.defaultPrevented && window.location.pathname === "/next";
        }
      ),
      { numRuns: 100 }
    );
  });

  test("Property 15: Aria-current attribute updates", async () => {
    // Feature: router-testing-and-publishing, Property 15: Aria-current attribute updates
    // **Validates: Requirements 5.4**
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 99 }), {
          minLength: 2,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 20 }),
        async (ids, rawIndex) => {
          const paths = ids.map((id) => `/p${id}`);
          const targetPath = paths[rawIndex % paths.length];

          for (const path of paths) {
            const anchor = document.createElement("a");
            anchor.href = path;
            document.body.appendChild(anchor);
          }

          const routes: RouteConfig[] = [
            { path: "/", render: () => "home" },
            ...paths.map((path) => ({ path, render: () => path })),
          ];

          const { router } = createRouter(routes);
          const result = await router.goto(targetPath);
          if (result.status !== "success") return false;

          const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
          return anchors.every((anchor) => {
            const isTarget = anchor.pathname === targetPath;
            return isTarget
              ? anchor.getAttribute("aria-current") === "page"
              : !anchor.hasAttribute("aria-current");
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("Property 16: ARIA live region announcements", async () => {
    // Feature: router-testing-and-publishing, Property 16: ARIA live region announcements
    // **Validates: Requirements 5.5**
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9 ]{0,28}[A-Za-z0-9])?$/),
        async (id, title) => {
          const path = `/r${id}`;
          window.history.replaceState({}, "", "/");
          const { router } = createRouter([
            { path: "/", render: () => "home" },
            { path, render: () => "target", meta: { title } },
          ]);
          await flushAsync();

          await (router as any)._navigate(path);
          await flushAsync();

          const announcer = document.querySelector<HTMLElement>('[aria-live="polite"]');
          const text = announcer?.textContent ?? "";
          return router.currentMeta?.title === title && text.trim().length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
