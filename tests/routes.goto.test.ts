import { describe, it, expect, beforeEach, test } from "vitest";
import * as fc from "fast-check";
import { Routes } from "../src/routes.js";
import { FakeHost } from "./fake-host.js";
import type { RouteConfig, NavigationResult } from "../src/types.js";
import { NavigationEvent } from "../src/events.js";

describe("Routes.goto() navigation tests", () => {
  let host: FakeHost;
  let routes: Routes;

  beforeEach(() => {
    host = new FakeHost();
  });

  describe("basic navigation", () => {
    it("navigates to a simple path", async () => {
      routes = new Routes(host, [
        { path: "/", render: () => "home" },
        { path: "/about", render: () => "about" },
      ]);

      const result = await routes.goto("/about");

      expect(result).toEqual({ status: "success" });
      expect(routes.params).toEqual({});
    });

    it("navigates to a path with params", async () => {
      routes = new Routes(host, [
        { path: "/", render: () => "home" },
        { path: "/user/:id", render: (p) => `user ${p.id}` },
      ]);

      const result = await routes.goto("/user/123");

      expect(result).toEqual({ status: "success" });
      expect(routes.params).toEqual({ id: "123" });
    });

    it("navigates to a wildcard route", async () => {
      routes = new Routes(host, [
        { path: "/", render: () => "home" },
        { path: "/docs/*", render: (p) => `docs ${p[0]}` },
      ]);

      const result = await routes.goto("/docs/guide/intro");

      expect(result).toEqual({ status: "success" });
      expect(routes.params).toEqual({ 0: "guide/intro" });
    });

    it("returns error when no route matches", async () => {
      routes = new Routes(host, [{ path: "/", render: () => "home" }]);

      const result = await routes.goto("/nonexistent");

      expect(result.status).toBe("error");
      expect(result.error).toBeInstanceOf(Error);
      if (result.status === "error") {
        expect((result.error as Error).message).toContain("No route found");
      }
    });

    it("uses fallback route when no route matches", async () => {
      routes = new Routes(host, [{ path: "/", render: () => "home" }], {
        fallback: { render: () => "404" },
      });

      const result = await routes.goto("/nonexistent");

      expect(result).toEqual({ status: "success" });
    });
  });

  describe("NavigationResult return values", () => {
    it("returns success for successful navigation", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      const result = await routes.goto("/test");

      expect(result).toEqual({ status: "success" });
    });

    it("returns cancelled when enter guard returns false", async () => {
      routes = new Routes(host, [
        {
          path: "/protected",
          enter: () => false,
          render: () => "protected",
        },
      ]);

      const result = await routes.goto("/protected");

      expect(result).toEqual({ status: "cancelled" });
    });

    it("returns error when enter guard throws", async () => {
      const error = new Error("Guard error");
      routes = new Routes(host, [
        {
          path: "/error",
          enter: () => {
            throw error;
          },
          render: () => "error",
        },
      ]);

      const result = await routes.goto("/error");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toBe(error);
      }
    });

    it("returns cancelled when middleware cancels", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      routes.use((ctx) => {
        ctx.cancel();
      });

      const result = await routes.goto("/test");

      expect(result).toEqual({ status: "cancelled" });
    });
  });

  describe("navigation event emission", () => {
    it("emits navigation-start at the beginning", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      const events: string[] = [];
      host.addEventListener("navigation-start", () => {
        events.push("start");
      });

      await routes.goto("/test");

      expect(events).toContain("start");
    });

    it("emits navigation-end on success", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      const events: string[] = [];
      host.addEventListener("navigation-end", () => {
        events.push("end");
      });

      await routes.goto("/test");

      expect(events).toContain("end");
    });

    it("emits navigation-cancel when guard cancels", async () => {
      routes = new Routes(host, [
        {
          path: "/test",
          enter: () => false,
          render: () => "test",
        },
      ]);

      const events: string[] = [];
      host.addEventListener("navigation-cancel", () => {
        events.push("cancel");
      });

      await routes.goto("/test");

      expect(events).toContain("cancel");
    });

    it("emits navigation-error on error", async () => {
      routes = new Routes(host, [{ path: "/", render: () => "home" }]);

      const events: string[] = [];
      host.addEventListener("navigation-error", () => {
        events.push("error");
      });

      await routes.goto("/nonexistent");

      expect(events).toContain("error");
    });

    it("emits navigation-redirect on redirect", async () => {
      routes = new Routes(host, [
        { path: "/old", redirect: "/new" },
        { path: "/new", render: () => "new" },
      ]);

      const events: string[] = [];
      host.addEventListener("navigation-redirect", () => {
        events.push("redirect");
      });

      await routes.goto("/old");

      expect(events).toContain("redirect");
    });

    it("emits events in correct order for successful navigation", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      const events: string[] = [];
      host.addEventListener("navigation-start", () => events.push("start"));
      host.addEventListener("navigation-end", () => events.push("end"));

      await routes.goto("/test");

      expect(events).toEqual(["start", "end"]);
    });

    it("provides correct event details", async () => {
      routes = new Routes(host, [
        { path: "/from", render: () => "from" },
        { path: "/to", render: () => "to" },
      ]);

      await routes.goto("/from");

      let eventDetail: any;
      host.addEventListener("navigation-start", (e) => {
        eventDetail = (e as NavigationEvent).detail;
      });

      await routes.goto("/to");

      expect(eventDetail).toMatchObject({
        from: "/from",
        to: "/to",
      });
    });
  });

  describe("redirect chain handling", () => {
    it("follows declarative redirects", async () => {
      routes = new Routes(host, [
        { path: "/a", redirect: "/b" },
        { path: "/b", redirect: "/c" },
        { path: "/c", render: () => "c" },
      ]);

      const result = await routes.goto("/a");

      expect(result).toEqual({ status: "success" });
    });

    it("follows enter guard redirects", async () => {
      routes = new Routes(host, [
        {
          path: "/protected",
          enter: () => "/login",
          render: () => "protected",
        },
        { path: "/login", render: () => "login" },
      ]);

      const result = await routes.goto("/protected");

      expect(result).toEqual({ status: "success" });
    });

    it("follows middleware redirects", async () => {
      routes = new Routes(host, [
        { path: "/old", render: () => "old" },
        { path: "/new", render: () => "new" },
      ]);

      routes.use((ctx) => {
        if (ctx.to === "/old") {
          ctx.redirect("/new");
        }
      });

      const result = await routes.goto("/old");

      expect(result).toEqual({ status: "success" });
    });

    it("detects redirect cycles", async () => {
      routes = new Routes(host, [
        { path: "/a", redirect: "/b" },
        { path: "/b", redirect: "/a" },
      ]);

      const result = await routes.goto("/a");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect((result.error as Error).message).toContain("cycle");
      }
    });

    it("enforces redirect depth limit", async () => {
      const deepRoutes: RouteConfig[] = [];
      for (let i = 0; i < 25; i++) {
        deepRoutes.push({
          path: `/route${i}`,
          redirect: `/route${i + 1}`,
        });
      }
      deepRoutes.push({ path: "/route25", render: () => "end" });

      routes = new Routes(host, deepRoutes);

      const result = await routes.goto("/route0");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect((result.error as Error).message).toContain("depth limit");
      }
    });

    it("emits redirect events for each hop", async () => {
      routes = new Routes(host, [
        { path: "/a", redirect: "/b" },
        { path: "/b", redirect: "/c" },
        { path: "/c", render: () => "c" },
      ]);

      const redirectEvents: string[] = [];
      host.addEventListener("navigation-redirect", (e) => {
        const detail = (e as NavigationEvent).detail;
        redirectEvents.push(`${detail.to}`);
      });

      await routes.goto("/a");

      expect(redirectEvents).toEqual(["/b", "/c"]);
    });
  });

  describe("guard interaction with navigation", () => {
    it("respects enter guard that allows navigation", async () => {
      routes = new Routes(host, [
        {
          path: "/test",
          enter: () => true,
          render: () => "test",
        },
      ]);

      const result = await routes.goto("/test");

      expect(result).toEqual({ status: "success" });
    });

    it("respects enter guard that cancels navigation", async () => {
      routes = new Routes(host, [
        {
          path: "/test",
          enter: () => false,
          render: () => "test",
        },
      ]);

      const result = await routes.goto("/test");

      expect(result).toEqual({ status: "cancelled" });
    });

    it("respects enter guard that redirects", async () => {
      routes = new Routes(host, [
        {
          path: "/protected",
          enter: () => "/login",
          render: () => "protected",
        },
        { path: "/login", render: () => "login" },
      ]);

      const result = await routes.goto("/protected");

      expect(result).toEqual({ status: "success" });
    });

    it("respects leave guard that blocks navigation", async () => {
      routes = new Routes(host, [
        {
          path: "/form",
          leave: () => false,
          render: () => "form",
        },
        { path: "/other", render: () => "other" },
      ]);

      await routes.goto("/form");
      const result = await routes.goto("/other");

      expect(result).toEqual({ status: "cancelled" });
    });

    it("respects leave guard that allows navigation", async () => {
      routes = new Routes(host, [
        {
          path: "/form",
          leave: () => true,
          render: () => "form",
        },
        { path: "/other", render: () => "other" },
      ]);

      await routes.goto("/form");
      const result = await routes.goto("/other");

      expect(result).toEqual({ status: "success" });
    });

    it("handles async guards", async () => {
      routes = new Routes(host, [
        {
          path: "/test",
          enter: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return true;
          },
          render: () => "test",
        },
      ]);

      const result = await routes.goto("/test");

      expect(result).toEqual({ status: "success" });
    });

    it("passes params to guards", async () => {
      let capturedParams: any;
      routes = new Routes(host, [
        {
          path: "/user/:id",
          enter: (params) => {
            capturedParams = params;
            return true;
          },
          render: () => "user",
        },
      ]);

      await routes.goto("/user/123");

      expect(capturedParams).toEqual({ id: "123" });
    });
  });

  describe("lazy loading integration", () => {
    it("loads lazy component on first navigation", async () => {
      routes = new Routes(host, [
        {
          path: "/lazy",
          component: async () => ({
            default: (params: any) => `lazy ${params.id}`,
          }),
        },
      ]);

      const result = await routes.goto("/lazy");

      expect(result).toEqual({ status: "success" });
    });

    it("uses cached component on subsequent navigations", async () => {
      let loadCount = 0;
      routes = new Routes(host, [
        {
          path: "/lazy",
          component: async () => {
            loadCount++;
            return {
              default: () => "lazy",
            };
          },
        },
      ]);

      await routes.goto("/lazy");
      await routes.goto("/lazy");

      expect(loadCount).toBe(1);
    });

    it("returns error when lazy load fails", async () => {
      const error = new Error("Load failed");
      routes = new Routes(host, [
        {
          path: "/lazy",
          component: async () => {
            throw error;
          },
        },
      ]);

      const result = await routes.goto("/lazy");

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toBe(error);
      }
    });

    it("cancels stale lazy loads", async () => {
      let resolveLoad: ((value: any) => void) | undefined;
      routes = new Routes(host, [
        {
          path: "/slow",
          component: () =>
            new Promise((resolve) => {
              resolveLoad = resolve;
            }),
        },
        { path: "/fast", render: () => "fast" },
      ]);

      const slowPromise = routes.goto("/slow");

      // Wait a bit to ensure the component factory has been called
      await new Promise((resolve) => setTimeout(resolve, 10));

      const fastResult = await routes.goto("/fast");

      expect(fastResult).toEqual({ status: "success" });

      // Resolve the slow load after navigation moved on
      if (resolveLoad) {
        resolveLoad({ default: () => "slow" });
      }
      const slowResult = await slowPromise;

      expect(slowResult).toEqual({ status: "cancelled" });
    });

    it("sets isPending during lazy load", async () => {
      let pendingDuringLoad = false;
      routes = new Routes(host, [
        {
          path: "/lazy",
          component: async () => {
            pendingDuringLoad = routes.isPending;
            return { default: () => "lazy" };
          },
        },
      ]);

      await routes.goto("/lazy");

      expect(pendingDuringLoad).toBe(true);
      expect(routes.isPending).toBe(false);
    });

    it("exposes componentError on load failure", async () => {
      const error = new Error("Load failed");
      routes = new Routes(host, [
        {
          path: "/lazy",
          component: async () => {
            throw error;
          },
        },
      ]);

      await routes.goto("/lazy");

      expect(routes.componentError).toBe(error);
    });

    it("clears componentError on successful navigation", async () => {
      const error = new Error("Load failed");
      routes = new Routes(host, [
        {
          path: "/lazy-fail",
          component: async () => {
            throw error;
          },
        },
        { path: "/success", render: () => "success" },
      ]);

      await routes.goto("/lazy-fail");
      expect(routes.componentError).toBe(error);

      await routes.goto("/success");
      expect(routes.componentError).toBeUndefined();
    });
  });

  describe("query string and hash handling", () => {
    it("preserves query string", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      await routes.goto("/test?foo=bar");

      expect(routes.search).toBe("?foo=bar");
      expect(routes.searchParams.get("foo")).toBe("bar");
    });

    it("preserves hash", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      await routes.goto("/test#section");

      expect(routes.hash).toBe("#section");
    });

    it("preserves both query and hash", async () => {
      routes = new Routes(host, [{ path: "/test", render: () => "test" }]);

      await routes.goto("/test?foo=bar#section");

      expect(routes.search).toBe("?foo=bar");
      expect(routes.hash).toBe("#section");
    });
  });

  describe("concurrent navigation safety", () => {
    it("cancels stale navigation when new one starts", async () => {
      let resolveFirst: ((value: any) => void) | undefined;
      routes = new Routes(host, [
        {
          path: "/slow",
          enter: () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
          render: () => "slow",
        },
        { path: "/fast", render: () => "fast" },
      ]);

      const slowPromise = routes.goto("/slow");

      // Wait a bit to ensure the enter guard has been called
      await new Promise((resolve) => setTimeout(resolve, 10));

      const fastResult = await routes.goto("/fast");

      expect(fastResult).toEqual({ status: "success" });

      if (resolveFirst) {
        resolveFirst(true);
      }
      const slowResult = await slowPromise;

      expect(slowResult).toEqual({ status: "cancelled" });
    });
  });

  describe("property-based tests", () => {
    test("Property 9: Navigation result correctness", async () => {
      // Feature: router-testing-and-publishing, Property 9: Navigation result correctness
      // **Validates: Requirements 4.1**
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("success", "cancelled", "error", "redirected"),
          async (scenario) => {
            const localHost = new FakeHost();
            let localRoutes: Routes;
            let result: NavigationResult;

            if (scenario === "success") {
              localRoutes = new Routes(localHost, [
                { path: "/start", render: () => "ok" },
              ]);
              result = await localRoutes.goto("/start");
              return result.status === "success";
            }

            if (scenario === "cancelled") {
              localRoutes = new Routes(localHost, [
                { path: "/start", enter: () => false, render: () => "blocked" },
              ]);
              result = await localRoutes.goto("/start");
              return result.status === "cancelled";
            }

            if (scenario === "redirected") {
              localRoutes = new Routes(localHost, [
                { path: "/start", redirect: "/final" },
                { path: "/final", render: () => "final" },
              ]);
              result = await localRoutes.goto("/start");
              return result.status === "success";
            }

            localRoutes = new Routes(localHost, [{ path: "/known", render: () => "known" }]);
            result = await localRoutes.goto("/missing");
            return result.status === "error";
          }
        ),
        { numRuns: 100 }
      );
    });

    test("Property 10: Navigation event emission", async () => {
      // Feature: router-testing-and-publishing, Property 10: Navigation event emission
      // **Validates: Requirements 4.2**
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("success", "cancelled", "error"),
          async (scenario) => {
            const localHost = new FakeHost();
            let localRoutes: Routes;

            if (scenario === "success") {
              localRoutes = new Routes(localHost, [{ path: "/a", render: () => "a" }]);
            } else if (scenario === "cancelled") {
              localRoutes = new Routes(localHost, [
                { path: "/a", enter: () => false, render: () => "a" },
              ]);
            } else {
              localRoutes = new Routes(localHost, [{ path: "/known", render: () => "known" }]);
            }

            const starts: NavigationEvent[] = [];
            const ends: NavigationEvent[] = [];
            const cancels: NavigationEvent[] = [];
            const errors: NavigationEvent[] = [];

            localHost.addEventListener("navigation-start", (e) => starts.push(e as NavigationEvent));
            localHost.addEventListener("navigation-end", (e) => ends.push(e as NavigationEvent));
            localHost.addEventListener("navigation-cancel", (e) => cancels.push(e as NavigationEvent));
            localHost.addEventListener("navigation-error", (e) => errors.push(e as NavigationEvent));

            const target = scenario === "error" ? "/missing" : "/a";
            await localRoutes.goto(target);

            const terminalCount = ends.length + cancels.length + errors.length;
            if (starts.length !== 1 || terminalCount !== 1) return false;

            if (scenario === "success") return ends.length === 1;
            if (scenario === "cancelled") return cancels.length === 1;
            return errors.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    test("Property 11: Redirect chain following", async () => {
      // Feature: router-testing-and-publishing, Property 11: Redirect chain following
      // **Validates: Requirements 4.3**
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (hops) => {
          const localHost = new FakeHost();
          const localRouteConfig: RouteConfig[] = [];

          for (let i = 0; i < hops; i++) {
            localRouteConfig.push({ path: `/r${i}`, redirect: `/r${i + 1}` });
          }
          localRouteConfig.push({ path: `/r${hops}`, render: () => "done" });

          const localRoutes = new Routes(localHost, localRouteConfig);
          const redirects: string[] = [];

          localHost.addEventListener("navigation-redirect", (e) => {
            redirects.push((e as NavigationEvent).detail.to);
          });

          const result = await localRoutes.goto("/r0");

          const expected = Array.from({ length: hops }, (_, idx) => `/r${idx + 1}`);
          return result.status === "success" && redirects.join("|") === expected.join("|");
        }),
        { numRuns: 100 }
      );
    });

    test("Property 12: Guard decision enforcement", async () => {
      // Feature: router-testing-and-publishing, Property 12: Guard decision enforcement
      // **Validates: Requirements 4.4**
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("enter-allow", "enter-cancel", "enter-redirect", "leave-cancel"),
          async (guardMode) => {
            const localHost = new FakeHost();

            if (guardMode === "enter-allow") {
              const localRoutes = new Routes(localHost, [
                { path: "/target", enter: () => true, render: () => "target" },
              ]);
              const result = await localRoutes.goto("/target");
              return result.status === "success";
            }

            if (guardMode === "enter-cancel") {
              const localRoutes = new Routes(localHost, [
                { path: "/target", enter: () => false, render: () => "target" },
              ]);
              const result = await localRoutes.goto("/target");
              return result.status === "cancelled";
            }

            if (guardMode === "enter-redirect") {
              const localRoutes = new Routes(localHost, [
                { path: "/target", enter: () => "/login", render: () => "target" },
                { path: "/login", render: () => "login" },
              ]);
              const result = await localRoutes.goto("/target");
              return result.status === "success";
            }

            const localRoutes = new Routes(localHost, [
              { path: "/from", leave: () => false, render: () => "from" },
              { path: "/to", render: () => "to" },
            ]);
            const start = await localRoutes.goto("/from");
            const move = await localRoutes.goto("/to");
            return start.status === "success" && move.status === "cancelled";
          }
        ),
        { numRuns: 100 }
      );
    });

    test("Property 13: Lazy loading integration", async () => {
      // Feature: router-testing-and-publishing, Property 13: Lazy loading integration
      // **Validates: Requirements 4.5**
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.integer({ min: 1, max: 6 }),
          async (shouldFail, visits) => {
            const localHost = new FakeHost();
            let loadCount = 0;

            const localRoutes = new Routes(localHost, [
              {
                path: "/lazy",
                component: async () => {
                  loadCount += 1;
                  if (shouldFail) throw new Error("lazy failure");
                  return { default: () => "lazy view" };
                },
              },
            ]);

            if (shouldFail) {
              const result = await localRoutes.goto("/lazy");
              return (
                result.status === "error" &&
                loadCount === 1 &&
                localRoutes.componentError instanceof Error
              );
            }

            for (let i = 0; i < visits; i++) {
              const result = await localRoutes.goto("/lazy");
              if (result.status !== "success") return false;
            }

            return loadCount === 1 && localRoutes.componentError === undefined;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
