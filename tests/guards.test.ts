import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { RouteConfig, RouteParams } from "../src/types.js";
import { runEnterGuard, runLeaveGuard } from "../src/guards.js";

const params: RouteParams = { id: "123" };

describe("runLeaveGuard", () => {
  it("allows navigation when no leave guard is defined", async () => {
    const route: RouteConfig = { path: "/" };
    const result = await runLeaveGuard(route, params);
    expect(result).toEqual({ allowed: true });
  });

  it("allows navigation when leave returns true", async () => {
    const route: RouteConfig = {
      path: "/",
      leave: () => true,
    };
    const result = await runLeaveGuard(route, params);
    expect(result).toEqual({ allowed: true });
  });

  it("allows navigation when leave returns undefined", async () => {
    const route: RouteConfig = {
      path: "/",
      leave: () => {},
    };
    const result = await runLeaveGuard(route, params);
    expect(result).toEqual({ allowed: true });
  });

  it("blocks navigation when leave returns false", async () => {
    const route: RouteConfig = {
      path: "/",
      leave: () => false,
    };
    const result = await runLeaveGuard(route, params);
    expect(result).toEqual({ allowed: false });
  });

  it("returns an error when leave throws", async () => {
    const error = new Error("boom");
    const route: RouteConfig = {
      path: "/",
      leave: () => {
        throw error;
      },
    };
    const result = await runLeaveGuard(route, params);
    expect(result.allowed).toBe(false);
    expect(result.error).toBe(error);
  });
});

describe("runEnterGuard", () => {
  it("allows when no enter guard is defined", async () => {
    const route: RouteConfig = { path: "/" };
    const result = await runEnterGuard(route, params);
    expect(result).toEqual({ type: "allow" });
  });

  it("allows when enter returns true", async () => {
    const route: RouteConfig = {
      path: "/",
      enter: () => true,
    };
    const result = await runEnterGuard(route, params);
    expect(result).toEqual({ type: "allow" });
  });

  it("allows when enter returns void/undefined", async () => {
    const route: RouteConfig = {
      path: "/",
      enter: () => {},
    };
    const result = await runEnterGuard(route, params);
    expect(result).toEqual({ type: "allow" });
  });

  it("cancels when enter returns false", async () => {
    const route: RouteConfig = {
      path: "/",
      enter: () => false,
    };
    const result = await runEnterGuard(route, params);
    expect(result).toEqual({ type: "cancel" });
  });

  it("redirects when enter returns a string", async () => {
    const route: RouteConfig = {
      path: "/",
      enter: () => "/login",
    };
    const result = await runEnterGuard(route, params);
    expect(result).toEqual({ type: "redirect", target: "/login" });
  });

  it("returns error when enter throws", async () => {
    const error = new Error("boom");
    const route: RouteConfig = {
      path: "/",
      enter: () => {
        throw error;
      },
    };
    const result = await runEnterGuard(route, params);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toBe(error);
    }
  });
});

describe("Property-Based Tests", () => {
  it("Property 6: Guard return type handling", async () => {
    // Feature: router-testing-and-publishing, Property 6: Guard return type handling
    // Validates: Requirements 3.4

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant({ type: "boolean-true", value: true }),
          fc.constant({ type: "boolean-false", value: false }),
          fc.constant({ type: "void", value: undefined }),
          fc.string().map((s) => ({ type: "string", value: s })),
          fc.constant({ type: "error", value: new Error("test error") })
        ),
        async (guardReturn) => {
          const route: RouteConfig = {
            path: "/",
            enter: () => {
              if (guardReturn.type === "error") {
                throw guardReturn.value;
              }
              return guardReturn.value as any;
            },
          };

          const result = await runEnterGuard(route, {});

          // Verify the outcome matches the expected type
          switch (guardReturn.type) {
            case "boolean-true":
            case "void":
              return result.type === "allow";
            case "boolean-false":
              return result.type === "cancel";
            case "string":
              return (
                result.type === "redirect" &&
                result.target === guardReturn.value
              );
            case "error":
              return result.type === "error";
            default:
              return false;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
