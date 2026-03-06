/**
 * fake-host.ts
 *
 * Test utility that provides a fake ReactiveControllerHost for testing Routes.
 * Implements both ReactiveControllerHost and EventTarget interfaces.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * A minimal fake host for testing Routes navigation.
 * Satisfies ReactiveControllerHost & EventTarget.
 */
export class FakeHost implements ReactiveControllerHost, EventTarget {
  private _controllers: ReactiveController[] = [];
  private _updateRequested = false;
  private _updateResolve: (() => void) | undefined;
  private _listeners = new Map<string, Set<EventListener>>();

  updateComplete: Promise<void> = Promise.resolve();

  requestUpdate(): void {
    if (this._updateRequested) return;
    this._updateRequested = true;

    // Create a new updateComplete promise
    this.updateComplete = new Promise((resolve) => {
      this._updateResolve = resolve;
    });

    // Simulate async update cycle
    queueMicrotask(() => {
      this._updateRequested = false;
      this._updateResolve?.();
      this._updateResolve = undefined;
    });
  }

  addController(controller: ReactiveController): void {
    this._controllers.push(controller);
    controller.hostConnected?.();
  }

  removeController(controller: ReactiveController): void {
    const index = this._controllers.indexOf(controller);
    if (index !== -1) {
      this._controllers.splice(index, 1);
      controller.hostDisconnected?.();
    }
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this._listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        listener.call(this, event);
      });
    }
    return !event.defaultPrevented;
  }

  /**
   * Disconnect all controllers (useful for cleanup in tests).
   */
  disconnectAll(): void {
    this._controllers.forEach((controller) => {
      controller.hostDisconnected?.();
    });
    this._controllers = [];
  }
}
