import { describe, it, expect, test } from "vitest";
import * as fc from "fast-check";
import {
  sanitizePathname,
  resolveRelativePath,
  getTailGroup,
  getPattern,
} from "../src/patterns.js";
import type { PathRouteConfig, URLPatternRouteConfig } from "../src/types.js";

describe("sanitizePathname", () => {
  it("allows normal absolute paths", () => {
    expect(sanitizePathname("/users/123")).toBe("/users/123");
  });

  it("normalises dot segments", () => {
    expect(sanitizePathname("/users/../admin")).toBe("/admin");
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizePathname("//evil.com")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizePathname("https://evil.com")).toBe("/");
    expect(sanitizePathname("http://evil.com")).toBe("/");
    expect(sanitizePathname("ftp://evil.com")).toBe("/");
  });

  it("rejects javascript: URLs", () => {
    expect(sanitizePathname("javascript:alert(1)")).toBe("/");
  });

  it("handles empty and whitespace-only strings", () => {
    expect(sanitizePathname("")).toBe("/");
    expect(sanitizePathname("   ")).toBe("/");
    expect(sanitizePathname("\t\n")).toBe("/");
  });

  it("preserves query strings and hash fragments", () => {
    expect(sanitizePathname("/users?id=123")).toBe("/users?id=123");
    expect(sanitizePathname("/users#section")).toBe("/users#section");
    expect(sanitizePathname("/users?id=123#section")).toBe(
      "/users?id=123#section"
    );
  });

  it("handles paths with special characters", () => {
    expect(sanitizePathname("/users/john%20doe")).toBe("/users/john%20doe");
    expect(sanitizePathname("/search?q=hello+world")).toBe(
      "/search?q=hello+world"
    );
  });

  it("rejects paths not starting with /", () => {
    expect(sanitizePathname("users/123")).toBe("/");
    expect(sanitizePathname("relative/path")).toBe("/");
  });
});

describe("resolveRelativePath", () => {
  it("returns absolute paths as-is", () => {
    expect(resolveRelativePath("/base/path", "/other")).toBe("/other");
  });

  it("resolves simple relative child path", () => {
    expect(resolveRelativePath("/users/123", "./settings")).toBe(
      "/users/settings"
    );
  });

  it("resolves ../ to parent", () => {
    expect(resolveRelativePath("/users/123/profile", "../settings")).toBe(
      "/users/settings"
    );
  });

  it("clamps .. at root", () => {
    expect(resolveRelativePath("/", "../escape")).toBe("/escape");
  });

  it("resolves multiple ../ segments", () => {
    expect(resolveRelativePath("/a/b/c/d", "../../x")).toBe("/a/x");
    expect(resolveRelativePath("/a/b/c", "../../../x")).toBe("/x");
  });

  it("handles . segments correctly", () => {
    expect(resolveRelativePath("/users", "./profile")).toBe("/profile");
    expect(resolveRelativePath("/users", "./profile/./settings")).toBe(
      "/profile/settings"
    );
  });

  it("handles empty segments", () => {
    expect(resolveRelativePath("/users", "profile")).toBe("/profile");
    expect(resolveRelativePath("/users/123", "settings")).toBe(
      "/users/settings"
    );
  });

  it("handles complex relative paths", () => {
    expect(resolveRelativePath("/a/b/c", "../d/./e/../f")).toBe("/a/d/f");
  });

  it("clamps excessive .. at root", () => {
    expect(resolveRelativePath("/a", "../../../../b")).toBe("/b");
  });

  it("treats base as directory", () => {
    expect(resolveRelativePath("/users/123", "settings")).toBe(
      "/users/settings"
    );
    expect(resolveRelativePath("/users/123/", "settings")).toBe(
      "/users/settings"
    );
  });
});

describe("getTailGroup", () => {
  it("returns undefined when there is no numeric group", () => {
    expect(getTailGroup({})).toBeUndefined();
    expect(getTailGroup({ id: "1" })).toBeUndefined();
  });

  it("returns the value of the highest numeric key", () => {
    expect(getTailGroup({ "0": "/tail", id: "1" })).toBe("/tail");
    expect(getTailGroup({ "0": "/a", "1": "/b" })).toBe("/b");
  });

  it("handles single numeric group", () => {
    expect(getTailGroup({ "0": "/rest/of/path" })).toBe("/rest/of/path");
  });

  it("handles multiple numeric groups and returns highest", () => {
    expect(getTailGroup({ "0": "/first", "1": "/second", "2": "/third" })).toBe(
      "/third"
    );
  });

  it("ignores non-numeric keys", () => {
    expect(getTailGroup({ id: "123", name: "test", "0": "/tail" })).toBe(
      "/tail"
    );
  });

  it("handles numeric-like but non-numeric keys", () => {
    expect(getTailGroup({ "0x": "/not-numeric", "0": "/tail" })).toBe("/tail");
  });
});

describe("getPattern", () => {
  it("returns the pattern directly for URLPatternRouteConfig", () => {
    const pattern = new URLPattern({ pathname: "/users/:id" });
    const route: URLPatternRouteConfig = { pattern };

    expect(getPattern(route)).toBe(pattern);
  });

  it("creates and caches URLPattern for PathRouteConfig", () => {
    const route: PathRouteConfig = { path: "/users/:id" };

    const pattern1 = getPattern(route);
    const pattern2 = getPattern(route);

    // Should return the same cached instance
    expect(pattern1).toBe(pattern2);
    expect(pattern1).toBeInstanceOf(URLPattern);
  });

  it("creates different patterns for different route configs", () => {
    const route1: PathRouteConfig = { path: "/users/:id" };
    const route2: PathRouteConfig = { path: "/posts/:id" };

    const pattern1 = getPattern(route1);
    const pattern2 = getPattern(route2);

    // Should be different instances
    expect(pattern1).not.toBe(pattern2);
  });

  it("creates URLPattern with correct pathname", () => {
    const route: PathRouteConfig = { path: "/users/:id" };
    const pattern = getPattern(route);

    const match = pattern.exec({ pathname: "/users/123" });
    expect(match).toBeTruthy();
    expect(match?.pathname.groups.id).toBe("123");
  });

  it("caches patterns across multiple calls", () => {
    const route: PathRouteConfig = { path: "/products/:category/:id" };

    // Call multiple times
    const pattern1 = getPattern(route);
    const pattern2 = getPattern(route);
    const pattern3 = getPattern(route);

    // All should be the same cached instance
    expect(pattern1).toBe(pattern2);
    expect(pattern2).toBe(pattern3);
  });
});

// Property-Based Tests

test("Property 3: Pathname sanitization safety", () => {
  // Feature: router-testing-and-publishing, Property 3: Pathname sanitization safety
  // **Validates: Requirements 3.1**
  fc.assert(
    fc.property(
      fc.oneof(
        // Protocol-relative URLs
        fc.constant("//evil.com"),
        fc.constant("//evil.com/path"),
        fc.string().map((s) => "//" + s),
        // Absolute URLs
        fc.constant("https://evil.com"),
        fc.constant("http://evil.com"),
        fc.constant("ftp://evil.com"),
        fc
          .oneof(
            fc.constant("https://"),
            fc.constant("http://"),
            fc.constant("ftp://")
          )
          .chain((protocol) => fc.string().map((s) => protocol + s)),
        // Protocol injection
        fc.constant("javascript:alert(1)"),
        fc.constant("javascript:"),
        fc.string().map((s) => "javascript:" + s),
        fc.string().map((s) => "data:" + s),
        // Valid pathnames (should pass through safely)
        fc.string().map((s) => "/" + s),
        // Empty and whitespace
        fc.constant(""),
        fc.constant("   "),
        fc.constant("\t\n"),
        // Paths not starting with /
        fc.string().filter((s) => s.length > 0 && !s.startsWith("/"))
      ),
      (input) => {
        const result = sanitizePathname(input);
        // Result must start with exactly one forward slash, or be '/'
        return (
          result === "/" || (result.startsWith("/") && !result.startsWith("//"))
        );
      }
    ),
    { numRuns: 100 }
  );
});
