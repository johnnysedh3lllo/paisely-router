import { describe, it, expect } from "vitest";
import { runMiddlewarePipeline } from "../src/middleware.js";
import type {
  NavigationMiddleware,
  RouteParams,
  RouteMeta,
} from "../src/types.js";
import * as fc from "fast-check";

const baseInput = (
  overrides: {
    middleware?: NavigationMiddleware[];
    from?: string;
    to?: string;
    params?: RouteParams;
    meta?: RouteMeta;
  } = {}
) => ({
  middleware: overrides.middleware ?? [],
  from: overrides.from,
  to: overrides.to ?? "/target",
  params: overrides.params ?? {},
  meta: overrides.meta,
});

describe("runMiddlewarePipeline", () => {
  describe("execution order", () => {
    it("runs middleware in insertion order", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("first");
          await ctx.next();
        },
        async (ctx) => {
          calls.push("second");
          await ctx.next();
        },
        async (ctx) => {
          calls.push("third");
        },
      ];

      await runMiddlewarePipeline(baseInput({ middleware: mw }));

      expect(calls).toEqual(["first", "second", "third"]);
    });

    it("runs middleware in order with explicit next() calls", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("mw1:start");
          await ctx.next();
          calls.push("mw1:end");
        },
        async (ctx) => {
          calls.push("mw2:start");
          await ctx.next();
          calls.push("mw2:end");
        },
        async (ctx) => {
          calls.push("mw3");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "success" });
      expect(calls).toEqual([
        "mw1:start",
        "mw2:start",
        "mw3",
        "mw2:end",
        "mw1:end",
      ]);
    });

    it("executes middleware sequentially even with async operations", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("mw1:start");
          await new Promise((resolve) => setTimeout(resolve, 10));
          calls.push("mw1:delayed");
          await ctx.next();
          calls.push("mw1:end");
        },
        async (ctx) => {
          calls.push("mw2");
        },
      ];

      await runMiddlewarePipeline(baseInput({ middleware: mw }));

      expect(calls).toEqual(["mw1:start", "mw1:delayed", "mw2", "mw1:end"]);
    });

    it("handles empty middleware array", async () => {
      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: [] })
      );
      expect(result).toEqual({ status: "success" });
    });

    it("handles single middleware", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("only");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "success" });
      expect(calls).toEqual(["only"]);
    });
  });

  describe("cancel operations", () => {
    it("can cancel navigation", async () => {
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          ctx.cancel();
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );
      expect(result).toEqual({ status: "cancelled" });
    });

    it("stops pipeline when middleware cancels", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("first");
          await ctx.next();
        },
        (ctx) => {
          calls.push("second");
          ctx.cancel();
        },
        async (ctx) => {
          calls.push("third");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "cancelled" });
      expect(calls).toEqual(["first", "second"]);
    });

    it("does not execute remaining middleware after cancel", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          calls.push("first");
          ctx.cancel();
        },
        async (ctx) => {
          calls.push("second");
        },
      ];

      await runMiddlewarePipeline(baseInput({ middleware: mw }));

      expect(calls).toEqual(["first"]);
    });

    it("allows middleware to cancel before calling next", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("before-cancel");
          ctx.cancel();
          calls.push("after-cancel");
          // Even if we call next after cancel, it shouldn't proceed
          await ctx.next();
          calls.push("after-next");
        },
        async (ctx) => {
          calls.push("should-not-run");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "cancelled" });
      expect(calls).toEqual(["before-cancel", "after-cancel", "after-next"]);
    });
  });

  describe("redirect operations", () => {
    it("can redirect navigation", async () => {
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          ctx.redirect("/elsewhere");
        },
      ];

      const { result, redirectTarget } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );
      expect(result).toEqual({ status: "redirected", to: "/elsewhere" });
      expect(redirectTarget).toBe("/elsewhere");
    });

    it("stops pipeline when middleware redirects", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("first");
          await ctx.next();
        },
        (ctx) => {
          calls.push("second");
          ctx.redirect("/new-path");
        },
        async (ctx) => {
          calls.push("third");
        },
      ];

      const { result, redirectTarget } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "redirected", to: "/new-path" });
      expect(redirectTarget).toBe("/new-path");
      expect(calls).toEqual(["first", "second"]);
    });

    it("does not execute remaining middleware after redirect", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          calls.push("first");
          ctx.redirect("/redirect-target");
        },
        async (ctx) => {
          calls.push("second");
        },
      ];

      await runMiddlewarePipeline(baseInput({ middleware: mw }));

      expect(calls).toEqual(["first"]);
    });

    it("allows middleware to redirect before calling next", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("before-redirect");
          ctx.redirect("/target");
          calls.push("after-redirect");
          // Even if we call next after redirect, it shouldn't proceed
          await ctx.next();
          calls.push("after-next");
        },
        async (ctx) => {
          calls.push("should-not-run");
        },
      ];

      const { result, redirectTarget } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "redirected", to: "/target" });
      expect(redirectTarget).toBe("/target");
      expect(calls).toEqual([
        "before-redirect",
        "after-redirect",
        "after-next",
      ]);
    });

    it("handles redirect with various pathname formats", async () => {
      const testCases = [
        "/simple",
        "/path/with/segments",
        "/path?query=value",
        "/path#hash",
        "/path?query=value#hash",
      ];

      for (const pathname of testCases) {
        const mw: NavigationMiddleware[] = [
          (ctx) => {
            ctx.redirect(pathname);
          },
        ];

        const { result, redirectTarget } = await runMiddlewarePipeline(
          baseInput({ middleware: mw })
        );

        expect(result).toEqual({ status: "redirected", to: pathname });
        expect(redirectTarget).toBe(pathname);
      }
    });
  });

  describe("auto-advance behavior", () => {
    it("auto-advances when middleware does not call next", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("first");
          // No next() call - should auto-advance
        },
        async (ctx) => {
          calls.push("second");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "success" });
      expect(calls).toEqual(["first", "second"]);
    });

    it("auto-advances through multiple middleware without explicit next", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("first");
        },
        async (ctx) => {
          calls.push("second");
        },
        async (ctx) => {
          calls.push("third");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "success" });
      expect(calls).toEqual(["first", "second", "third"]);
    });

    it("does not auto-advance after cancel", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          calls.push("first");
          ctx.cancel();
          // No next() call, but cancelled - should not auto-advance
        },
        async (ctx) => {
          calls.push("second");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "cancelled" });
      expect(calls).toEqual(["first"]);
    });

    it("does not auto-advance after redirect", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          calls.push("first");
          ctx.redirect("/target");
          // No next() call, but redirected - should not auto-advance
        },
        async (ctx) => {
          calls.push("second");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "redirected", to: "/target" });
      expect(calls).toEqual(["first"]);
    });

    it("mixes explicit next and auto-advance", async () => {
      const calls: string[] = [];
      const mw: NavigationMiddleware[] = [
        async (ctx) => {
          calls.push("mw1:start");
          await ctx.next();
          calls.push("mw1:end");
        },
        async (ctx) => {
          calls.push("mw2");
          // No next() - auto-advance
        },
        async (ctx) => {
          calls.push("mw3");
        },
      ];

      const { result } = await runMiddlewarePipeline(
        baseInput({ middleware: mw })
      );

      expect(result).toEqual({ status: "success" });
      expect(calls).toEqual(["mw1:start", "mw2", "mw3", "mw1:end"]);
    });
  });

  describe("context properties", () => {
    it("provides correct navigation context to middleware", async () => {
      let capturedContext: any;
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          capturedContext = { ...ctx };
          delete capturedContext.next;
          delete capturedContext.cancel;
          delete capturedContext.redirect;
        },
      ];

      await runMiddlewarePipeline(
        baseInput({
          middleware: mw,
          from: "/old",
          to: "/new",
          params: { id: "123" },
          meta: { title: "Test" },
        })
      );

      expect(capturedContext).toEqual({
        from: "/old",
        to: "/new",
        params: { id: "123" },
        meta: { title: "Test" },
      });
    });

    it("provides undefined from when not specified", async () => {
      let capturedFrom: any;
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          capturedFrom = ctx.from;
        },
      ];

      await runMiddlewarePipeline(
        baseInput({
          middleware: mw,
          to: "/target",
        })
      );

      expect(capturedFrom).toBeUndefined();
    });

    it("provides undefined meta when not specified", async () => {
      let capturedMeta: any;
      const mw: NavigationMiddleware[] = [
        (ctx) => {
          capturedMeta = ctx.meta;
        },
      ];

      await runMiddlewarePipeline(
        baseInput({
          middleware: mw,
          to: "/target",
        })
      );

      expect(capturedMeta).toBeUndefined();
    });
  });

  describe("property-based tests", () => {
    it("Property 5: Middleware execution order", async () => {
      // Feature: router-testing-and-publishing, Property 5: Middleware execution order
      // **Validates: Requirements 3.3**
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (middlewareCount) => {
            const executionOrder: number[] = [];
            const middleware: NavigationMiddleware[] = [];

            // Create middleware that records execution order
            for (let i = 0; i < middlewareCount; i++) {
              const index = i;
              middleware.push(async (ctx) => {
                executionOrder.push(index);
                await ctx.next();
              });
            }

            const { result } = await runMiddlewarePipeline(
              baseInput({ middleware })
            );

            // Verify execution order matches insertion order
            const expectedOrder = Array.from(
              { length: middlewareCount },
              (_, i) => i
            );

            return (
              result.status === "success" &&
              executionOrder.length === middlewareCount &&
              executionOrder.every((val, idx) => val === expectedOrder[idx])
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
