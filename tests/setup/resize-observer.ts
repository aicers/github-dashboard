if (typeof Element === "undefined") {
  class MockElement {}
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    writable: true,
    value: MockElement,
  });
}

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect(): void {
    // no-op
  }

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON() {
              return {};
            },
          },
        } as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve(): void {
    // no-op
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

if (typeof Element !== "undefined") {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (originalGetBoundingClientRect) {
      const rect = originalGetBoundingClientRect.call(this);
      if (rect?.width && rect?.height) {
        return rect;
      }
    }

    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON() {
        return {};
      },
    } satisfies DOMRect;
  };
}
