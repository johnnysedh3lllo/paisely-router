import { describe, it, expect, test } from "vitest";
import * as fc from "fast-check";
import type { RouteConfig } from "../src/types.js";
import { loadLazyComponent } from "../src/lazy.js";

const createRoute = (): RouteConfig =>
  ({
    path: "/lazy",
    component: async () => ({
      default: (params: unknown) => ({ renderedWith: params }),
    }),
  } as RouteConfig);

describe("loadLazyComponent", () => {
  it("attaches a render function on success", async () => {
    const route = createRoute();
    const result = await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    expect(result.status).toBe("success");
    expect(typeof route.render).toBe("function");
    const rendered = route.render?.({ id: "123" } as any);
    expect(rendered).toEqual({ renderedWith: { id: "123" } });
  });

  it("returns cancelled if navigation id has changed", async () => {
    const route = createRoute();
    const result = await loadLazyComponent(
      route,
      1,
      () => 2,
      () => {}
    );

    expect(result.status).toBe("cancelled");
  });

  it("propagates errors from the component loader", async () => {
    const error = new Error("failed");
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => {
        throw error;
      },
    } as RouteConfig;

    const result = await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    expect(result.status).toBe("error");
    expect(result.error).toBe(error);
  });

  it("does not attach render function when cancelled", async () => {
    const route = createRoute();
    await loadLazyComponent(
      route,
      1,
      () => 2, // Navigation ID changed
      () => {}
    );

    // Render function should not be attached when cancelled
    expect(route.render).toBeUndefined();
  });

  it("does not attach render function on error", async () => {
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => {
        throw new Error("load failed");
      },
    } as RouteConfig;

    await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    // Render function should not be attached on error
    expect(route.render).toBeUndefined();
  });

  it("calls onPending with true at start and false at end", async () => {
    const route = createRoute();
    const pendingCalls: boolean[] = [];

    await loadLazyComponent(
      route,
      1,
      () => 1,
      (pending) => pendingCalls.push(pending)
    );

    expect(pendingCalls).toEqual([true, false]);
  });

  it("calls onPending false even when cancelled", async () => {
    const route = createRoute();
    const pendingCalls: boolean[] = [];

    await loadLazyComponent(
      route,
      1,
      () => 2, // Navigation ID changed
      (pending) => pendingCalls.push(pending)
    );

    expect(pendingCalls).toEqual([true, false]);
  });

  it("calls onPending false even on error", async () => {
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => {
        throw new Error("failed");
      },
    } as RouteConfig;
    const pendingCalls: boolean[] = [];

    await loadLazyComponent(
      route,
      1,
      () => 1,
      (pending) => pendingCalls.push(pending)
    );

    expect(pendingCalls).toEqual([true, false]);
  });

  it("skips loading if route already has a render function", async () => {
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => ({
        default: () => "new",
      }),
      render: () => "existing",
    } as RouteConfig;

    const result = await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    expect(result.status).toBe("success");
    // Should keep the existing render function
    expect(route.render?.({} as any)).toBe("existing");
  });

  it("skips loading if route has no component factory", async () => {
    const route: RouteConfig = {
      path: "/lazy",
    } as RouteConfig;

    const result = await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    expect(result.status).toBe("success");
    expect(route.render).toBeUndefined();
  });

  it("handles component that exports a non-function default", async () => {
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => ({
        default: { type: "static-content" },
      }),
    } as RouteConfig;

    const result = await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    expect(result.status).toBe("success");
    expect(typeof route.render).toBe("function");
    // Should return the static content directly
    const rendered = route.render?.({} as any);
    expect(rendered).toEqual({ type: "static-content" });
  });

  it("passes params at render time, not load time", async () => {
    const route: RouteConfig = {
      path: "/lazy",
      component: async () => ({
        default: (params: any) => ({ params }),
      }),
    } as RouteConfig;

    await loadLazyComponent(
      route,
      1,
      () => 1,
      () => {}
    );

    // Render with different params each time
    const result1 = route.render?.({ id: "1" } as any);
    const result2 = route.render?.({ id: "2" } as any);

    // Should use the params passed at render time, not captured at load time
    expect(result1).toEqual({ params: { id: "1" } });
    expect(result2).toEqual({ params: { id: "2" } });
  });
});

test("Property 7: Lazy load cancellation safety", async () => {
  // Feature: router-testing-and-publishing, Property 7: Lazy load cancellation safety
  // **Validates: Requirements 3.5**

  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1000 }), // currentNavId
      fc.integer({ min: 1, max: 1000 }), // newNavId returned by getNavId
      fc.oneof(fc.constant("success"), fc.constant("error")), // load outcome
      async (currentNavId, newNavId, loadOutcome) => {
        const route: RouteConfig = {
          path: "/lazy",
          component: async () => {
            if (loadOutcome === "error") {
              throw new Error("Load failed");
            }
            return {
              default: (params: any) => ({ params }),
            };
          },
        } as RouteConfig;

        const result = await loadLazyComponent(
          route,
          currentNavId,
          () => newNavId,
          () => {}
        );

        // If load fails, should always return error regardless of navId
        if (loadOutcome === "error") {
          return result.status === "error" && route.render === undefined;
        }

        // If load succeeds but navigation ID changed, should be cancelled
        if (currentNavId !== newNavId) {
          return result.status === "cancelled" && route.render === undefined;
        }

        // If load succeeds and navigation ID didn't change, should succeed
        return (
          result.status === "success" && typeof route.render === "function"
        );
      }
    ),
    { numRuns: 100 }
  );
});
