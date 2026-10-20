import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("shipping UI contains no demonstration controls or invented usage", async ({
  page,
}) => {
  const outgoing: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:1420")) outgoing.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator(".service-value")).toHaveCount(0);
  expect((await page.locator(".strip").boundingBox())!.height).toBe(44);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText(/demo|fictional|preview/i)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".service-value")).toHaveCount(0);
  expect(outgoing).toEqual([]);
});

for (const light of [false, true])
  test(`accessibility and layout: ${light ? "light" : "dark"} settings, empty and quota panels`, async ({
    page,
  }) => {
    await mockDesktop(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    if (light)
      await page.getByRole("button", { name: "Light", exact: true }).click();
    for (const mode of ["settings", "empty", "quota"]) {
      if (mode === "empty")
        await page
          .getByRole("button", { name: "Codex: Connect", exact: true })
          .click();
      if (mode === "quota") {
        await page
          .getByRole("button", { name: "Connect Codex", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Connect for this session" })
          .click();
        await expect(page.locator(".gauge-value")).toContainText("72%");
      }
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `previews/v06-${light ? "light" : "dark"}-${mode}.png`,
      });
    }
  });

test("reduced motion disables animations and keyboard reaches controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".brand")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Details: Codex" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".panel")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

// Test-only desktop bridge. Never contacts a CLI, credential store or provider.
async function mockDesktop(
  page: import("@playwright/test").Page,
  delayed = false,
  quotas?: any[],
) {
  await page.addInitScript(
    ({ delayed, quotas }) => {
      const w = window as any;
      w.isTauri = true;
      w.__calls = [];
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: class {
          static permission = "default";
          static async requestPermission() {
            w.__calls.push({ cmd: "permission_prompt" });
            return w.__notificationPermission ?? "granted";
          }
        },
      });
      const fixture = {
        accountRef: "fixture-account",
        accountLabel: "test@example.invalid",
        planLabel: "fixture",
        fetchedAt: Date.now() / 1000,
        sourceKind: "codex_app_server",
        quotas: [
          {
            poolId: "codex:primary",
            poolLabel: "codex",
            used: 28,
            remaining: 72,
            windowDuration: 18000,
            resetsAt: Math.floor(Date.now() / 1000) + 18000,
          },
        ],
      };
      if (quotas) fixture.quotas = quotas;
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => 1,
        invoke: async (cmd: string, args: any) => {
          w.__calls.push({ cmd, args });
          if (cmd === "plugin:autostart|is_enabled") return !!w.__loginEnabled;
          if (cmd === "plugin:autostart|enable") {
            w.__loginEnabled = true;
            return null;
          }
          if (cmd === "plugin:autostart|disable") {
            w.__loginEnabled = false;
            return null;
          }
          if (cmd === "plugin:notification|is_permission_granted")
            return w.__notificationPermission !== "denied";
          if (cmd === "load_preferences")
            return JSON.parse(
              localStorage.getItem("test-preferences") ||
                '{"light":false,"pinned":false,"reducedMotion":false,"setupDone":true}',
            );
          if (cmd === "save_preferences") {
            localStorage.setItem(
              "test-preferences",
              JSON.stringify(args.preferences),
            );
            return null;
          }
          if (cmd === "inspect_claude")
            return {
              installed: true,
              loggedIn: false,
              source: "external",
              host: "api.z.ai",
            };
          if (cmd === "discover_codex") {
            if (w.__delayDiscovery)
              return new Promise((resolve) => {
                w.__finishDiscovery = () => resolve(["/test-fixture/codex"]);
              });
            return ["/test-fixture/codex"];
          }
          if (cmd === "read_codex" && w.__readError) throw w.__readError;
          if (cmd === "read_codex" && w.__used !== undefined)
            fixture.quotas[0].used = w.__used;
          if (cmd === "read_codex")
            return delayed || w.__delayRead
              ? new Promise((resolve) => {
                  w.__finishRead = () => resolve(fixture);
                })
              : fixture;
          if (cmd === "plugin:event|listen") return 1;
          return null;
        },
      };
    },
    { delayed, quotas },
  );
}

test("account reading requires explicit consent; disconnect removes numbers", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: false })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).__calls.filter((c: any) => c.cmd === "read_codex"),
    ),
  ).toHaveLength(0);
  await expect(page.getByText("Read your Codex usage")).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await page.getByText("Reading details", { exact: true }).click();
  await expect(page.getByText("test@example.invalid")).toBeVisible();
  await expect(page.locator(".gauge-value")).toContainText("72%");
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls.filter((c: any) => c.cmd === "read_codex")[0]
          .args.consent,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Disconnect and clear reading" })
    .click();
  await expect(page.locator(".service-value")).toHaveCount(0);
});

test("a cancelled request cannot republish its late response", async ({
  page,
}) => {
  await mockDesktop(page, true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: false })
    .click();
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await page.getByRole("button", { name: "Cancel reading" }).click();
  await page.evaluate(() => (window as any).__finishRead());
  await expect(page.locator(".service-value")).toHaveCount(0);
  await expect(page.getByText("test@example.invalid")).toHaveCount(0);
});

test("orientation resizes the native dock, saves preferences and preserves connection state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 820 });
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.locator(".service-empty")).toHaveText([
    "Connect",
    "Open website",
    "Open website",
    "Open website",
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Vertical", exact: true }).click();
  await expect(page.getByRole("toolbar")).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__calls
            .filter((c: any) => c.cmd === "resize_panel")
            .at(-1)?.args.width,
      ),
    )
    .toBe(760);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page
    .locator("main")
    .screenshot({ path: "previews/v06-vertical-settings.png" });
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__calls
            .filter((c: any) => c.cmd === "resize_panel")
            .at(-1)?.args.width,
      ),
    )
    .toBe(210);
  await page
    .locator("main")
    .screenshot({ path: "previews/v06-vertical-strip.png" });
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect Codex" }).click();
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await expect(page.locator(".gauge-value")).toContainText("72%");
  await page
    .locator("main")
    .screenshot({ path: "previews/v06-vertical-fixture.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Horizontal", exact: true }).click();
  await expect(page.locator(".service").first()).toContainText("72%");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__calls
            .filter((c: any) => c.cmd === "resize_panel")
            .at(-1)?.args.width,
      ),
    )
    .toBe(560);
  expect(
    await page.evaluate(() =>
      (window as any).__calls
        .filter((c: any) => c.cmd === "save_preferences")
        .map((c: any) => c.args.preferences.orientation),
    ),
  ).toEqual(["vertical", "horizontal"]);
});

test("provider pages never pretend to connect usage", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  for (const provider of ["Claude", "Gemini", "Grok"]) {
    await page
      .getByRole("button", { name: `${provider}: Open website`, exact: true })
      .click();
    await expect(
      page.getByText("This does not connect usage to Availoom.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Open (usage page|Grok)/ }).click();
    await expect(page.locator(".status-pill")).toHaveText("Website only");
    await expect(page.locator(".service-value")).toHaveCount(0);
  }
  expect(
    await page.evaluate(() =>
      (window as any).__calls.filter((c: any) => c.cmd === "read_codex"),
    ),
  ).toEqual([]);
});

for (const scenario of ["weekly", "five-hour", "both", "unknown", "extra"]) {
  test(`adaptive real-source pools: ${scenario}`, async ({ page }) => {
    const q = (id: string, seconds: number | null, used: number | null) => ({
      poolId: id,
      poolLabel: id,
      used,
      remaining: used === null ? null : 100 - used,
      windowDuration: seconds,
      resetsAt: null,
    });
    const quotas =
      scenario === "weekly"
        ? [q("weekly", 604800, 20)]
        : scenario === "five-hour"
          ? [q("short", 18000, 100)]
          : scenario === "unknown"
            ? [q("unknown", null, null)]
            : scenario === "extra"
              ? [
                  q("short", 18000, 0),
                  q("weekly", 604800, 0),
                  q("model", 604800, 70),
                ]
              : [q("short", 18000, 0), q("weekly", 604800, 0)];
    await mockDesktop(page, false, quotas);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Codex: Connect", exact: true })
      .click();
    await page.getByRole("button", { name: "Connect Codex" }).click();
    await page
      .getByRole("button", { name: "Connect for this session" })
      .click();
    const service = page.locator(".service").first();
    await expect(service.locator(".pool-chip")).toHaveCount(
      Math.min(2, quotas.length),
    );
    if (scenario === "weekly") {
      await expect(service).toContainText("7d80%");
      await expect(service).not.toContainText("5h");
    }
    if (scenario === "five-hour") {
      await expect(service).toContainText("5h0%");
      await expect(service).not.toContainText("7d");
    }
    if (scenario === "unknown") {
      await expect(service).toContainText("?—");
      await expect(service).not.toContainText("100%");
    }
    if (scenario === "extra") {
      await expect(service.locator(".extra-pools")).toHaveText("+1");
      await expect(page.locator(".quota-option")).toHaveCount(3);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".panel")).toHaveCount(0);
    expect((await page.locator(".strip").boundingBox())!.height).toBe(44);
    expect(
      await service
        .locator(".service-copy")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await service.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    if (scenario === "both")
      await page
        .locator("main")
        .screenshot({ path: "previews/v06-two-real-shape-fixture.png" });
  });
}
test("external Claude setup does not become a connected subscription", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Claude: Open website", exact: true })
    .click();
  await page.getByRole("button", { name: "Check local session" }).click();
  await expect(page.getByRole("status")).toContainText("api.z.ai");
  await expect(page.locator(".status-pill")).toHaveText("Website only");
  await expect(page.locator(".service-value")).toHaveCount(0);
});

test("failed refresh preserves previous values and communicates staleness", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await page.evaluate(() => ((window as any).__readError = "source_error"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("declined");
  await expect(page.locator(".gauge-value")).toContainText("72%");
  await expect(page.locator(".status-pill")).toHaveText("Needs refresh");
  await expect(page.locator(".service").first()).toHaveClass(/is-stale/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".panel")).toHaveCount(0);
  await expect(page.locator(".service").first()).toBeFocused();
});

test("service choices persist, compact the strip and keep one service available", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const provider of ["Grok", "Gemini", "Claude"])
    await page
      .getByRole("button", { name: `Show ${provider}`, exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Show Codex", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".service")).toHaveCount(1);
  expect((await page.locator("main").boundingBox())!.width).toBe(240);
  await page.reload();
  await expect(page.locator(".service")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Show Claude", exact: true }).click();
  await expect(page.locator(".service")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Show Codex", exact: true }),
  ).toBeEnabled();
});
test("single quota is concise, details are disclosed and toolbar supports arrows", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Claude: Open website", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await expect(page.locator(".quota-option")).toHaveCount(0);
  await expect(
    page.getByText("Updated just now", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("test@example.invalid")).not.toBeVisible();
  await page.getByText("Reading details", { exact: true }).click();
  await expect(page.getByText("test@example.invalid")).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("discovery loading never flashes a missing-installation error or enables an old path", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.evaluate(() => ((window as any).__delayDiscovery = true));
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Finding your Codex installation",
  );
  await expect(page.getByText(/Codex CLI was not found/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect for this session" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__finishDiscovery());
  await expect(page.locator(".panel")).toHaveCount(0);
  await page.evaluate(() => ((window as any).__delayDiscovery = false));
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect for this session" }),
  ).toBeEnabled();
});

async function connectFixture(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Codex: Connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect for this session" }).click();
  await expect(page.locator(".gauge-value")).toContainText("72%");
}
async function readCount(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (window as any).__calls.filter((c: any) => c.cmd === "read_codex").length,
  );
}
test("auto-refresh is opt-in, pauses immediately and never survives a restart", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.clock.fastForward(6 * 60000);
  expect(await readCount(page)).toBe(1);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await page.clock.fastForward(5 * 60000);
  await expect.poll(() => readCount(page)).toBe(2);
  await expect(page.locator(".reading-method")).toHaveText("Auto · 5 min");
  await page
    .getByRole("button", { name: "Pause auto-refresh", exact: true })
    .click();
  await page.clock.fastForward(10 * 60000);
  expect(await readCount(page)).toBe(2);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await page.reload();
  await page.clock.fastForward(10 * 60000);
  expect(await readCount(page)).toBe(0);
  await expect(page.locator(".service-value")).toHaveCount(0);
});
test("automatic reading stops after an error and retains the last known quota", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await page.evaluate(() => ((window as any).__readError = "source_error"));
  await page.clock.fastForward(5 * 60000);
  await expect(page.getByRole("alert")).toContainText("declined");
  await expect(page.locator(".gauge-value")).toContainText("72%");
  await expect(
    page.getByRole("button", { name: /Auto-refresh this session/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.clock.fastForward(30 * 60000);
  expect(await readCount(page)).toBe(2);
});
test("offline and wake-up do not create a burst of automatic requests", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await context.setOffline(true);
  await page.clock.fastForward(60 * 60000);
  expect(await readCount(page)).toBe(1);
  await expect(page.locator(".reading-method")).toHaveText("Offline");
  await context.setOffline(false);
  await page.clock.fastForward(15000);
  await expect.poll(() => readCount(page)).toBe(2);
  await page.clock.fastForward(15000);
  expect(await readCount(page)).toBe(2);
});
test("first launch explains capabilities without accessing an account", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "test-preferences",
      JSON.stringify({ setupDone: false }),
    ),
  );
  await page.goto("/");
  await expect(page.getByText("A quiet place for your limits.")).toBeVisible();
  expect(await readCount(page)).toBe(0);
  await expect(
    page.getByText(/Other services open their websites/),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.locator(".welcome-card")).toHaveCount(0);
  expect(await readCount(page)).toBe(0);
});
test("system appearance follows the operating system and manual selection overrides it", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("pausing an in-flight automatic read rejects its late result", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await page.evaluate(() => ((window as any).__delayRead = true));
  await page.clock.fastForward(5 * 60000);
  await expect.poll(() => readCount(page)).toBe(2);
  await page
    .getByRole("button", { name: "Pause auto-refresh", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disconnect and clear reading", exact: true })
    .click();
  await page.evaluate(() => (window as any).__finishRead());
  await expect(page.locator(".service-value")).toHaveCount(0);
  await page.clock.fastForward(30 * 60000);
  expect(await readCount(page)).toBe(2);
});
test("automatic account changes clear old identity and require a new connection", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: /Auto-refresh this session/ }).click();
  await page.evaluate(() => ((window as any).__readError = "account_changed"));
  await page.clock.fastForward(5 * 60000);
  await expect(page.locator(".service-value")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Connect again");
  await expect(page.getByText("test@example.invalid")).toHaveCount(0);
  await page.clock.fastForward(30 * 60000);
  expect(await readCount(page)).toBe(2);
});

for (const orientation of ["horizontal", "vertical"] as const) {
  for (const windows of [1, 2, 3]) {
    test(`stale status never overlaps name, logo or quotas: ${orientation}, ${windows} pools`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 760, height: 820 });
      await page.clock.install();
      const quotas = Array.from({ length: windows }, (_, i) => ({
        poolId: `pool-${i}`,
        poolLabel: `Pool ${i}`,
        used: 0,
        remaining: 100,
        windowDuration: i === 0 ? 604800 : 18000,
        resetsAt: null,
      }));
      await mockDesktop(page, false, quotas);
      await page.goto("/");
      if (orientation === "vertical") {
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Vertical", exact: true })
          .click();
        await page.keyboard.press("Escape");
      }
      await page
        .getByRole("button", { name: "Codex: Connect", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect Codex", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect for this session" })
        .click();
      await expect(page.locator(".gauge-value")).toContainText("100%");
      await page.keyboard.press("Escape");
      const service = page.locator(".service").first();
      await expect(service.locator(".stale-mark")).toHaveCount(0);
      await page.clock.fastForward(21 * 60000);
      const marker = service.locator(".stale-mark");
      await expect(marker).toBeVisible();
      const status = (await marker.boundingBox())!;
      for (const selector of [
        ".provider-mark",
        ".service-name",
        ".extra-pools",
        ".pool-summary",
      ]) {
        const element = service.locator(selector);
        if (!(await element.count())) continue;
        const box = (await element.boundingBox())!;
        const overlaps =
          status.x < box.x + box.width &&
          status.x + status.width > box.x &&
          status.y < box.y + box.height &&
          status.y + status.height > box.y;
        expect(overlaps, `${selector} overlaps status`).toBe(false);
      }
      const cell = (await service.boundingBox())!;
      expect(status.x + status.width).toBeLessThanOrEqual(cell.x + cell.width);
      if (orientation === "horizontal")
        expect((await page.locator(".strip").boundingBox())!.height).toBe(44);
      await page.locator("main").screenshot({
        path: `previews/v061-stale-${orientation}-${windows}.png`,
      });
    });
  }
}

test("connected manual refresh is one click and keeps the same account guard", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => readCount(page)).toBe(2);
  await expect(page.locator(".connection")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls
          .filter((c: any) => c.cmd === "read_codex")
          .at(-1).args.expectedAccount,
    ),
  ).toBe("fixture-account");
});
test("login and alert settings stay off until explicitly enabled", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Launch at login/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: /Low usage alerts/ }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(() =>
      (window as any).__calls.filter((c: any) =>
        [
          "plugin:autostart|enable",
          "plugin:notification|notify",
          "permission_prompt",
        ].includes(c.cmd),
      ),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: /Launch at login/ }).click();
  await expect(
    page.getByRole("button", { name: /Launch at login/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Launch at login/ }).click();
  await expect(
    page.getByRole("button", { name: /Launch at login/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(
    () => ((window as any).__notificationPermission = "denied"),
  );
  await page.getByRole("button", { name: /Low usage alerts/ }).click();
  await expect(page.getByRole("status")).toContainText(
    "Notifications are not allowed",
  );
  await expect(
    page.getByRole("button", { name: /Low usage alerts/ }),
  ).toHaveAttribute("aria-pressed", "false");
});
test("low allowance sends one generic alert per crossing without account details", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Low usage alerts/ }).click();
  await page.locator(".service").first().click();
  await page.evaluate(() => ((window as any).__used = 91));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const notifications = () =>
    page.evaluate(() =>
      (window as any).__calls.filter(
        (c: any) => c.cmd === "plugin:notification|notify",
      ),
    );
  await expect.poll(async () => (await notifications()).length).toBe(1);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => readCount(page)).toBe(3);
  expect((await notifications()).length).toBe(1);
  expect(JSON.stringify(await notifications())).not.toContain(
    "test@example.invalid",
  );
});

test("session renewal preserves the last reading and permits a guarded one-click retry", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await connectFixture(page);
  await page.evaluate(() => ((window as any).__readError = "session_updated"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "refreshed its sign-in session",
  );
  await expect(page.locator(".gauge-value")).toContainText("72%");
  await expect(page.locator(".status-pill")).toHaveText("Needs refresh");
  await page.evaluate(() => ((window as any).__readError = null));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".status-pill")).toHaveText("Last reading");
  expect(
    await page.evaluate(
      () =>
        (window as any).__calls
          .filter((c: any) => c.cmd === "read_codex")
          .at(-1).args.expectedAccount,
    ),
  ).toBe("fixture-account");
});
