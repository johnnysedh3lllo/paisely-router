import { describe, it, expect } from "vitest";
import type { RouteConfig, BaseRouteConfig } from "../src/types.js";
import { matchRoute } from "../src/matching.js";

const makeRoute = (
  path: string,
  extras: Partial<BaseRouteConfig> = {}
): RouteConfig =>
  ({
    path,
    ...extras,
  } as RouteConfig);

const makePatternRoute = (
  pattern: URLPattern,
  extras: Partial<BaseRouteConfig> = {}
): RouteConfig =>
  ({
    pattern,
    ...extras,
  } as RouteConfig);

describe("matchRoute", () => {
  describe("ordered route matching", () => {
    it("returns the first matching route when multiple routes could match", () => {
      const routes: RouteConfig[] = [
        makeRoute("/users/:id"),
        makeRoute("/users/new"),
        makeRoute("/users/*"),
      ];

      // Should match first route, not second, even though 'new' is a valid :id
      const matched = matchRoute(routes, undefined, "/users/new");
      expect(matched).toBe(routes[0]);
    });

    it("returns the exact match when it appears first", () => {
      const routes: RouteConfig[] = [makeRoute("/about"), makeRoute("/*")];

      const matched = matchRoute(routes, undefined, "/about");
      expect(matched).toBe(routes[0]);
    });

    it("returns the wildcard route when no exact match exists", () => {
      const routes: RouteConfig[] = [
        makeRoute("/"),
        makeRoute("/about"),
        makeRoute("/*"),
      ];

      const matched = matchRoute(routes, undefined, "/anything/else");
      expect(matched).toBe(routes[2]);
    });

    it("respects route order with parameterized routes", () => {
      const routes: RouteConfig[] = [
        makeRoute("/"),
        makeRoute("/about"),
        makeRoute("/users/:id"),
        makeRoute("/posts/:slug"),
      ];

      const matched = matchRoute(routes, undefined, "/users/123");
      expect(matched).toBe(routes[2]);
    });
  });

  describe("fallback route behavior", () => {
    const fallback: BaseRouteConfig = {
      render: () => "fallback content",
    };

    it("returns undefined when nothing matches and no fallback", () => {
      const routes: RouteConfig[] = [makeRoute("/"), makeRoute("/about")];

      const matched = matchRoute(routes, undefined, "/missing");
      expect(matched).toBeUndefined();
    });

    it("returns a synthesized fallback route when provided", () => {
      const routes: RouteConfig[] = [makeRoute("/"), makeRoute("/about")];

      const matched = matchRoute(routes, fallback, "/missing");
      expect(matched).toBeDefined();
      expect(matched?.render).toBe(fallback.render);
      expect(matched?.path).toBe("/*");
    });

    it("prefers matching route over fallback", () => {
      const routes: RouteConfig[] = [makeRoute("/"), makeRoute("/about")];

      const matched = matchRoute(routes, fallback, "/about");
      expect(matched).toBe(routes[1]);
      expect(matched?.path).toBe("/about");
    });

    it("synthesizes fallback with all fallback properties", () => {
      const fallbackWithMeta: BaseRouteConfig = {
        render: () => "not found",
        meta: { title: "404" },
        enter: () => true,
      };

      const routes: RouteConfig[] = [makeRoute("/")];
      const matched = matchRoute(routes, fallbackWithMeta, "/nowhere");

      expect(matched).toBeDefined();
      expect(matched?.render).toBe(fallbackWithMeta.render);
      expect(matched?.meta).toBe(fallbackWithMeta.meta);
      expect(matched?.enter).toBe(fallbackWithMeta.enter);
      expect(matched?.path).toBe("/*");
    });
  });

  describe("URLPattern vs path string routes", () => {
    it("matches path string routes correctly", () => {
      const routes: RouteConfig[] = [
        makeRoute("/"),
        makeRoute("/about"),
        makeRoute("/users/:id"),
      ];

      const matched = matchRoute(routes, undefined, "/about");
      expect(matched).toBe(routes[1]);
      expect(matched?.path).toBe("/about");
    });

    it("matches URLPattern routes correctly", () => {
      const pattern = new URLPattern({ pathname: "/products/:id" });
      const routes: RouteConfig[] = [makeRoute("/"), makePatternRoute(pattern)];

      const matched = matchRoute(routes, undefined, "/products/123");
      expect(matched).toBe(routes[1]);
      expect(matched?.pattern).toBe(pattern);
    });

    it("handles mixed path string and URLPattern routes", () => {
      const pattern = new URLPattern({ pathname: "/api/*" });
      const routes: RouteConfig[] = [
        makeRoute("/"),
        makeRoute("/about"),
        makePatternRoute(pattern),
        makeRoute("/users/:id"),
      ];

      const matchedPath = matchRoute(routes, undefined, "/about");
      expect(matchedPath).toBe(routes[1]);
      expect(matchedPath?.path).toBe("/about");

      const matchedPattern = matchRoute(routes, undefined, "/api/v1/users");
      expect(matchedPattern).toBe(routes[2]);
      expect(matchedPattern?.pattern).toBe(pattern);

      const matchedParam = matchRoute(routes, undefined, "/users/456");
      expect(matchedParam).toBe(routes[3]);
      expect(matchedParam?.path).toBe("/users/:id");
    });

    it("respects order when mixing path strings and URLPatterns", () => {
      const wildcardPattern = new URLPattern({ pathname: "/*" });
      const routes: RouteConfig[] = [
        makeRoute("/exact"),
        makePatternRoute(wildcardPattern),
      ];

      // Exact match should win even though wildcard pattern comes after
      const matchedExact = matchRoute(routes, undefined, "/exact");
      expect(matchedExact).toBe(routes[0]);

      // Wildcard should catch everything else
      const matchedWildcard = matchRoute(routes, undefined, "/anything");
      expect(matchedWildcard).toBe(routes[1]);
    });
  });
});

describe("property-based tests", () => {
  it("Property 4: Route matching determinism", () => {
    // Feature: router-testing-and-publishing, Property 4: Route matching determinism
    const fc = require("fast-check");

    fc.assert(
      fc.property(
        // Generate a random pathname
        fc.oneof(
          fc.constant("/"),
          fc.constant("/about"),
          fc.constant("/users/123"),
          fc.constant("/posts/my-post"),
          fc.constant("/api/v1/data"),
          fc.constant("/missing/route"),
          fc.webPath()
        ),
        // Generate whether to include a fallback
        fc.boolean(),
        (pathname: string, hasFallback: boolean) => {
          const routes: RouteConfig[] = [
            makeRoute("/"),
            makeRoute("/about"),
            makeRoute("/users/:id"),
            makeRoute("/posts/:slug"),
          ];

          const fallback: BaseRouteConfig | undefined = hasFallback
            ? { render: () => "fallback" }
            : undefined;

          const result = matchRoute(routes, fallback, pathname);

          // Property: result should be deterministic based on the rules
          // 1. If a route matches, return the first matching route
          // 2. If no route matches and fallback exists, return synthesized fallback
          // 3. If no route matches and no fallback, return undefined

          // Check if any route matches
          const hasMatch = routes.some((r) => {
            try {
              const pattern = r.path
                ? new URLPattern({ pathname: r.path })
                : (r as any).pattern;
              return pattern.test({ pathname });
            } catch {
              return false;
            }
          });

          if (hasMatch) {
            // Should return a route from the array
            expect(result).toBeDefined();
            expect(routes.includes(result!)).toBe(true);
          } else if (hasFallback) {
            // Should return synthesized fallback with path '/*'
            expect(result).toBeDefined();
            expect(result?.path).toBe("/*");
            expect(result?.render).toBe(fallback?.render);
          } else {
            // Should return undefined
            expect(result).toBeUndefined();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
