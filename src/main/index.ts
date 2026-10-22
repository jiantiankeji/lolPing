import { app, clipboard, dialog, Menu, powerMonitor, screen, shell, systemPreferences } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { resolveLang, strings, type Strings } from '../shared/i18n';
import { AI_DEEP_PING, AI_QUICK_PING, DEEP_PROMPT_MAX } from '../shared/aiAsk';
import type { AiTurn } from '../shared/aiHistory';
import { activePlan, LAUNCH_PING, launchableItems, launchFailureText, namesForToast } from '../shared/launchItems';
import { SETTINGS_CH, type About, type AppStatus, type PanelAction, type PanelState } from '../shared/ipc';
import { announcedEmoteHashes } from '../shared/emotes';
import { featureOn, liveKeys, roomFeaturesOff } from '../shared/features';
import { hotkeyLabel, MOD } from '../shared/keys';
import { LOGO_TEXTURE } from '../shared/pings';
import { configCommand, type HelperStatus } from '../shared/protocol';
import type { RoomState } from '../shared/room';
import { MAX_TEXT, type VoteKind } from '../shared/roomProtocol';
import { formatRoomCode, parseRoomCode } from '../shared/roomCode';
import { sameTagRgb, tagWire } from '../shared/roomColors';
import { overlaySettings, soundLevel, type Settings } from '../shared/settings';
import { parseTextInput } from '../shared/textCommands';
import { updateErrorText, type UpdateState } from '../shared/update';
import { registerAppScheme, serveAppScheme } from './appProtocol';
import { AiPing } from './aiPing';
import { FileShares } from './fileShares';
import { FILE_SHARE_PING } from '../shared/fileShare';
import { AiHistoryStore } from './aiHistoryStore';
import { DeepSeekVision } from './deepseekVision';
import { resolveTarget, toShared } from './displayNumbers';
import { EmoteCache } from './emoteCache';
import { EmoteLibrary, resolveEmoteArt } from './emoteLibrary';
import { EmoteTransfer } from './emoteTransfer';
import { isFile } from './fileState';
import { InputBridge } from './inputBridge';
import { LanTransport } from './lanTransport';
import { runLaunchItems } from './launcher';
import { makeSystemLauncher } from './launcherHost';
import { LaunchStore } from './launchStore';
import { RELAYS } from './relays';
import { RelayTransport } from './relayTransport';
import { OverlayManager, type SharedEmote, type SharedPing } from './overlayManager';
import { assetPath, buildResourcePath, helperExePath, IS_LINUX, IS_MAC, PLATFORM, settingsDir } from './paths';
import { deriveRoomKeys } from './roomCrypto';
import { RoomHistory } from './roomHistory';
import { PanelWindows } from './panelWindows';
import { draggedTo } from './panelPlacement';
import { MAX_MEMBERS, RoomManager, type RoomToast } from './roomManager';
import { postLine, startRoomText, type RoomTextDeps } from './roomText';
import { RoomVotes, voteResultLine } from './roomVotes';
import { captureDisplay } from './screenShot';
import { registerSettingsIpc } from './settingsIpc';
import { SettingsStore } from './settingsStore';
import { ShutdownCountdown } from './shutdownCountdown';
import { onSettingsWindowGone, openSettingsWindow, settingsWindow } from './settingsWindow';
import { closeTextWindow, onTextWindowGone, openTextWindow, registerTextWindow } from './textWindow';
import { AppTray, trayUpdateFrom, type TrayMode } from './tray';
import { trayUpdateHandlers } from './trayUpdate';
import { MacBackend, RELEASES_API } from './updateMac';
import { WinBackend } from './updateWin';
import { Updater } from './updater';
import { setLinuxAutostart } from './linuxAutostart';

const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

/** Esc: the key the countdown takes over, so it can be called off from the keyboard. */
const ESC_VK = 0x1b;

// X11 uses root-window pixels. Keep Electron in the same coordinate space on every monitor.
if (IS_LINUX) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

registerAppScheme();
app.setAppUserModelId('com.lolping.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());
  app.on('activate', () => openSettingsWindow()); // macOS: opened again from Finder or Launchpad while running
  void app.whenReady().then(start);
}

/** The OS account name: the default name under this machine's pings in a room. */
function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'Player';
  }
}

/**
 * The relays to use. Development builds take a comma-separated LOLPING_RELAYS instead, so "no relay reachable" can
 * be tried without touching the firewall; packaged builds always use the pinned list.
 */
function relayUrls(): readonly string[] {
  const custom = app.isPackaged ? undefined : process.env.LOLPING_RELAYS;
  const urls = custom?.split(',').map((u) => u.trim()).filter((u) => u.startsWith('wss://')) ?? [];
  return urls.length > 0 ? urls : RELAYS;
}

/** macOS: the app, Edit and Window menus, so Cmd+Q, Cmd+W and the clipboard shortcuts work in the settings window. */
function setMacMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

function start(): void {
  const library = new EmoteLibrary(join(settingsDir(), 'emotes'));
  const cache = new EmoteCache(join(settingsDir(), 'emote-cache'), Date.now);
  void cache.present();
  serveAppScheme({
    rendererRoot: process.env.ELECTRON_RENDERER_URL ? null : join(__dirname, '../renderer'), // development pages come from Vite
    emoteDirs: () => [library.dir, cache.dir], // the library wins; the cache only fills the gaps
  });
  if (IS_MAC) {
    app.dock?.hide(); // a menu bar app: the Dock icon only shows while settings are open
    setMacMenu();
  }
  const store = new SettingsStore(settingsDir(), undefined, PLATFORM, { name: osUserName(), color: randomInt(8) });
  // The request gather workspace lives beside the settings, in its own file: it is a list, not a setting.
  const launch = new LaunchStore(settingsDir());
  launch.load();
  // The answers the card pages through: a local file, never sent anywhere.
  const aiHistory = new AiHistoryStore(settingsDir());
  aiHistory.load();
  // Generated VS Code workspace files live under the settings too, never inside the project they open.
  const launcher = makeSystemLauncher(join(settingsDir(), 'workspaces'));
  let settings = store.load();
  // An imported emote whose still is gone is dropped; normalising the shorter list repairs the wheel slots that used it.
  const kept = library.present(settings.customEmotes);
  if (kept.length !== settings.customEmotes.length) settings = store.update({ customEmotes: kept });
  // The language setting, or the system display language when it's 'auto'.
  const text = (): Strings => strings(resolveLang(settings.language, app.getLocale()), PLATFORM);
  let enabled = settings.enabledOnStart;
  let quitting = false; // read by pushStatus: once true, the tray and overlays are gone
  let capturing = false; // the settings page is listening for a key, so the helper must stay suspended
  let textOpen = false;

  const overlays = new OverlayManager(
    overlaySettings(settings),
    (ref, remote) =>
      resolveEmoteArt(ref, settings.customEmotes, remote, (hash) => {
        if (!settings.friendEmotes || !cache.has(hash)) return false; // off: friends' images show as the placeholder
        cache.touch(hash); // a shown still is the most recently used at the next cache sweep
        return true;
      }),
  );
  overlays.start();
  const bridge = new InputBridge({ command: helperExePath() });

  // Updates: only in an installed build, or in a development build pointed at a test server with LOLPING_UPDATE_TEST_URL.
  const testUrl = process.env.LOLPING_UPDATE_TEST_URL || undefined;
  // Linux packages are updated manually until a Linux release feed is published.
  const updater = !IS_LINUX && (app.isPackaged || testUrl) ? createUpdater() : null;
  function createUpdater(): Updater {
    const backend = IS_MAC
      ? new MacBackend({
        apiBase: testUrl ?? RELEASES_API,
        currentVersion: app.getVersion(),
        fetch,
        downloadsDir: app.getPath('downloads'),
        focus: () => app.focus({ steal: true }), // the dialog is shown from a menu bar app, which is not the active one
        showDialog: (message) => dialog.showMessageBox({ message, buttons: ['OK'] }).then(() => undefined),
        openPath: (path) => shell.openPath(path),
        dialogText: () => text().updateMacDialog,
        quit: () => app.quit(),
      })
      : new WinBackend({
        testUrl,
        log: (line) => console.log('[update]', line),
        toast: () => overlays.toast(text().restartingToUpdate, ''),
        isQuitting: () => quitting,
      });
    return new Updater({
      backend,
      now: Date.now,
      autoCheck: () => settings.autoUpdateCheck,
      notifiedVersion: () => settings.updateNotifiedVersion,
      setNotifiedVersion: (version) => void store.update({ updateNotifiedVersion: version }),
      errorText: (kind, reason) => {
        console.warn('[update]', kind, reason); // the whole reason goes to the log; the card shows its first line
        return updateErrorText(text(), kind, reason);
      },
    });
  }

  // Room: pings shared with other lolPing users, on the network and through public relays.
  const lan = new LanTransport();
  const relay = new RelayTransport({ urls: relayUrls() });
  const room = new RoomManager({
    transports: [lan, relay],
    now: Date.now,
    randomBytes: (n) => randomBytes(n),
    deriveKeys: deriveRoomKeys,
    appVersion: app.getVersion(),
    profile: () => ({
      name: settings.displayName, ...tagWire(settings.tagColor, settings.tagColorCustom), limit: settings.incomingPingLimit,
      nf: roomFeaturesOff(settings),
    }),
    resolveTarget: (d) => {
      const target = resolveTarget(overlays.numbered(), d);
      return target ? { displayId: target.id, width: target.bounds.width, height: target.bounds.height } : null;
    },
    // With emotes switched off we announce none, so friends don't send stills for emotes we won't use.
    announceEmotes: () => (featureOn(settings, 'emotes') ? announcedEmoteHashes(settings.emoteWheel, settings.clickEmoteId) : []),
  });
  // Custom emote stills travel both ways: this side asks for friends' hashes and answers wants for our own.
  const transfer = new EmoteTransfer({
    now: Date.now,
    enabled: () => settings.friendEmotes && featureOn(settings, 'emotes'),
    have: (hash) => isFile(join(library.dir, `${hash}.webp`), false) || cache.has(hash),
    still: (hash) => {
      try {
        return new Uint8Array(readFileSync(join(library.dir, `${hash}.webp`)));
      } catch {
        return null;
      }
    },
    announced: () => announcedEmoteHashes(settings.emoteWheel, settings.clickEmoteId),
    put: (hash, bytes) => void cache.put(hash, bytes),
    routeOf: (peer) => room.routeKind(peer),
    sendToLan: (peer, body) => room.sendToLan(peer, body),
    broadcastShared: (body) => room.broadcastShared(body),
    spareSharedToken: (keep) => room.spareSharedToken(keep),
  });
  room.on('emotes', (peer: string, hashes: string[]) => transfer.announced(peer, hashes));
  room.on('want', (w: Parameters<EmoteTransfer['onWant']>[0]) => transfer.onWant(w));
  room.on('chunk', (c: Parameters<EmoteTransfer['onChunk']>[0]) => transfer.onChunk(c));
  room.on('memberGone', (peer: string) => transfer.memberGone(peer));
  const roomState = (): RoomState => {
    const all = screen.getAllDisplays();
    return {
      ...room.state(),
      displays: overlays.numbered().map((d) => {
        const scale = all.find((x) => x.id === d.id)?.scaleFactor ?? 1; // show pixels, as the OS display settings do
        return { number: d.number, width: Math.round(d.bounds.width * scale), height: Math.round(d.bounds.height * scale), primary: d.primary };
      }),
    };
  };
  const clipboardCode = async (): Promise<string | null> => {
    // Strict: nobody typed this, so only an unmistakable code counts, never words that happen to pass the check.
    const parsed = parseRoomCode(await clipboard.readText().catch(() => ''), { strict: true });
    return parsed.ok ? formatRoomCode(parsed.code) : null;
  };
  const copyRoomCode = (): void => {
    const code = room.state().code;
    if (code) void clipboard.writeText(code).catch(() => undefined);
  };

  // macOS Accessibility. Without it the helper can't create its event tap, so it isn't started: a timer waits for
  // the permission instead. `staleAccess`: macOS lists lolPing as allowed, yet the helper still has no access.
  let accessTimer: NodeJS.Timeout | null = null;
  let staleAccess = false;
  const trusted = (): boolean => !IS_MAC || systemPreferences.isTrustedAccessibilityClient(false);
  const stopWaitingForAccess = (): void => {
    if (accessTimer) clearInterval(accessTimer);
    accessTimer = null;
  };
  const waitForAccess = (): void => {
    if (accessTimer) return;
    accessTimer = setInterval(() => {
      if (!trusted()) return;
      stopWaitingForAccess();
      staleAccess = false;
      bridge.retry();
    }, 1500);
    overlays.cancelWheel();
    pushStatus();
  };
  const startHelper = (): void => {
    staleAccess = false;
    if (trusted()) bridge.retry();
    else waitForAccess();
  };

  const helperStatus = (): HelperStatus => (accessTimer ? 'noAccess' : bridge.status);
  const status = (): AppStatus => ({ enabled, helper: helperStatus(), staleAccess });
  const trayMode = (): TrayMode => {
    const h = helperStatus();
    if (h === 'failed' || h === 'noAccess') return h;
    return enabled ? 'on' : 'off';
  };
  const tray = new AppTray(
    assetPath('textures', `${LOGO_TEXTURE}.png`),
    {
      openSettings: () => openSettingsWindow(),
      setEnabled: (on) => setEnabled(on),
      retryHelper: startHelper,
      quit: () => app.quit(),
      room: {
        joinClipboard: () => {
          void clipboardCode().then((code) => {
            if (code) void room.join(code);
            else overlays.toast(text().toastNoCode, text().toastNoCodeBody);
          });
        },
        create: () => void room.create(),
        copyCode: copyRoomCode,
        setMuted: (on) => store.update({ roomMuted: on }),
        leave: () => room.leave(),
        openSettings: () => openSettingsWindow('room'),
      },
      // The tray has no card to show a result on, so the handlers toast it. Nothing to toast on once the overlays are gone.
      update: updater
        ? trayUpdateHandlers({ updater, toast: (title, body) => { if (!quitting) overlays.toast(title, body); }, text })
        : { check: () => undefined, start: () => undefined },
    },
    text(),
    IS_MAC ? { on: buildResourcePath('trayTemplate.png'), off: buildResourcePath('trayOffTemplate.png') } : undefined,
  );
  tray.setRoomsShown(featureOn(settings, 'rooms'));
  /** Sends to the settings window if there is one that is still alive (the updater also reports while the app quits). */
  function sendToSettings(channel: string, payload: unknown): void {
    const w = settingsWindow();
    if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
  if (updater) {
    updater.on('state', (s: UpdateState) => {
      if (quitting) return; // the tray and windows are going away
      tray.setUpdate(trayUpdateFrom(s));
      sendToSettings(SETTINGS_CH.updateState, s);
    });
    updater.on('notify', (version: string) => {
      if (!quitting) overlays.toast(text().updateToastTitle, text().updateToastBody(version));
    });
    tray.setUpdate(trayUpdateFrom(updater.state));
  }
  function pushRoom(): void {
    if (quitting) return;
    const s = roomState();
    tray.setRoom({ code: s.code, count: s.members.length, muted: settings.roomMuted });
    settingsWindow()?.webContents.send(SETTINGS_CH.roomChanged, s);
  }
  const syncRoomFlags = (): void => room.setStatusFlags({ paused: !enabled, roomMuted: settings.roomMuted });
  room.on('state', pushRoom);
  // The vote widget and the roster live in their own windows that never take focus.
  const panels = new PanelWindows();
  // The room keys (Alt+T and the panel key) are the helper's only while a room is active, so they reach other apps otherwise.
  let live = liveKeys(settings, { active: false }, enabled);
  const sendConfig = (): void => {
    live = liveKeys(settings, { active: room.state().phase === 'active' }, enabled);
    // The helper stops reporting a held panel key once it is off, so the roster would stay up: hide it here.
    if (!live.panel) panels.hideRoster();
    // The countdown borrows the panel key's channel to hold Esc: the helper captures one key without a modifier, and the
    // roster is not what matters while the machine is about to go down.
    const held = countdown.running();
    bridge.send(configCommand(settings, enabled, held ? { ...live, panel: true, panelVk: ESC_VK } : live));
  };
  // The retreat ping's five seconds. lolPing counts them itself, so quitting or switching the setting off cancels them.
  const countdown = new ShutdownCountdown({
    now: Date.now,
    lang: () => resolveLang(settings.language, app.getLocale()),
    hotkey: () => hotkeyLabel(settings.toggleHotkey, PLATFORM),
    show: (state) => {
      if (state) panels.showCountdown(state);
      else panels.hideCountdown();
      sendConfig(); // Esc is the helper's only while the card is up
    },
    shutdown: () => {
      if (PLATFORM !== 'win') return;
      const failed = (err: unknown): void => {
        console.warn('[shutdown]', err);
        if (!quitting) overlays.toast(text().shutdownFailed, '');
      };
      try {
        const child = spawn('shutdown', ['/s', '/t', '0'], { detached: true, stdio: 'ignore' });
        child.on('error', failed);
        child.unref();
      } catch (err) {
        failed(err);
      }
    },
  });
  room.on('state', () => {
    const next = liveKeys(settings, { active: room.state().phase === 'active' }, enabled);
    if (next.text !== live.text || next.panel !== live.panel) sendConfig();
  });
  overlays.on('displays', pushRoom);
  room.on('remotePing', (p) => overlays.spawnRemote(p));
  // The ? ping asks DeepSeek about a screenshot of the display it was placed on; with the setting off it is a plain ping.
  const vision = new DeepSeekVision({ fetch: (url, init) => fetch(url, init) });
  // The answer card keeps its text and the point it belongs to here: expanding it never round-trips the answer.
  let answerAt: { x: number; y: number } | null = null;
  let answerText = '';
  /** Where the card sat when the current drag began, so every move is measured from that same point. */
  let answerDragFrom: { x: number; y: number } | null = null;
  /** The ping the card belongs to, in overlay coordinates: a follow-up is asked where the first question was. */
  let answerSpot: { displayId: number; x: number; y: number } | null = null;
  /** Which kept turn is on show: 0 is the newest. */
  let answerIndex = 0;
  const paintAnswer = (expanded: boolean): void => {
    if (answerAt === null) return;
    const turns = aiHistory.get();
    const turn = turns[answerIndex];
    if (!turn) return;
    panels.showAnswer(answerAt, {
      view: 'answer', lang: resolveLang(settings.language, app.getLocale()), text: turn.answer, expanded,
      index: answerIndex, count: turns.length,
    });
  };
  const closeAnswer = (): void => {
    answerAt = null;
    answerText = '';
    answerDragFrom = null;
    answerSpot = null;
    answerIndex = 0;
    panels.hideAnswer();
  };
  const aiPing = new AiPing({
    settings: () => ({ aiAsk: settings.aiAsk, deepseekKey: settings.deepseekKey }),
    lang: () => resolveLang(settings.language, app.getLocale()),
    text,
    capture: (displayId) => captureDisplay(displayId),
    vision: (input) => vision.ask(input),
    show: (p) => overlays.spawnText({ ...p, y: Math.max(48, p.y - 48), style: 'spot' }),
    answer: (p) => {
      // The overlay counts from the display's own corner; the card is a window, so it needs screen coordinates.
      const display = screen.getAllDisplays().find((d) => d.id === p.displayId) ?? screen.getPrimaryDisplay();
      answerAt = { x: display.bounds.x + p.x, y: display.bounds.y + p.y };
      answerText = p.text;
      answerSpot = { displayId: p.displayId, x: p.x, y: p.y };
      // Every answer is kept, so the card can page back through them after this one is closed.
      aiHistory.add({ question: p.question, answer: p.text, at: Date.now(), deep: p.deep });
      answerIndex = 0;
      paintAnswer(false);
    },
    closeAnswer,
    clearText: (owner) => overlays.clearText(owner),
    releasePing: () => overlays.releaseHeldPing(),
    toast: (title, body) => {
      if (!quitting) overlays.toast(title, body);
    },
    now: Date.now,
  });
  /**
   * Files: the wheel's Push slice used to send a ping. It now sends one file to one member, over the local network only
   * — a shared relay carries room messages, not a whole file.
   */
  let filePickResolve: ((peer: string | null) => void) | null = null;
  function pickMember(): Promise<string | null> {
    panels.showRoster(screen.getCursorScreenPoint(), { ...panelState('roster', null), filePicking: true });
    return new Promise((resolve) => {
      filePickResolve = resolve;
      // Nobody chose: close the roster and send nothing rather than hold the ping open for ever.
      setTimeout(() => {
        if (filePickResolve !== resolve) return;
        filePickResolve = null;
        panels.hideRoster();
        resolve(null);
      }, 60_000);
    });
  }
  const files = new FileShares({
    lang: () => resolveLang(settings.language, app.getLocale()),
    text,
    // The room knows where a member is and which port their listener took; a file goes there over TCP.
    target: (peer) => room.fileTarget(peer),
    key: () => room.messageKey(),
    show: (state) => {
      if (state) panels.showTransfer(state);
      else panels.hideTransfer();
    },
    toast: (title, body) => {
      if (!quitting) overlays.toast(title, body);
    },
    members: () => room.state().members.filter((m) => !m.self).map((m) => ({ peer: m.peer, name: m.name })),
    pickMember,
    pickFile: async () => {
      const picked = await dialog.showOpenDialog({ properties: ['openFile'] });
      const path = picked.canceled ? undefined : picked.filePaths[0];
      return path === undefined ? null : { path, name: basename(path) };
    },
    pickSave: async (name) => {
      const picked = await dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), name) });
      return picked.canceled || picked.filePath === '' ? null : picked.filePath;
    },
  });
  // A file can only arrive while we are in a room: the listener starts with the room and closes with it.
  const openFileListener = async (): Promise<void> => {
    const key = room.messageKey();
    if (key === null) return;
    try {
      const port = await files.listen(key);
      room.setFilePort(port);
    } catch (err) {
      console.warn('[files]', err);
    }
  };
  let listeningIn: string | null = null;
  room.on('state', () => {
    const phase = room.state().phase;
    if (phase === 'active' && listeningIn === null) {
      listeningIn = 'active';
      void openFileListener();
    } else if (phase !== 'active' && listeningIn !== null) {
      listeningIn = null;
      files.stop();
    }
  });
  // Request gather: the Assist Me ping opens the workspace kept in launch.json.
  let launching = false;
  let lastLaunchAt = Number.NEGATIVE_INFINITY;
  const runWorkspace = async (): Promise<void> => {
    const now = Date.now();
    // A double tap must not open the workspace twice.
    if (launching || now - lastLaunchAt < 3000) return;
    lastLaunchAt = now;
    const t = text();
    const items = launchableItems(activePlan(launch.get()));
    if (items.length === 0) {
      overlays.toast(t.launchNoneTitle, t.launchNoneBody);
      return;
    }
    launching = true;
    overlays.toast(t.launchStartingTitle(namesForToast(items)), '');
    try {
      const report = await runLaunchItems(items, launcher);
      if (quitting) return;
      if (report.failed.length === 0) {
        overlays.toast(t.launchDoneTitle(report.opened.length), '');
        return;
      }
      // One item's failure never hides the others: each is named, and the toast stays long enough to read them.
      const lines = report.failed.map((f) => t.launchFailedLine(f.item.name, launchFailureText(t, f.failure)));
      overlays.toast(t.launchPartialTitle(report.opened.length, report.failed.length), lines.join('\n'), 5000);
    } finally {
      launching = false;
    }
  };
  overlays.on('shared', (p: SharedPing) => {
    // Read even when nothing asks, so a release's modifiers never leak onto the ping after it.
    const held = overlays.takeReleaseMods();
    // The Push slice sends a file now: nothing of it goes to the room as a ping.
    if (p.id === FILE_SHARE_PING) {
      void files.start();
      return;
    }
    const shared = toShared(overlays.numbered(), p.displayId, p.x, p.y);
    if (shared) room.sendPing(p.id, shared);
    if (p.id === AI_QUICK_PING) void aiPing.ping({ displayId: p.displayId, x: p.x, y: p.y });
    // All In asks the built-in question. With Shift held it asks one of your own instead, typed in the box.
    if (p.id === AI_DEEP_PING) {
      const own = (held & MOD.shift) !== 0;
      if (own && settings.aiAsk && settings.deepseekKey !== '') openAsk({ displayId: p.displayId, x: p.x, y: p.y });
      else void aiPing.ping({ displayId: p.displayId, x: p.x, y: p.y }, true); // the built-in question, or one hint
    }    // Windows only: the retreat ping starts the shutdown countdown, and calls it off while it runs.
    if (p.id === 'danger' && PLATFORM === 'win' && settings.shutdownOnDanger) countdown.ping();
    // Request gather: open the workspace the user ticked under Settings → Request gather.
    if (p.id === LAUNCH_PING) void runWorkspace();
  });
  room.on('remoteEmote', (p) => {
    if (featureOn(settings, 'emotes')) overlays.spawnRemoteEmote(p);
  });
  overlays.on('sharedEmote', (p: SharedEmote) => {
    const shared = toShared(overlays.numbered(), p.displayId, p.x, p.y);
    // The effect rides on the message, so friends see the one its sender picked even before they have the image.
    const fx = settings.customEmotes.find((c) => c.id === p.ref)?.fx;
    if (shared) room.sendEmote(p.ref, shared, fx);
  });
  // This session's room lines: members' text and alive lines while the text feature is on, and our own.
  const history = new RoomHistory(() => refreshRoster());
  const lineDeps: Pick<RoomTextDeps, 'show' | 'history' | 'now'> = {
    show: (p) => overlays.spawnText({ ...p, style: settings.roomTextStyle }),
    history,
    now: Date.now,
  };
  let stopRoomText: (() => void) | null = null;
  const syncRoomText = (): void => {
    const on = featureOn(settings, 'roomText');
    if (on && !stopRoomText) stopRoomText = startRoomText({ room, ...lineDeps, text });
    else if (!on && stopRoomText) {
      stopRoomText();
      stopRoomText = null;
    }
  };
  syncRoomText();
  // Names are kept for the session: a result may name a member who has just left.
  const memberNames = new Map<string, string>();
  room.on('state', () => {
    const s = room.state();
    if (s.phase === 'idle') {
      history.clear();
      memberNames.clear();
      closeTextWindow(); // its text and commands only make sense in a room, and a kick leaves it open otherwise
    }
    for (const m of s.members) memberNames.set(m.peer, m.name);
  });
  const panelState = (view: PanelState['view'], vote: PanelState['vote'], voteOver = false): PanelState => ({
    view, lang: resolveLang(settings.language, app.getLocale()), max: MAX_MEMBERS, room: room.state(), history: history.lines(),
    vote, voteOver, textOn: featureOn(settings, 'roomText'), votesOn: featureOn(settings, 'roomVotes'),
    filePicking: false, volume: soundLevel(settings),
  });
  /** An open roster follows the room and its history; a hidden one ignores this. */
  function refreshRoster(): void {
    panels.update(panelState('roster', null));
  }
  room.on('state', refreshRoster);
  panels.on('action', (a: PanelAction) => {
    switch (a.t) {
      case 'ballot':
        roomVotes?.answer(a.yes);
        break;
      case 'alive':
        // The cursor, as the text box does: the page's own screen point is not in DIPs on every display setup.
        sendOwnAlive(a.peer, screen.getCursorScreenPoint());
        break;
      case 'mute':
        room.muteMember(a.peer, a.on);
        break;
      case 'kick':
        startVote('kick', a.peer);
        break;
      case 'vote':
        startVote(a.kind);
        break;
      case 'cancelShutdown':
        countdown.cancel();
        break;
      case 'takeFile':
        // The receiver answers before a byte moves: a refusal ends it there.
        if (!a.took) files.cancel();
        break;
      case 'cancelFile':
        files.cancel();
        break;
      case 'fileTo':
        // The member the roster was asked about: hand the answer back and get out of the way.
        if (filePickResolve) {
          const answer = filePickResolve;
          filePickResolve = null;
          panels.hideRoster();
          answer(a.peer);
        }
        break;
      case 'expandAnswer':
        paintAnswer(a.expanded);
        break;
      case 'answerTurn': {
        // Paging keeps the card where it is: only the text and the counter change.
        const turns = aiHistory.get();
        const next = Math.max(0, Math.min(turns.length - 1, a.index));
        if (next === answerIndex) break;
        answerIndex = next;
        paintAnswer(false);
        break;
      }
      case 'followUp': {
        const turn = aiHistory.get()[answerIndex];
        if (answerSpot === null || turn === undefined) break;
        // A follow-up continues the answer on screen, where the question was first asked.
        openAsk(answerSpot, turn);
        break;
      }
      case 'dragAnswer':
        // The card is moved by the pointer, measured from where the drag started: one card, one anchor.
        if (a.start || answerDragFrom === null) answerDragFrom = answerAt;
        if (answerDragFrom !== null) {
          answerAt = draggedTo(answerDragFrom, a.dx, a.dy);
          panels.moveAnswer(answerAt);
        }
        break;
      case 'closeAnswer':
        closeAnswer();
        break;
    }
  });
  const startVote = (kind: VoteKind, target?: string): void => {
    if (roomVotes?.start(kind, target) === 'busy') overlays.toast(text().voteBusy, '');
  };
  // Votes run while the feature is on; with it off, members' votes and ballots are ignored here.
  let roomVotes: RoomVotes | null = null;
  const syncRoomVotes = (): void => {
    const on = featureOn(settings, 'roomVotes');
    if (on && !roomVotes) {
      roomVotes = new RoomVotes({
        room,
        now: Date.now,
        randomId: () => randomBytes(4).toString('hex'),
        onView: (v, over) => (v ? panels.showVote(panelState('vote', v, over)) : panels.hideVote()),
        onResult: (o) => {
          const display = screen.getPrimaryDisplay();
          postLine(lineDeps, {
            kind: 'vote', owner: 'vote', tag: null, displayId: display.id, x: display.bounds.width / 2, y: display.bounds.height * 0.2,
            text: voteResultLine(o, (peer) => memberNames.get(peer) ?? '?', text()),
          });
        },
        onKicked: () => {
          room.leave(); // also forgets the room code, so it isn't rejoined at the next start
          overlays.toast(text().kickedYou, '');
        },
      });
    } else if (!on && roomVotes) {
      roomVotes.stop();
      roomVotes = null;
    }
  };
  syncRoomVotes();
  room.on('saveCode', (code: string | null) => store.update({ lastRoomCode: code }));
  room.on('toast', (n: RoomToast) => {
    const t = text();
    const code = room.state().code ?? '';
    if (n.kind === 'joinedRoom') overlays.toast(t.toastRoomJoined(n.code), t.toastRoomJoinedBody);
    else if (n.kind === 'full') overlays.toast(t.toastRoomFull, t.toastRoomFullBody);
    else if (n.kind === 'joined') overlays.toast(t.toastMemberJoined(n.name), code);
    else if (n.kind === 'left') overlays.toast(t.toastMemberLeft(n.name), code);
    else if (n.kind === 'kicked') overlays.toast(t.toastMemberKicked(n.name), code);
    else overlays.toast(t.toastMemberLost(n.name), code);
  });
  powerMonitor.on('resume', () => {
    lan.rebind();
    relay.wake();
  });

  function pushStatus(): void {
    if (quitting) return;
    tray.set(trayMode(), enabled);
    settingsWindow()?.webContents.send(SETTINGS_CH.statusChanged, status());
  }
  const about = (): About => ({
    version: app.getVersion(),
    problems: [
      ...store.problems,
      ...launch.problems,
      ...(store.emoteKeyClashed ? [text().problemEmoteKeyClash] : []),
      ...[...overlays.missingAssets].map((a) => text().missingAsset(a)),
    ],
    limitations: text().limitations,
  });

  function setEnabled(on: boolean): void {
    // The pause shortcut is one of the ways out of the shutdown countdown.
    countdown.cancel();
    if (on === enabled) return;
    enabled = on;
    sendConfig(); // also refreshes the config re-sent after restarts
    if (!on) overlays.dropKeptPings();
    const t = text();
    overlays.toast(on ? t.toastOn : t.toastOff, t.toastToggleHint(hotkeyLabel(store.get().toggleHotkey, PLATFORM)));
    syncRoomFlags();
    pushStatus();
  }

  const syncSuspended = (): void => bridge.send({ type: 'suspend', on: capturing || textOpen });
  /** A screen point (DIPs) as our own lines and the room see it: its display, the point inside it, and the shared form. */
  const ownSpot = (at: { x: number; y: number }) => {
    const display = screen.getDisplayNearestPoint(at);
    const x = at.x - display.bounds.x;
    const y = at.y - display.bounds.y;
    return { displayId: display.id, x, y, shared: toShared(overlays.numbered(), display.id, x, y) };
  };
  const ownTag = () => ({ name: settings.displayName, ...tagWire(settings.tagColor, settings.tagColorCustom) });
  /** Shows our own text where the box was opened, and sends it to the room. */
  const sendOwnText = (message: string, at: { x: number; y: number }): void => {
    const { shared, ...spot } = ownSpot(at);
    postLine(lineDeps, { kind: 'text', owner: 'self', tag: ownTag(), ...spot, text: message });
    if (shared) room.sendText(message, shared);
  };
  /** "<name> - Alive" for the member whose name tag was clicked in the panel, shown here and sent to the room. */
  const sendOwnAlive = (peer: string, at: { x: number; y: number }): void => {
    const who = room.state().members.find((m) => m.peer === peer);
    if (!who || !featureOn(settings, 'roomText')) return;
    const { shared, ...spot } = ownSpot(at);
    postLine(lineDeps, { kind: 'alive', owner: 'self', tag: ownTag(), ...spot, text: text().aliveLine(who.name) });
    if (shared) room.sendAlive(peer, shared);
  };
  /**
   * The question box that is open: where its ping landed, and the answer it follows up (null for a fresh question).
   * Nothing is captured or sent until Enter, and the screenshot is taken at that moment.
   */
  let asking: { at: { displayId: number; x: number; y: number }; followUp: AiTurn | null } | null = null;
  registerTextWindow((raw, at, mode) => {
    if (mode === 'ask') {
      // The question was typed: take the screenshot now, and let the ask answer where the ping went. A follow-up keeps
      // the mode of the answer it continues and carries that answer with it.
      const open = asking;
      asking = null;
      if (open) void aiPing.ping(open.at, open.followUp?.deep ?? true, raw, open.followUp ?? undefined);
      return 'sent';
    }
    const input = parseTextInput(raw);
    switch (input.kind) {
      case 'text':
        sendOwnText(input.text, at);
        return 'sent';
      case 'unknown':
        return 'unknown';
      case 'ff':
      case 'ready':
        if (!roomVotes) return 'votesOff';
        // Typing the command of the vote that is open means yes.
        if (roomVotes.current()?.kind === input.kind) roomVotes.answer(true);
        else if (roomVotes.start(input.kind) === 'busy') overlays.toast(text().voteBusy, '');
        return 'sent';
      case 'noff':
        if (!roomVotes) return 'votesOff';
        if (roomVotes.current()?.kind === 'ff') roomVotes.answer(false);
        return 'sent';
      default:
        return 'sent'; // nothing usable was typed: just close
    }
  });
  onTextWindowGone(() => {
    textOpen = false;
    syncSuspended();
    // A question that was never sent: the ping must not stay held on screen for an answer that is not coming.
    if (asking) {
      asking = null;
      overlays.releaseHeldPing();
    }
  });
  const openText = (): void => {
    if (!live.text || textOpen || capturing) return;
    textOpen = true;
    syncSuspended();
    const t = text();
    try {
      openTextWindow(screen.getCursorScreenPoint(), {
        mode: 'room', max: MAX_TEXT,
        placeholder: t.textBoxPlaceholder, hint: t.textBoxHint, unknown: t.textBoxUnknown, votesOff: t.textBoxVotesOff,
      });
    } catch (err) {
      // No window will ever close to release the suspend, so release it here.
      console.warn('[text]', err);
      textOpen = false;
      syncSuspended();
    }
  };
  /**
   * Open the question box: for an All In ping that landed, or for a follow-up on the answer on show. Nothing is captured
   * or sent until Enter.
   */
  const openAsk = (at: { displayId: number; x: number; y: number }, followUp: AiTurn | null = null): void => {
    if (textOpen || capturing) return;
    textOpen = true;
    asking = { at, followUp };
    syncSuspended(); // the ping keys must not open a wheel while the question is being typed
    const t = text();
    try {
      openTextWindow(screen.getCursorScreenPoint(), {
        mode: 'ask', max: DEEP_PROMPT_MAX,
        placeholder: followUp ? t.aiFollowUpPlaceholder : t.aiAskPromptPlaceholder,
        hint: followUp ? t.aiFollowUpHint : t.aiAskPromptHint,
        unknown: '', votesOff: '',
      });
    } catch (err) {
      console.warn('[ai]', err);
      textOpen = false;
      asking = null;
      syncSuspended();
      overlays.releaseHeldPing(); // the ping is held until an answer arrives, and none will
    }
  };
  bridge.on('event', (ev) => {
    if (ev.type === 'toggled') setEnabled(ev.enabled);
    else if (ev.type === 'textRequested') openText();
    else if (ev.type === 'panel') {
      // While the countdown holds the key (Esc), a press calls the shutdown off instead of opening the roster.
      if (countdown.running() && ev.show) countdown.cancel();
      else if (!ev.show) panels.hideRoster();
      else if (live.panel) panels.showRoster(screen.getCursorScreenPoint(), panelState('roster', null));
    } else if (ev.type === 'ready') {
      // A restarted helper starts unsuspended: re-apply an active key capture.
      if (capturing || textOpen) syncSuspended();
      panels.hideRoster(); // a restarted helper lost the panel key's up, so a shown roster would stay up
    } else if (ev.type === 'error') console.warn('[helper]', ev.code ?? '', ev.message);
    else overlays.handle(ev);
  });
  bridge.on('status', (s: HelperStatus) => {
    // A helper that is starting or has stopped can no longer send the cancel that dismisses a wheel left on screen.
    if (s !== 'running') overlays.cancelWheel();
    if (s === 'noAccess' && IS_MAC) {
      // Allowed but still refused is an entry left over from an earlier build. Otherwise wait for the user to allow it.
      if (trusted()) staleAccess = true;
      else waitForAccess();
      openSettingsWindow();
    }
    pushStatus();
    if (s === 'failed') overlays.toast(text().toastHelperStopped, text().toastHelperStoppedBody);
  });
  bridge.on('log', (line: string) => console.log('[helper]', line));

  store.on('change', (s: Settings) => {
    const previous = settings;
    settings = s;
    sendConfig();
    syncRoomText();
    syncRoomVotes();
    overlays.updateSettings(overlaySettings(s));
    settingsWindow()?.webContents.send(SETTINGS_CH.changed, s);
    if (s.language !== previous.language) tray.setText(text());
    if (
      s.displayName !== previous.displayName || s.tagColor !== previous.tagColor
      || !sameTagRgb(s.tagColorCustom, previous.tagColorCustom)
      || featureOn(s, 'roomText') !== featureOn(previous, 'roomText')
      || featureOn(s, 'roomVotes') !== featureOn(previous, 'roomVotes')
    ) room.profileChanged();
    if (featureOn(s, 'rooms') !== featureOn(previous, 'rooms')) {
      if (!featureOn(s, 'rooms')) room.leave();
      tray.setRoomsShown(featureOn(s, 'rooms'));
    }
    if (s.autoUpdateCheck !== previous.autoUpdateCheck) updater?.setAutoCheck(s.autoUpdateCheck);
    if (s.roomMuted !== previous.roomMuted) {
      syncRoomFlags();
      pushRoom();
    }
    if (s.allowInternet !== previous.allowInternet) {
      room.setInternetAllowed(s.allowInternet);
      pushRoom();
    }
    // Switching the setting off must also stop a countdown that is already running.
    if (!s.shutdownOnDanger) countdown.cancel();
    if (app.isPackaged && s.launchAtStartup !== previous.launchAtStartup) {
      // macOS ignores args, and a Mac launch starts in the menu bar anyway.
      if (IS_LINUX) {
        try { setLinuxAutostart(s.launchAtStartup); }
        catch (err) {
          console.error('[autostart]', err);
          void dialog.showMessageBox({ type: 'error', message: String(err) });
        }
      }
      else app.setLoginItemSettings(IS_MAC ? { openAtLogin: s.launchAtStartup } : { openAtLogin: s.launchAtStartup, args: ['--hidden'] });
    }
  });

  registerSettingsIpc({
    store,
    launch,
    library,
    getStatus: status,
    setEnabled,
    preview: (id) => overlays.previewPing(id),
    previewEmote: (ref) => overlays.previewEmote(ref),
    about,
    retryHelper: startHelper,
    setCapturing: (on) => {
      capturing = on;
      syncSuspended();
    },
    openAccessibility: () => {
      if (!IS_MAC) return;
      systemPreferences.isTrustedAccessibilityClient(true); // adds lolPing to the list and shows the system prompt
      void shell.openExternal(ACCESSIBILITY_PANE);
      if (!trusted()) waitForAccess();
    },
    text,
    platform: PLATFORM,
    update: updater
      ? { state: () => updater.state, notesUrl: () => updater.notesUrl, check: () => updater.check(true), start: () => updater.startUpdate() }
      : undefined,
    room: {
      state: roomState,
      create: () => room.create(),
      join: (t) => room.join(t),
      leave: () => room.leave(),
      mute: (peer, on) => room.muteMember(peer, on),
      clipboardCode,
      copyCode: copyRoomCode,
      retryInternet: () => relay.retryNow(),
    },
  });
  // The page can't report that it went away mid-capture (window closed, renderer crashed): release the suspend here.
  onSettingsWindowGone(() => {
    if (!capturing) return;
    capturing = false;
    syncSuspended();
  });

  sendConfig();
  if (trusted()) bridge.start();
  else waitForAccess();
  pushStatus();
  syncRoomFlags();
  room.setInternetAllowed(settings.allowInternet);
  pushRoom();
  if (settings.rejoinRoom && settings.lastRoomCode && featureOn(settings, 'rooms')) void room.join(settings.lastRoomCode);
  if (IS_MAC) {
    // A menu bar app: open settings only when there is something to do, otherwise point at the menu bar icon.
    if (store.firstRun || !trusted()) openSettingsWindow();
    else overlays.toast(text().toastMenuBar, text().toastMenuBarBody);
  } else if (!process.argv.includes('--hidden')) {
    openSettingsWindow();
  }

  updater?.start();

  app.on('window-all-closed', () => {
    /* stay running: the overlays are the app */
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    updater?.stop(); // aborts a download and drops a check in flight; an install that is quitting the app is left alone
    countdown.dispose(); // quitting lolPing calls the countdown off: nothing of ours shuts the machine down afterwards
    files.dispose(); // a transfer that is half done is dropped, and its .part file with it
    room.quit(); // says bye, so the others see "left" instead of waiting for a timeout
    transfer.stop();
    stopWaitingForAccess();
    tray.destroy();
    panels.destroy();
    overlays.destroy();
    void Promise.allSettled([
    bridge.stop(), store.flush(), launch.flush(), aiHistory.flush(), lan.whenClosed(), relay.whenClosed(),
  ]).then(() => app.exit(0));
  });
}
