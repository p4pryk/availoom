import { LowUsageAlerts } from "./alerts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  GripVertical,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  Moon,
  Monitor,
  Pause,
  Pin,
  RotateCw,
  Settings2,
  ShieldCheck,
  Sun,
  Unplug,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProviderMark, AvailoomMark, Gauge, colors } from "./components/Visuals";
import {
  providers,
  visibleProviders,
  readingAge,
  stripPools,
  compactWindow,
  Provider,
  Reading,
  resetLabel,
  freshness,
  durationLabel,
  percentLabel,
  absoluteTime,
  toSnapshots,
  errors,
} from "./domain";
import {
  platform,
  desktop,
  Preferences,
  defaults,
  ClaudeStatus,
} from "./platform";
import "./style.css";

type Panel = Provider | "settings" | null;
function App() {
  const [panel, setPanel] = useState<Panel>(null),
    [prefs, setPrefs] = useState<Preferences>(defaults);
  const [reading, setReading] = useState<Reading | null>(null),
    [error, setError] = useState<string | null>(null);
  const alerts = useRef(new LowUsageAlerts());
  const [loginEnabled, setLoginEnabled] = useState<boolean | null>(null);
  const [systemBusy, setSystemBusy] = useState(false);
  const alertEnabled = useRef(false);
  alertEnabled.current = prefs.lowUsageAlerts;
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoEnabled = useRef(false);
  const nextReadAt = useRef(0);
  const latestRead = useRef<() => void>(() => {});
  const [online, setOnline] = useState(navigator.onLine);
  const [systemLight, setSystemLight] = useState(
    () => matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [discovering, setDiscovering] = useState(false);
  const discoveryRequest = useRef(0);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const shownProviders = visibleProviders(prefs.hiddenProviders);
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [paths, setPaths] = useState<string[]>([]),
    [path, setPath] = useState("");
  const [notice, setNotice] = useState(""),
    [now, setNow] = useState(Date.now()),
    [pool, setPool] = useState<Partial<Record<Provider, string>>>({}),
    [saving, setSaving] = useState(false);
  const root = useRef<HTMLElement | null>(null),
    detail = useRef<HTMLElement | null>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  async function checkClaude() {
    if (checkingClaude) return;
    setCheckingClaude(true);
    setClaudeStatus(null);
    try {
      setClaudeStatus(await platform.inspectClaude());
    } catch {
      setNotice("Could not check Claude Code. Try again.");
    } finally {
      setCheckingClaude(false);
    }
  }
  const request = useRef(0),
    pending = useRef(false);
  const close = useCallback(() => {
    discoveryRequest.current++;
    setPanel(null);
    setConfirm(false);
    setNotice("");
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        trigger.current = settingsTrigger.current;
        setPanel("settings");
        setConfirm(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(() => {
    let alive = true;
    platform
      .loginEnabled()
      .then((enabled) => {
        if (alive) setLoginEnabled(enabled);
      })
      .catch(() => {
        if (alive) setLoginEnabled(null);
      });
    platform
      .load()
      .then((p) => {
        if (alive) {
          setPrefs(p);
          if (desktop && !p.setupDone) setPanel("settings");
          if (desktop)
            getCurrentWindow()
              .setAlwaysOnTop(p.pinned)
              .catch(() => setNotice("Could not restore always on top."));
        }
      })
      .catch(() => setNotice("Could not load settings."));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = (
      prefs.followSystem ? systemLight : prefs.light
    )
      ? "light"
      : "dark";
    document.documentElement.dataset.motion = prefs.reducedMotion
      ? "reduce"
      : "normal";
  }, [prefs, systemLight]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const theme = () => setSystemLight(media.matches);
    const network = () => {
      setOnline(navigator.onLine);
      setNow(Date.now());
    };
    media.addEventListener("change", theme);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    let previous = Date.now();
    const tick = () => {
      const now = Date.now();
      setNow(now);
      if (now - previous > 60000 || now < previous)
        platform.fit().catch(() => {});
      if (now < previous && autoEnabled.current)
        nextReadAt.current = now + 5 * 60000;
      previous = now;
      if (
        autoEnabled.current &&
        navigator.onLine &&
        now >= nextReadAt.current &&
        !pending.current
      )
        latestRead.current();
    };
    const t = setInterval(tick, 15000);
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(t);
      media.removeEventListener("change", theme);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  useLayoutEffect(() => {
    if (!root.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          platform
            .resize(
              Math.ceil(root.current!.getBoundingClientRect().width),
              Math.max(
                56,
                Math.min(
                  780,
                  Math.ceil(root.current!.getBoundingClientRect().height),
                ),
              ),
            )
            .catch(() => setNotice("Could not resize the window.")),
        24,
      );
    });
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (panel) detail.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        if (!payload) close();
        else platform.fit().catch(() => {});
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [close]);
  function open(p: Panel, el: HTMLButtonElement) {
    discoveryRequest.current++;
    trigger.current = el;
    setPanel(panel === p ? null : p);
    setConfirm(false);
    setNotice("");
  }
  async function changePrefs(change: Partial<Preferences>) {
    if (saving) return;
    setSaving(true);
    const next = { ...prefs, ...change };
    try {
      await platform.save(next);
      setPrefs(next);
    } catch {
      setNotice("Could not save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }
  async function toggleLogin() {
    if (systemBusy || loginEnabled === null) return;
    setSystemBusy(true);
    try {
      await platform.setLoginEnabled(!loginEnabled);
      setLoginEnabled(await platform.loginEnabled());
    } catch {
      setNotice("Could not change launch at login. Try again.");
    } finally {
      setSystemBusy(false);
    }
  }
  async function toggleAlerts() {
    if (systemBusy || saving) return;
    setSystemBusy(true);
    try {
      if (!prefs.lowUsageAlerts && !(await platform.requestNotifications())) {
        setNotice(
          "Notifications are not allowed. You can enable them in system settings.",
        );
        return;
      }
      await changePrefs({ lowUsageAlerts: !prefs.lowUsageAlerts });
    } catch {
      setNotice("Could not enable notifications. Try again.");
    } finally {
      setSystemBusy(false);
    }
  }
  async function prepareRead() {
    if (busy) return;
    const generation = ++discoveryRequest.current;
    setNotice("");
    setConfirm(true);
    setDiscovering(true);
    setPaths([]);
    setPath("");
    try {
      const found = await platform.discover();
      if (generation !== discoveryRequest.current) return;
      setPaths(found);
      setPath(found[0] ?? "");
    } catch {
      if (generation === discoveryRequest.current)
        setNotice("Could not find Codex. Try again.");
    } finally {
      if (generation === discoveryRequest.current) setDiscovering(false);
    }
  }
  async function stopAuto() {
    autoEnabled.current = false;
    setAutoRefresh(false);
    if (pending.current) {
      request.current++;
      setBusy(false);
      try {
        await platform.disconnect();
      } catch {
        setNotice("Could not confirm cancellation.");
      }
    }
  }
  function enableAuto() {
    if (!reading || !path || busy || error) return;
    nextReadAt.current = Date.now() + 5 * 60000;
    autoEnabled.current = true;
    setAutoRefresh(true);
  }
  latestRead.current = () => {
    if (!confirm && !discovering) void read(true);
  };
  async function read(automatic = false) {
    if (
      !desktop ||
      !path ||
      pending.current ||
      (automatic && !autoEnabled.current)
    )
      return;
    if (!navigator.onLine) {
      setNotice("You are offline. Reconnect to refresh usage.");
      return;
    }
    pending.current = true;
    const generation = ++request.current;
    setBusy(true);
    setConfirm(false);
    setError(null);
    try {
      const result = await platform.read(path, reading?.accountRef ?? null);
      if (request.current === generation) {
        const crossed = alerts.current.observe(result);
        if (alertEnabled.current && crossed.length)
          void platform
            .notifyLowUsage()
            .catch(() =>
              setNotice("Could not deliver the low-usage notification."),
            );
        setReading(result);
        setNow(Date.now());
        nextReadAt.current = Date.now() + 5 * 60000;
      }
    } catch (e) {
      if (request.current === generation) {
        autoEnabled.current = false;
        setAutoRefresh(false);
        const code = String(e);
        if (code === "account_changed") {
          setReading(null);
          setPool({});
        }
        setError(
          errors[code] ?? "Reading failed. Previous values are unchanged.",
        );
      }
    } finally {
      pending.current = false;
      if (request.current === generation) setBusy(false);
    }
  }
  async function disconnect() {
    alerts.current.clear();
    autoEnabled.current = false;
    setAutoRefresh(false);
    request.current++;
    setReading(null);
    setPool({});
    setError(null);
    setBusy(false);
    setConfirm(false);
    try {
      await platform.disconnect();
      setNotice("Reading removed. Your Codex session is unchanged.");
    } catch {
      setNotice("Could not confirm cancellation.");
    }
  }
  async function openProvider(p: Provider) {
    try {
      await platform.open(p);
      if (!desktop) setNotice("Open the provider from the desktop app.");
    } catch {
      setNotice("Could not open the browser.");
    }
  }
  const all = reading ? toSnapshots(reading) : [];
  const selected = panel && panel !== "settings" ? panel : null;
  const quotas = all.filter((q) => q.provider === selected);
  const mainQuota =
    quotas.find((q) => q.poolId === pool[selected!]) ?? quotas[0];
  const failure = selected === "Codex" ? error : null;
  function first(p: Provider) {
    const qs = all.filter((q) => q.provider === p);
    return qs.find((q) => q.poolId === pool[p]) ?? qs[0];
  }
  const unavailable =
    selected === "Claude"
      ? "An automatic Claude connection is not available yet."
      : selected === "Gemini"
        ? "Gemini Apps limits are separate from Gemini CLI limits."
        : selected === "Grok"
          ? "An automatic Grok connection is not available yet."
          : "";
  return (
    <main
      ref={root}
      style={
        prefs.orientation === "horizontal" && !panel
          ? { width: Math.max(240, 560 - (4 - shownProviders.length) * 112) }
          : undefined
      }
      className={`layout-${prefs.orientation} ${panel ? "expanded" : ""}`}
    >
      <div
        className="strip"
        role="toolbar"
        aria-label="Availoom — AI subscription limits"
        aria-orientation={prefs.orientation}
      >
        <button
          className="brand"
          aria-label="Move strip. Arrow keys move the window; Enter centers it."
          title="Drag · arrows: move · Enter: center"
          onPointerDown={(e) => {
            if (e.button === 0)
              platform
                .drag()
                .catch(() => setNotice("Could not move the strip."));
          }}
          onKeyDown={(e) => {
            const direction: Record<string, string> = {
              ArrowLeft: "left",
              ArrowRight: "right",
              ArrowUp: "up",
              ArrowDown: "down",
              Enter: "center",
            };
            if (direction[e.key]) {
              e.preventDefault();
              platform
                .move(direction[e.key])
                .catch(() => setNotice("Could not move the strip."));
            }
          }}
        >
          <AvailoomMark />
          <GripVertical className="drag-hint" size={12} />
        </button>
        <div
          className="services"
          onKeyDown={(event) => {
            const keys =
              prefs.orientation === "horizontal"
                ? ["ArrowLeft", "ArrowRight"]
                : ["ArrowUp", "ArrowDown"];
            if (
              !keys.includes(event.key) &&
              event.key !== "Home" &&
              event.key !== "End"
            )
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (current < 0) return;
            event.preventDefault();
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (event.key === keys[0] ? -1 : 1) +
                      buttons.length) %
                    buttons.length;
            buttons[index]?.focus();
          }}
        >
          {shownProviders.map((p) => {
            const q = first(p);
            const providerPools = all.filter((q) => q.provider === p);
            const visiblePools = stripPools(providerPools, pool[p]);
            const hiddenCount = providerPools.length - visiblePools.length;
            const stale =
              q &&
              (freshness(q, now) !== "fresh" || (p === "Codex" && !!error));
            return (
              <button
                key={p}
                className={`service ${panel === p ? "active" : ""} ${stale ? "is-stale" : ""}`}
                onClick={(e) => open(p, e.currentTarget)}
                aria-expanded={panel === p}
                aria-label={`${p}: ${visiblePools.length ? visiblePools.map((q) => `${q.remaining === null ? "unknown" : percentLabel(q.remaining) + "% remaining"} in window ${durationLabel(q.windowDuration)}`).join(", ") + (stale ? ", stale" : "") + (hiddenCount ? `, ${hiddenCount} more pools` : "") : p === "Codex" ? (reading ? "No usage data" : "Connect") : "Open website"}`}
                title={
                  visiblePools.length
                    ? visiblePools
                        .map(
                          (q) =>
                            `${q.poolLabel ?? p} · ${durationLabel(q.windowDuration)}: ${q.remaining === null ? "unknown" : percentLabel(q.remaining) + "% remaining"}`,
                        )
                        .join("\n")
                    : p === "Codex"
                      ? "Connect Codex"
                      : `Open ${p} website · usage is not connected`
                }
              >
                <ProviderMark provider={p} />
                <span className="service-copy">
                  <strong>
                    <span className="service-name">{p}</span>
                    {hiddenCount > 0 && (
                      <span className="extra-pools">+{hiddenCount}</span>
                    )}
                    {stale && (
                      <Clock3
                        className="stale-mark"
                        size={9}
                        aria-label="Needs refresh"
                      />
                    )}
                  </strong>
                  {visiblePools.length ? (
                    <span className="service-value pool-summary">
                      {visiblePools.map((q) => (
                        <span
                          key={q.poolId}
                          className={`pool-chip ${q.remaining !== null && q.remaining <= 10 ? "low" : ""}`}
                        >
                          <em>{compactWindow(q.windowDuration)}</em>
                          <span>
                            {percentLabel(q.remaining)}
                            {q.remaining !== null && "%"}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="service-empty">
                      {p === "Codex"
                        ? busy
                          ? "Reading…"
                          : reading
                            ? "No data"
                            : "Connect"
                        : "Open website"}
                    </span>
                  )}
                </span>
                {q && q.remaining !== null && (
                  <span className="micro-meter">
                    <i
                      style={{
                        width: `${q.remaining ?? 0}%`,
                        background: colors[p],
                      }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="strip-end">
          <button
            className={`icon ${panel === "settings" ? "active" : ""}`}
            ref={settingsTrigger}
            title="Settings · ⌘,"
            aria-label="Settings"
            aria-expanded={panel === "settings"}
            onClick={(e) => open("settings", e.currentTarget)}
          >
            <Settings2 size={17} />
          </button>
          <span className="local-label">AVAILOOM</span>
        </div>
      </div>
      {panel && (
        <section
          ref={detail}
          tabIndex={-1}
          className="panel"
          aria-label={selected ? `Details: ${selected}` : "Settings"}
        >
          <header className="panel-header">
            <div className="heading-group">
              {selected ? (
                <ProviderMark provider={selected} />
              ) : (
                <span className="settings-mark">
                  <Settings2 size={20} />
                </span>
              )}
              <div>
                <div className="eyebrow">
                  {selected ? "ROOM TO CREATE" : "MAKE IT YOURS"}
                </div>
                <h1>{selected ?? "Settings"}</h1>
              </div>
            </div>
            <div className="header-actions">
              {selected && (
                <span
                  className={`status-pill ${quotas.length ? "available" : ""}`}
                >
                  {quotas.length
                    ? mainQuota &&
                      freshness(mainQuota, now) === "fresh" &&
                      !failure
                      ? "Last reading"
                      : "Needs refresh"
                    : selected !== "Codex"
                      ? "Website only"
                      : reading
                        ? "No usage data"
                        : "Not connected"}
                </span>
              )}
              <button
                className="icon"
                onClick={close}
                aria-label="Close details"
              >
                <X size={16} />
              </button>
            </div>
          </header>
          <div className="panel-body">
            {selected ? (
              <>
                {confirm ? (
                  <div className="connection">
                    <span className="section-caption">YOU CONTROL ACCESS</span>
                    <h2>Read your Codex usage</h2>
                    <p>
                      Use your signed-in Codex account to read remaining usage
                      and reset times. No prompts are sent. Your session may be
                      refreshed by Codex.
                    </p>
                    <div className="consent-facts">
                      <span>
                        <ShieldCheck size={14} /> Read only when you click
                      </span>
                      <span>
                        <LockKeyhole size={14} /> Kept in memory until
                        disconnect or exit
                      </span>
                      <span>
                        <Unplug size={14} /> Manual refresh until you disconnect
                        or quit
                      </span>
                    </div>
                    {discovering ? (
                      <p className="discovery-status" role="status">
                        <LoaderCircle size={14} className="spin" /> Finding your
                        Codex installation…
                      </p>
                    ) : paths.length ? (
                      <label className="path-field">
                        Installed tool
                        <select
                          value={path}
                          onChange={(e) => setPath(e.target.value)}
                        >
                          {paths.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="inline-alert">
                        Codex CLI was not found. Install it, sign in to Codex,
                        then reopen this panel.
                      </div>
                    )}
                    <div className="connection-actions">
                      <button
                        className="secondary-button"
                        onClick={() => setConfirm(false)}
                      >
                        Back
                      </button>
                      <button
                        className="primary-button"
                        disabled={!path || busy || discovering}
                        onClick={() => read()}
                      >
                        Connect for this session <ArrowRight size={15} />
                      </button>
                    </div>
                    <p className="fineprint">
                      Connect for this session. Refresh reads the same account
                      when you click. Background reads stay off unless enabled
                      separately. Disconnect or quit to end the connection.
                    </p>
                  </div>
                ) : mainQuota ? (
                  <>
                    <div
                      className={`quota-hero ${mainQuota.remaining !== null && mainQuota.remaining <= 10 ? "quota-low" : ""}`}
                    >
                      <div className="gauge-wrap">
                        <Gauge
                          value={mainQuota.remaining}
                          color={colors[selected]}
                        />
                        <div className="gauge-value">
                          <strong>
                            {percentLabel(mainQuota.remaining)}
                            {mainQuota.remaining !== null && <small>%</small>}
                          </strong>
                          <span>
                            {mainQuota.remaining === null
                              ? "No value"
                              : "remaining"}
                          </span>
                        </div>
                      </div>
                      <div className="hero-copy">
                        <span className="section-caption">AVAILABLE USAGE</span>
                        <h2>{durationLabel(mainQuota.windowDuration)}</h2>
                        <p>
                          {mainQuota.remaining === null
                            ? "The source did not provide a value"
                            : mainQuota.remaining === 0
                              ? "This allowance has been used"
                              : mainQuota.remaining <= 10
                                ? "Your allowance is running low"
                                : "Available in this usage window"}
                        </p>
                        <span className="reset-pill">
                          <Clock3 size={13} />
                          {mainQuota.resetsAt &&
                          Date.parse(mainQuota.resetsAt) > now
                            ? `Resets ${resetLabel(mainQuota.resetsAt, now).replace(/^In /, "in ")}`
                            : resetLabel(mainQuota.resetsAt, now)}
                        </span>
                      </div>
                    </div>
                    {quotas.length > 1 && (
                      <div className="quota-options" aria-label="Quota pools">
                        {quotas.map((q) => (
                          <button
                            key={q.poolId}
                            className={`quota-option ${q.poolId === mainQuota.poolId ? "chosen" : ""}`}
                            onClick={() =>
                              setPool((prev) => ({
                                ...prev,
                                [selected]: q.poolId,
                              }))
                            }
                            aria-pressed={q.poolId === mainQuota.poolId}
                          >
                            <div>
                              <span>{durationLabel(q.windowDuration)}</span>
                              <strong>
                                {percentLabel(q.remaining)}
                                {q.remaining !== null && <small>%</small>}
                              </strong>
                            </div>
                            <div className="quota-meter">
                              <i
                                style={{
                                  width: `${q.remaining ?? 0}%`,
                                  background: colors[selected],
                                }}
                              />
                            </div>
                            <small>
                              {q.poolLabel ?? "Subscription limit"}
                              {q.poolId === mainQuota.poolId
                                ? " · on strip"
                                : ""}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="reading-summary">
                      <Clock3 size={13} />
                      <span>{readingAge(mainQuota.fetchedAt, now)}</span>
                      <span className="reading-method">
                        {!online
                          ? "Offline"
                          : autoRefresh
                            ? "Auto · 5 min"
                            : "Manual refresh"}
                      </span>
                    </div>
                    <div className="auto-refresh-control">
                      <button
                        className="setting-row full"
                        aria-pressed={autoRefresh}
                        disabled={!autoRefresh && (busy || !!error)}
                        onClick={() =>
                          autoRefresh ? void stopAuto() : enableAuto()
                        }
                      >
                        <span>
                          <strong>
                            {autoRefresh
                              ? "Auto-refresh is on"
                              : "Auto-refresh this session"}
                          </strong>
                          <small>
                            {autoRefresh
                              ? "Every 5 minutes. Click to pause."
                              : "Allow background reads until you quit or disconnect."}
                          </small>
                        </span>
                        <span className={`toggle ${autoRefresh ? "on" : ""}`}>
                          <i />
                        </span>
                      </button>
                      {autoRefresh && (
                        <p className="fineprint">
                          {online
                            ? "Uses the connected account. Stops on any reading error or account change."
                            : "Waiting for a connection. No requests are sent while offline."}
                        </p>
                      )}
                    </div>
                    <details className="reading-details" key={selected}>
                      <summary>Reading details</summary>
                      <div className="provenance">
                        <div>
                          <span>SOURCE</span>
                          <strong>Codex App Server</strong>
                        </div>
                        <div>
                          <span>LAST READING</span>
                          <strong>{absoluteTime(mainQuota.fetchedAt)}</strong>
                        </div>
                      </div>
                      {reading && (
                        <p className="account-line">
                          Account: <strong>{reading.accountLabel}</strong> ·{" "}
                          {freshness(mainQuota, now) === "fresh" && !error
                            ? "Recent reading"
                            : "Stale reading"}
                        </p>
                      )}
                      {reading?.planLabel && (
                        <p className="account-line">
                          Source plan: {reading.planLabel}
                        </p>
                      )}
                      <p className="fineprint">
                        {mainQuota.resetsAt
                          ? `Source reset time: ${absoluteTime(mainQuota.resetsAt)}. `
                          : ""}
                        A new reading is needed to confirm usage after a reset.
                      </p>
                    </details>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-art">
                      <div className="orbital-line" />
                      <div className="orbital-line second" />
                      <span className="empty-symbol">
                        <ProviderMark provider={selected} />
                      </span>
                      <i />
                    </div>
                    <span className="section-caption">
                      {busy && selected === "Codex"
                        ? "READING USAGE"
                        : selected === "Codex"
                          ? "START WITH REAL DATA"
                          : "ALWAYS TRANSPARENT"}
                    </span>
                    <h2>
                      {busy && selected === "Codex"
                        ? "Checking your quota."
                        : selected === "Codex"
                          ? "Connect Codex"
                          : "Check your usage"}
                    </h2>
                    <p>
                      {busy && selected === "Codex"
                        ? "Reading quota metadata. No model task is being sent."
                        : selected === "Codex"
                          ? reading
                            ? "The source returned no quota pools for this account."
                            : "Connect your existing Codex session to see remaining usage and reset times."
                          : unavailable +
                            " Open the provider to check usage manually. This does not connect usage to Availoom."}
                    </p>
                    {busy && selected === "Codex" ? (
                      <button className="secondary-button" onClick={disconnect}>
                        <X size={14} />
                        Cancel reading
                      </button>
                    ) : selected === "Codex" ? (
                      <button
                        className="primary-button"
                        onClick={prepareRead}
                        disabled={!desktop}
                      >
                        <Link2 size={15} />
                        {reading ? "Refresh usage" : "Connect Codex"}{" "}
                        <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button
                        className="secondary-button"
                        onClick={() => openProvider(selected)}
                        disabled={!desktop}
                      >
                        Open {selected === "Grok" ? "Grok" : "usage page"}
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    {selected === "Claude" && (
                      <div className="claude-check">
                        <button
                          className="text-button"
                          disabled={!desktop || checkingClaude}
                          onClick={checkClaude}
                        >
                          {checkingClaude
                            ? "Checking local session…"
                            : "Check local session"}
                        </button>
                        {claudeStatus && (
                          <p role="status">
                            {!claudeStatus.installed
                              ? "Claude Code is not installed."
                              : claudeStatus.source === "external"
                                ? `Claude Code uses ${claudeStatus.host ?? "an external provider"}. This is not a Claude subscription connection. No Claude quotas are available from this session.`
                                : !claudeStatus.loggedIn
                                  ? "Claude Code is installed but is not signed in. Sign in to Claude Code, then check again."
                                  : "Claude Code is signed in. Automatic subscription usage reading is not available in Availoom yet; check the provider usage page."}
                          </p>
                        )}
                      </div>
                    )}
                    <span className="empty-footnote">
                      <LockKeyhole size={12} />
                      Usage stays private on this device
                    </span>
                  </div>
                )}
                {failure && !confirm && (
                  <div className="inline-alert" role="alert">
                    {failure}
                  </div>
                )}
                {!confirm && (
                  <footer className="panel-footer">
                    <span className="footer-label">
                      <span className={`status-dot ${busy ? "busy" : ""}`} />
                      {busy && selected === "Codex"
                        ? "CONNECTING TO CODEX"
                        : reading && selected === "Codex"
                          ? "READ ONLY · LOCAL"
                          : "PRIVATE · ON YOUR DEVICE"}
                    </span>
                    <div className="footer-actions">
                      {selected === "Codex" && autoRefresh && (
                        <button
                          className="icon"
                          aria-label="Pause auto-refresh"
                          title="Pause auto-refresh"
                          onClick={() => void stopAuto()}
                        >
                          <Pause size={14} />
                        </button>
                      )}
                      {selected === "Codex" && reading && (
                        <button
                          className="icon"
                          aria-label="Disconnect and clear reading"
                          onClick={disconnect}
                        >
                          <Unplug size={15} />
                        </button>
                      )}
                      {(mainQuota || (reading && selected === "Codex")) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            reading && path ? void read() : void prepareRead()
                          }
                          disabled={busy}
                        >
                          {busy ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <RotateCw size={14} />
                          )}
                          Refresh
                        </button>
                      )}
                    </div>
                  </footer>
                )}
              </>
            ) : (
              <>
                {!prefs.setupDone && (
                  <div className="welcome-card">
                    <span className="section-caption">WELCOME TO AVAILOOM</span>
                    <h2>A quiet place for your limits.</h2>
                    <p>
                      Choose the services you want below. Codex supports usage
                      readings from your signed-in Codex installation. Other
                      services open their websites.
                    </p>
                    <p>
                      Drag the Availoom mark to move the strip. Restore it from the
                      menu bar after hiding it.
                    </p>
                    <div className="connection-actions">
                      <button
                        className="secondary-button"
                        disabled={saving}
                        onClick={() => changePrefs({ setupDone: true })}
                      >
                        Finish setup
                      </button>
                      <button
                        className="primary-button"
                        disabled={saving}
                        onClick={async () => {
                          await changePrefs({ setupDone: true });
                          setPanel("Codex");
                          await prepareRead();
                        }}
                      >
                        Set up Codex <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="settings-section">
                  <span className="section-caption">LOOK & FEEL</span>
                  <div className="setting-row">
                    <div>
                      <strong>Appearance</strong>
                      <small>Make Availoom feel at home</small>
                    </div>
                    <div className="segmented" role="group" aria-label="Theme">
                      <button
                        disabled={saving}
                        aria-pressed={prefs.followSystem}
                        onClick={() => changePrefs({ followSystem: true })}
                      >
                        <Monitor size={14} />
                        System
                      </button>
                      <button
                        disabled={saving}
                        aria-pressed={!prefs.followSystem && !prefs.light}
                        onClick={() =>
                          changePrefs({ light: false, followSystem: false })
                        }
                      >
                        <Moon size={14} />
                        Dark
                      </button>
                      <button
                        disabled={saving}
                        aria-pressed={!prefs.followSystem && prefs.light}
                        onClick={() =>
                          changePrefs({ light: true, followSystem: false })
                        }
                      >
                        <Sun size={14} />
                        Light
                      </button>
                    </div>
                  </div>
                  <div className="setting-row orientation-row">
                    <div>
                      <strong>Orientation</strong>
                      <small>A strip or a vertical dock</small>
                    </div>
                    <div
                      className="segmented"
                      role="group"
                      aria-label="Orientation"
                    >
                      {(["horizontal", "vertical"] as const).map(
                        (orientation) => (
                          <button
                            key={orientation}
                            disabled={saving}
                            aria-pressed={prefs.orientation === orientation}
                            onClick={() => changePrefs({ orientation })}
                          >
                            {orientation === "horizontal"
                              ? "Horizontal"
                              : "Vertical"}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <button
                    className="setting-row full"
                    disabled={saving}
                    aria-pressed={prefs.pinned}
                    onClick={() => changePrefs({ pinned: !prefs.pinned })}
                  >
                    <span>
                      <strong>
                        <Pin size={13} /> Always on top
                      </strong>
                      <small>Keep Availoom above other windows</small>
                    </span>
                    <span className={`toggle ${prefs.pinned ? "on" : ""}`}>
                      <i />
                    </span>
                  </button>
                  <button
                    className="setting-row full"
                    disabled={saving}
                    aria-pressed={prefs.reducedMotion}
                    onClick={() =>
                      changePrefs({ reducedMotion: !prefs.reducedMotion })
                    }
                  >
                    <span>
                      <strong>Reduce motion</strong>
                      <small>Use still transitions and indicators</small>
                    </span>
                    <span
                      className={`toggle ${prefs.reducedMotion ? "on" : ""}`}
                    >
                      <i />
                    </span>
                  </button>
                </div>
                <div className="settings-section daily-settings">
                  <button
                    className="setting-row full"
                    disabled={!desktop || systemBusy || loginEnabled === null}
                    aria-pressed={loginEnabled === true}
                    onClick={toggleLogin}
                  >
                    <span>
                      <strong>Launch at login</strong>
                      <small>
                        {loginEnabled === null
                          ? "Login setting unavailable"
                          : "Start the strip when you sign in to your computer"}
                      </small>
                    </span>
                    <span className={`toggle ${loginEnabled ? "on" : ""}`}>
                      <i />
                    </span>
                  </button>
                  <button
                    className="setting-row full"
                    disabled={!desktop || systemBusy || saving}
                    aria-pressed={prefs.lowUsageAlerts}
                    onClick={toggleAlerts}
                  >
                    <span>
                      <strong>Low usage alerts</strong>
                      <small>
                        Notify once when a reading crosses 10% remaining
                      </small>
                    </span>
                    <span
                      className={`toggle ${prefs.lowUsageAlerts ? "on" : ""}`}
                    >
                      <i />
                    </span>
                  </button>
                  <p className="fineprint">
                    Alerts use new readings only. Enable auto-refresh to check
                    in the background. Neither option sends model prompts.
                  </p>
                </div>
                <div className="provider-settings">
                  <div className="setting-label">
                    <strong>Services on your strip</strong>
                    <small>
                      Keep the ones you use. At least one stays visible.
                    </small>
                  </div>
                  <div
                    className="provider-choices"
                    role="group"
                    aria-label="Visible services"
                  >
                    {providers.map((p) => {
                      const visible = shownProviders.includes(p);
                      return (
                        <button
                          key={p}
                          className="provider-choice"
                          aria-label={`Show ${p}`}
                          aria-pressed={visible}
                          disabled={
                            saving || (visible && shownProviders.length === 1)
                          }
                          onClick={() =>
                            changePrefs({
                              hiddenProviders: visible
                                ? [...prefs.hiddenProviders, p]
                                : prefs.hiddenProviders.filter(
                                    (item) => item !== p,
                                  ),
                            })
                          }
                        >
                          <ProviderMark provider={p} />
                          <span>{p}</span>
                          <span className="choice-check">
                            {visible && <Check size={12} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="privacy-card">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Your data stays with you</strong>
                    <p>
                      No telemetry. Automatic reads only when you enable them.
                      <br />
                      Every connection starts with you.
                    </p>
                  </div>
                  <Check size={14} />
                </div>
                <footer className="panel-footer">
                  <button
                    className="text-button"
                    onClick={() =>
                      platform
                        .move("center")
                        .catch(() => setNotice("Could not center the window."))
                    }
                  >
                    <Maximize2 size={13} />
                    Center strip
                  </button>
                  <button
                    className="text-button"
                    onClick={() => changePrefs({ setupDone: false })}
                  >
                    Setup guide
                  </button>
                  <span className="app-version">Availoom 0.7.1</span>
                  <button
                    className="text-button"
                    title="Restore Availoom from its menu bar icon"
                    onClick={() =>
                      platform
                        .hide()
                        .catch(() => setNotice("Could not hide the strip."))
                    }
                  >
                    <Minus size={14} />
                    Hide
                  </button>
                </footer>
              </>
            )}
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
          </div>
        </section>
      )}
      {!panel && notice && (
        <div className="floating-notice" role="status">
          {notice}
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
