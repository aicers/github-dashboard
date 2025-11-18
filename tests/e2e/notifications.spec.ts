import { expect, test } from "./harness/test";

declare global {
  interface Window {
    __emitSyncStreamEvent?: (eventName: string, payload: unknown) => void;
  }
}

const HEADER_HARNESS_PATH = "/test-harness/dashboard/header";

test.describe("Dashboard notifications (Playwright)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const sources: MockEventSource[] = [];

      class MockEventSource {
        url: string;

        readyState: number;

        onopen: ((event: Event) => void) | null;

        onerror: ((event: Event) => void) | null;

        listeners: Map<string, Set<(event: MessageEvent<string>) => void>>;

        constructor(url: string) {
          this.url = url;
          this.readyState = 0;
          this.listeners = new Map();
          this.onopen = null;
          this.onerror = null;
          sources.push(this);

          setTimeout(() => {
            this.readyState = 1;
            if (typeof this.onopen === "function") {
              this.onopen(new Event("open"));
            }
          }, 0);
        }

        addEventListener(
          type: string,
          listener: (event: MessageEvent<string>) => void,
        ) {
          const listeners = this.listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(
          type: string,
          listener: (event: MessageEvent<string>) => void,
        ) {
          const listeners = this.listeners.get(type);
          if (!listeners) {
            return;
          }
          listeners.delete(listener);
          if (listeners.size === 0) {
            this.listeners.delete(type);
          }
        }

        close() {
          this.readyState = 2;
          const index = sources.indexOf(this);
          if (index >= 0) {
            sources.splice(index, 1);
          }
        }

        emit(type: string, payload: string) {
          const listeners = this.listeners.get(type);
          if (!listeners) {
            return;
          }
          for (const listener of listeners) {
            listener({ data: payload } as MessageEvent<string>);
          }
        }
      }

      window.__emitSyncStreamEvent = (eventName: string, payload: unknown) => {
        const serialized = JSON.stringify(payload ?? null);
        for (const source of sources) {
          source.emit(eventName, serialized);
        }
      };

      window.EventSource = MockEventSource as unknown as typeof EventSource;
    });
  });

  test("updates notification badge when attention refresh targets the user", async ({
    page,
  }) => {
    await page.goto(
      "/test-harness/auth/session?userId=e2e-notification&admin=1",
    );

    let activityCallCount = 0;
    await page.route("**/api/activity?**", async (route) => {
      activityCallCount += 1;
      const totalCount = activityCallCount === 1 ? 2 : 6;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pageInfo: { totalCount } }),
      });
    });

    await page.goto(
      `${HEADER_HARNESS_PATH}?userId=e2e-notification&login=notifier&name=Notification%20User`,
    );

    const badgeButton = page.getByRole("button", { name: "알림 (2건)" });
    await expect(badgeButton).toBeVisible();

    await page.evaluate(() => {
      window.__emitSyncStreamEvent?.("sync", {
        type: "attention-refresh",
        scope: "users",
        userIds: ["e2e-notification"],
        trigger: "manual-override",
        timestamp: new Date().toISOString(),
      });
    });

    await expect(
      page.getByRole("button", { name: "알림 (6건)" }),
    ).toBeVisible();
  });
});
