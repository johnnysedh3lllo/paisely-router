import { describe, it, expect, test } from "vitest";
import * as fc from "fast-check";
import type { RouteConfig, RouteParams, LayoutFn } from "../src/types.js";
import {
  applyLayouts,
  renderDefaultOutlet,
  renderNamedOutlet,
} from "../src/outlets.js";

const makeRoute = (options: Partial<RouteConfig> = {}): RouteConfig =>
  ({
    path: "/",
    ...options,
  } as RouteConfig);

describe("applyLayouts", () => {
  it("applies route and ancestor layouts from inner to outer", () => {
    const calls: string[] = [];

    const rootLayout: LayoutFn = (content, _params) => {
      calls.push("root");
      return { root: content };
    };
    const childLayout: LayoutFn = (content, _params) => {
      calls.push("child");
      return { child: content };
    };

    const route = makeRoute({ layout: childLayout });
    const ancestors = [
      { route: makeRoute({ layout: rootLayout }), params: {} as RouteParams },
    ];

    const result = applyLayouts("content", route, {} as RouteParams, ancestors);

    expect(calls).toEqual(["child", "root"]);
    expect(result).toEqual({ root: { child: "content" } });
  });

  it("handles routes without layouts", () => {
    const route = makeRoute();
    const ancestors: Array<{
      route: RouteConfig | undefined;
      params: RouteParams;
    }> = [];

    const result = applyLayouts("content", route, {} as RouteParams, ancestors);

    expect(result).toBe("content");
  });

  it("applies multiple ancestor layouts in correct order", () => {
    const calls: string[] = [];

    const rootLayout: LayoutFn = (content, _params) => {
      calls.push("root");
      return { root: content };
    };
    const middleLayout: LayoutFn = (content, _params) => {
      calls.push("middle");
      return { middle: content };
    };
    const childLayout: LayoutFn = (content, _params) => {
      calls.push("child");
      return { child: content };
    };

    const route = makeRoute({ layout: childLayout });
    const ancestors = [
      { route: makeRoute({ layout: middleLayout }), params: {} as RouteParams },
      { route: makeRoute({ layout: rootLayout }), params: {} as RouteParams },
    ];

    const result = applyLayouts("content", route, {} as RouteParams, ancestors);

    expect(calls).toEqual(["child", "middle", "root"]);
    expect(result).toEqual({ root: { middle: { child: "content" } } });
  });

  it("skips ancestors without layouts", () => {
    const calls: string[] = [];

    const rootLayout: LayoutFn = (content, _params) => {
      calls.push("root");
      return { root: content };
    };
    const childLayout: LayoutFn = (content, _params) => {
      calls.push("child");
      return { child: content };
    };

    const route = makeRoute({ layout: childLayout });
    const ancestors = [
      { route: makeRoute(), params: {} as RouteParams }, // no layout
      { route: makeRoute({ layout: rootLayout }), params: {} as RouteParams },
    ];

    const result = applyLayouts("content", route, {} as RouteParams, ancestors);

    expect(calls).toEqual(["child", "root"]);
    expect(result).toEqual({ root: { child: "content" } });
  });
});

describe("renderDefaultOutlet", () => {
  it("returns previous content while pending", () => {
    const route = makeRoute({
      render: () => "should-not-be-used",
    });

    const result = renderDefaultOutlet(
      route,
      {} as RouteParams,
      true,
      "previous",
      () => {},
      (c) => c
    );

    expect(result).toBe("previous");
  });

  it("renders current route when not pending", () => {
    const route = makeRoute({
      render: () => "current",
    });

    const result = renderDefaultOutlet(
      route,
      {} as RouteParams,
      false,
      "previous",
      () => {},
      (c) => c
    );

    expect(result).toBe("current");
  });

  it("applies layout to rendered content", () => {
    const route = makeRoute({
      render: () => "content",
    });

    const result = renderDefaultOutlet(
      route,
      {} as RouteParams,
      false,
      "previous",
      () => {},
      (c) => ({ wrapped: c })
    );

    expect(result).toEqual({ wrapped: "content" });
  });

  it("handles routes without render function", () => {
    const route = makeRoute();

    const result = renderDefaultOutlet(
      route,
      {} as RouteParams,
      false,
      "previous",
      () => {},
      (c) => c
    );

    expect(result).toBeUndefined();
  });

  it("calls onError and returns undefined when render throws", () => {
    let errorCaught: unknown;
    const route = makeRoute({
      render: () => {
        throw new Error("render error");
      },
    });

    const result = renderDefaultOutlet(
      route,
      {} as RouteParams,
      false,
      "previous",
      (err) => {
        errorCaught = err;
      },
      (c) => c
    );

    expect(result).toBeUndefined();
    expect(errorCaught).toBeInstanceOf(Error);
    expect((errorCaught as Error).message).toBe("render error");
  });
});

describe("renderNamedOutlet", () => {
  it("yields to siblings that already own the outlet", () => {
    const route = makeRoute({
      outlets: {
        sidebar: () => "sidebar",
      },
    });

    const activeOutlets = new Set<string>();
    const siblingActive = [new Set<string>(["sidebar"])];

    const result = renderNamedOutlet(
      "sidebar",
      route,
      {} as RouteParams,
      activeOutlets,
      siblingActive,
      () => {},
      (c) => c
    );

    expect(result).toBeUndefined();
    expect(activeOutlets.has("sidebar")).toBe(false);
  });

  it("claims the outlet and applies layout when available", () => {
    const route = makeRoute({
      outlets: {
        sidebar: () => "sidebar",
      },
    });

    const activeOutlets = new Set<string>();
    const siblingActive: Array<Set<string>> = [];

    const result = renderNamedOutlet(
      "sidebar",
      route,
      {} as RouteParams,
      activeOutlets,
      siblingActive,
      () => {},
      (c) => ({ wrapped: c })
    );

    expect(result).toEqual({ wrapped: "sidebar" });
    expect(activeOutlets.has("sidebar")).toBe(true);
  });

  it("returns undefined when outlet function does not exist", () => {
    const route = makeRoute({
      outlets: {
        header: () => "header",
      },
    });

    const activeOutlets = new Set<string>(["sidebar"]);
    const siblingActive: Array<Set<string>> = [];

    const result = renderNamedOutlet(
      "sidebar",
      route,
      {} as RouteParams,
      activeOutlets,
      siblingActive,
      () => {},
      (c) => c
    );

    expect(result).toBeUndefined();
    expect(activeOutlets.has("sidebar")).toBe(false);
  });

  it("calls onError and returns undefined when outlet throws", () => {
    let errorCaught: unknown;
    const route = makeRoute({
      outlets: {
        sidebar: () => {
          throw new Error("outlet error");
        },
      },
    });

    const activeOutlets = new Set<string>();
    const siblingActive: Array<Set<string>> = [];

    const result = renderNamedOutlet(
      "sidebar",
      route,
      {} as RouteParams,
      activeOutlets,
      siblingActive,
      (err) => {
        errorCaught = err;
      },
      (c) => c
    );

    expect(result).toBeUndefined();
    expect(errorCaught).toBeInstanceOf(Error);
    expect((errorCaught as Error).message).toBe("outlet error");
    expect(activeOutlets.has("sidebar")).toBe(false);
  });

  it("removes outlet from activeOutlets when outlet function is missing", () => {
    const route = makeRoute({
      outlets: {},
    });

    const activeOutlets = new Set<string>(["sidebar"]);
    const siblingActive: Array<Set<string>> = [];

    const result = renderNamedOutlet(
      "sidebar",
      route,
      {} as RouteParams,
      activeOutlets,
      siblingActive,
      () => {},
      (c) => c
    );

    expect(result).toBeUndefined();
    expect(activeOutlets.has("sidebar")).toBe(false);
  });
});

// Property-Based Tests

test("Property 8: Layout composition order", () => {
  // Feature: router-testing-and-publishing, Property 8: Layout composition order
  // **Validates: Requirements 3.6**
  fc.assert(
    fc.property(
      // Generate a random number of ancestor layouts (0-5)
      fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: 0,
        maxLength: 5,
      }),
      // Generate whether the current route has a layout
      fc.boolean(),
      (ancestorIds, hasRouteLayout) => {
        const executionOrder: number[] = [];

        // Create layout functions that record their execution order
        const createLayout = (id: number): LayoutFn => {
          return (content, _params) => {
            executionOrder.push(id);
            return { [`layout_${id}`]: content };
          };
        };

        // Create the current route with optional layout
        const routeId = -1; // Use -1 for the route's own layout
        const route = hasRouteLayout
          ? makeRoute({ layout: createLayout(routeId) })
          : makeRoute();

        // Create ancestors with layouts
        const ancestors = ancestorIds.map((id) => ({
          route: makeRoute({ layout: createLayout(id) }),
          params: {} as RouteParams,
        }));

        // Apply layouts
        const result = applyLayouts(
          "content",
          route,
          {} as RouteParams,
          ancestors
        );

        // Verify execution order: route layout first (if exists), then ancestors in order
        const expectedOrder: number[] = [];
        if (hasRouteLayout) {
          expectedOrder.push(routeId);
        }
        expectedOrder.push(...ancestorIds);

        // Check that layouts were applied in the correct order
        if (executionOrder.length !== expectedOrder.length) {
          return false;
        }

        for (let i = 0; i < executionOrder.length; i++) {
          if (executionOrder[i] !== expectedOrder[i]) {
            return false;
          }
        }

        // Verify the result structure is nested correctly (innermost to outermost)
        let current: any = result;
        for (let i = expectedOrder.length - 1; i >= 0; i--) {
          const layoutId = expectedOrder[i];
          const key = `layout_${layoutId}`;
          if (typeof current !== "object" || !(key in current)) {
            return false;
          }
          current = current[key];
        }

        // The innermost content should be the original "content" string
        return current === "content";
      }
    ),
    { numRuns: 100 }
  );
});
