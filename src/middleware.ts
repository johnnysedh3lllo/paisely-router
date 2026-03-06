/**
 * middleware.ts
 *
 * Middleware pipeline execution.
 *
 * A middleware function receives a NavigationContext and can:
 *   - Call ctx.next() to pass control to the next middleware
 *   - Call ctx.cancel() to abort navigation
 *   - Call ctx.redirect(path) to redirect instead
 *   - Do nothing (implicitly calls next via auto-advance)
 *
 * The pipeline is recursive internally (index-based) but the recursion
 * depth equals the number of middleware registered — typically < 10.
 * This is not the same as the redirect chain recursion (which is now
 * iterative; see navigation.ts).
 *
 * All middleware functions are called in insertion order.
 * If a middleware calls next() explicitly, the next one runs.
 * If it doesn't call next() but also doesn't cancel/redirect,
 * the pipeline auto-advances (Koa-style).
 */

import type {
  NavigationMiddleware,
  NavigationContext,
  NavigationResult,
  RouteParams,
  RouteMeta,
} from "./types.js";

export interface MiddlewarePipelineInput {
  middleware: NavigationMiddleware[];
  from: string | undefined;
  to: string;
  params: RouteParams;
  meta: RouteMeta | undefined;
}

export interface MiddlewarePipelineResult {
  result: NavigationResult;
  redirectTarget: string | undefined;
}

/**
 * Run the full middleware pipeline for a navigation.
 *
 * Returns the final NavigationResult after all middleware has run.
 * If any middleware redirected, `redirectTarget` is set.
 */
export const runMiddlewarePipeline = async (
  input: MiddlewarePipelineInput
): Promise<MiddlewarePipelineResult> => {
  const { middleware, from, to, params, meta } = input;

  let result: NavigationResult = { status: "success" };
  let redirectTarget: string | undefined;

  const run = async (index: number): Promise<void> => {
    if (index >= middleware.length) return;

    let nextCalled = false;

    const ctx: NavigationContext = {
      from,
      to,
      params,
      meta,
      next: async () => {
        nextCalled = true;
        // Only proceed if navigation hasn't been cancelled or redirected
        if (result.status === "success") {
          await run(index + 1);
        }
      },
      cancel: () => {
        result = { status: "cancelled" };
      },
      redirect: (pathname: string) => {
        redirectTarget = pathname;
        result = { status: "redirected", to: pathname };
      },
    };

    await middleware[index](ctx);

    // Auto-advance: if the middleware didn't call next() and didn't
    // cancel or redirect, proceed to the next one automatically.
    if (!nextCalled && result.status === "success") {
      await run(index + 1);
    }
  };

  await run(0);

  return { result, redirectTarget };
};
