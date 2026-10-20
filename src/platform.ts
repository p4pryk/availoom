import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Provider, Reading } from "./domain";
export interface Preferences {
  orientation: "horizontal" | "vertical";
  hiddenProviders: Provider[];
  light: boolean;
  followSystem: boolean;
  setupDone: boolean;
  lowUsageAlerts: boolean;
  pinned: boolean;
  reducedMotion: boolean;
}
export const defaults: Preferences = {
  orientation: "horizontal",
  hiddenProviders: [],
  light: false,
  followSystem: false,
  setupDone: false,
  lowUsageAlerts: false,
  pinned: false,
  reducedMotion: false,
};
export const desktop = isTauri();
export interface ClaudeStatus {
  installed: boolean;
  loggedIn: boolean;
  source: "external" | "claude" | "unknown";
  host: string | null;
}
export const platform = {
  loginEnabled: async (): Promise<boolean> => (desktop ? isEnabled() : false),
  setLoginEnabled: async (enabled: boolean) => {
    if (desktop) await (enabled ? enable() : disable());
  },
  requestNotifications: async (): Promise<boolean> =>
    desktop &&
    ((await isPermissionGranted()) ||
      (await requestPermission()) === "granted"),
  notifyLowUsage: async () => {
    if (desktop && (await isPermissionGranted()))
      await invoke("plugin:notification|notify", {
        options: {
          title: "Codex usage is running low",
          body: "A usage limit has reached 10% remaining. Open the strip for details.",
        },
      });
  },
  fit: async () => {
    if (desktop) await invoke("fit_panel");
  },
  inspectClaude: async (): Promise<ClaudeStatus> => invoke("inspect_claude"),
  load: async (): Promise<Preferences> =>
    desktop
      ? { ...defaults, ...(await invoke<Preferences>("load_preferences")) }
      : defaults,
  save: async (preferences: Preferences) => {
    if (desktop) {
      await getCurrentWindow().setAlwaysOnTop(preferences.pinned);
      await invoke("save_preferences", { preferences });
    }
  },
  resize: async (width: number, height: number) => {
    if (desktop) await invoke("resize_panel", { width, height });
  },
  move: async (direction: string) => {
    if (desktop) await invoke("move_strip", { direction });
  },
  drag: async () => {
    if (desktop) await getCurrentWindow().startDragging();
  },
  hide: async () => {
    if (desktop) await getCurrentWindow().hide();
  },
  discover: async (): Promise<string[]> =>
    desktop ? invoke("discover_codex") : [],
  read: async (
    path: string,
    expectedAccount: string | null,
  ): Promise<Reading> =>
    invoke("read_codex", { path, consent: true, expectedAccount }),
  disconnect: async () => {
    if (desktop) await invoke("disconnect_codex");
  },
  open: async (provider: Provider) => {
    if (desktop) await invoke("open_provider", { provider });
  },
};
