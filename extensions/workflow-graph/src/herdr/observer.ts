export type HerdrPane = { readonly paneId: string };

export interface HerdrObserverRunner {
  splitPane(input: {
    readonly paneId: string;
    readonly direction: "right";
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  }): Promise<HerdrPane>;
  runPane(input: {
    readonly paneId: string;
    readonly argv: readonly string[];
  }): Promise<void>;
  closePane(paneId: string): Promise<void>;
  paneExists(paneId: string): Promise<boolean>;
}

export type HerdrDagViewState = {
  readonly selectedRunId?: string;
  readonly filter: string;
};

export type HerdrObserverRecord = {
  readonly paneId?: string;
  readonly manuallyClosed: boolean;
  readonly viewState: HerdrDagViewState;
};

export interface HerdrObserverStore {
  load(): Promise<HerdrObserverRecord | undefined>;
  save(record: HerdrObserverRecord): Promise<void>;
}

export type HerdrObserverStatus =
  | "idle"
  | "open"
  | "manually-closed"
  | "unavailable";

export interface HerdrDagObserver {
  ensure(): Promise<{ readonly paneId: string } | undefined>;
  reopen(): Promise<{ readonly paneId: string } | undefined>;
  close(): Promise<void>;
  markManuallyClosed(): void;
  setViewState(state: HerdrDagViewState): void;
  viewState(): HerdrDagViewState;
  status(): HerdrObserverStatus;
}

export function createHerdrDagObserver(input: {
  readonly runner: HerdrObserverRunner;
  readonly parentPaneId: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly command: readonly string[];
  readonly store?: HerdrObserverStore;
}): HerdrDagObserver {
  let paneId: string | undefined;
  let status: HerdrObserverStatus = "idle";
  let state: HerdrDagViewState = { filter: "" };
  let initialized: Promise<void> | undefined;
  let opening: Promise<{ readonly paneId: string } | undefined> | undefined;

  function record(): HerdrObserverRecord {
    return {
      ...(paneId === undefined ? {} : { paneId }),
      manuallyClosed: status === "manually-closed",
      viewState: { ...state },
    };
  }

  function persist(): void {
    void input.store?.save(record()).catch(() => undefined);
  }

  async function initialize(): Promise<void> {
    if (initialized === undefined) {
      initialized = (async () => {
        try {
          const restored = await input.store?.load();
          if (restored === undefined) return;
          paneId = restored.paneId;
          state = { ...restored.viewState };
          status = restored.manuallyClosed ? "manually-closed" : "idle";
        } catch {}
      })();
    }
    await initialized;
  }

  async function open(): Promise<{ readonly paneId: string } | undefined> {
    if (opening !== undefined) return opening;
    opening = (async () => {
      let openedPaneId: string | undefined;
      try {
        const pane = await input.runner.splitPane({
          paneId: input.parentPaneId,
          direction: "right",
          cwd: input.cwd,
          env: input.env,
        });
        openedPaneId = pane.paneId;
        await input.runner.runPane({
          paneId: openedPaneId,
          argv: input.command,
        });
        paneId = openedPaneId;
        status = "open";
        persist();
        return { paneId };
      } catch {
        if (openedPaneId !== undefined) {
          try {
            await input.runner.closePane(openedPaneId);
          } catch {}
        }
        status = "unavailable";
        return undefined;
      } finally {
        opening = undefined;
      }
    })();
    return opening;
  }

  async function current(): Promise<{ readonly paneId: string } | undefined> {
    if (status !== "open" && !(status === "idle" && paneId !== undefined))
      return undefined;
    if (paneId === undefined) return undefined;
    try {
      if (await input.runner.paneExists(paneId)) {
        status = "open";
        return { paneId };
      }
      paneId = undefined;
      status = "manually-closed";
      persist();
      return undefined;
    } catch {
      status = "unavailable";
      return undefined;
    }
  }

  return {
    async ensure() {
      await initialize();
      const existing = await current();
      if (existing !== undefined) return existing;
      if (status === "manually-closed") return undefined;
      return open();
    },
    async reopen() {
      await initialize();
      const existing = await current();
      if (existing !== undefined) return existing;
      status = "idle";
      return open();
    },
    async close(): Promise<void> {
      await initialize();
      await opening;
      const ownedPaneId = paneId;
      paneId = undefined;
      status = "manually-closed";
      persist();
      if (ownedPaneId === undefined) return;
      try {
        await input.runner.closePane(ownedPaneId);
      } catch {}
    },
    markManuallyClosed(): void {
      paneId = undefined;
      status = "manually-closed";
      persist();
    },
    setViewState(next: HerdrDagViewState): void {
      state = { ...next };
      persist();
    },
    viewState(): HerdrDagViewState {
      return { ...state };
    },
    status(): HerdrObserverStatus {
      return status;
    },
  };
}
