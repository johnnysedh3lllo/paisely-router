/**
 * fake-host.test.ts
 *
 * Tests for the FakeHost test utility.
 */

import { test, expect } from "vitest";
import { FakeHost } from "./fake-host.js";
import { Routes } from "../src/routes.js";

test("FakeHost implements ReactiveControllerHost", () => {
  const host = new FakeHost();

  expect(host.requestUpdate).toBeDefined();
  expect(host.addController).toBeDefined();
  expect(host.removeController).toBeDefined();
  expect(host.updateComplete).toBeDefined();
});

test("FakeHost implements EventTarget", () => {
  const host = new FakeHost();

  expect(host.addEventListener).toBeDefined();
  expect(host.removeEventListener).toBeDefined();
  expect(host.dispatchEvent).toBeDefined();
});

test("FakeHost can be used to create a Routes instance", () => {
  const host = new FakeHost();
  const routes = new Routes(host, []);

  expect(routes).toBeDefined();
  expect(routes.routes).toEqual([]);
});

test("FakeHost requestUpdate creates updateComplete promise", async () => {
  const host = new FakeHost();

  const promise1 = host.updateComplete;
  host.requestUpdate();
  const promise2 = host.updateComplete;

  // Should create a new promise
  expect(promise1).not.toBe(promise2);

  // Should resolve
  await expect(promise2).resolves.toBeUndefined();
});

test("FakeHost addEventListener and dispatchEvent work", () => {
  const host = new FakeHost();
  let eventFired = false;

  host.addEventListener("test-event", () => {
    eventFired = true;
  });

  const event = new Event("test-event");
  host.dispatchEvent(event);

  expect(eventFired).toBe(true);
});

test("FakeHost removeEventListener works", () => {
  const host = new FakeHost();
  let callCount = 0;

  const listener = () => {
    callCount++;
  };

  host.addEventListener("test-event", listener);
  host.dispatchEvent(new Event("test-event"));
  expect(callCount).toBe(1);

  host.removeEventListener("test-event", listener);
  host.dispatchEvent(new Event("test-event"));
  expect(callCount).toBe(1); // Should not increment
});

test("FakeHost addController calls hostConnected", () => {
  const host = new FakeHost();
  let connected = false;

  const controller = {
    hostConnected: () => {
      connected = true;
    },
  };

  host.addController(controller);
  expect(connected).toBe(true);
});

test("FakeHost removeController calls hostDisconnected", () => {
  const host = new FakeHost();
  let disconnected = false;

  const controller = {
    hostConnected: () => {},
    hostDisconnected: () => {
      disconnected = true;
    },
  };

  host.addController(controller);
  host.removeController(controller);
  expect(disconnected).toBe(true);
});

test("FakeHost disconnectAll cleans up all controllers", () => {
  const host = new FakeHost();
  let disconnectCount = 0;

  const controller1 = {
    hostConnected: () => {},
    hostDisconnected: () => {
      disconnectCount++;
    },
  };

  const controller2 = {
    hostConnected: () => {},
    hostDisconnected: () => {
      disconnectCount++;
    },
  };

  host.addController(controller1);
  host.addController(controller2);
  host.disconnectAll();

  expect(disconnectCount).toBe(2);
});
