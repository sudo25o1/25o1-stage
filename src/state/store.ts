/**
 * 25o1 State Store
 *
 * Persistent storage for instance state.
 *
 * Pattern:
 * - Atomic writes (tmp file + rename)
 * - Lazy loading with in-memory cache
 * - Graceful handling of missing files
 * - Backup on save (.bak file)
 *
 * State is stored at: ~/.openclaw/25o1-state.json
 */

import fs from "node:fs";
import path from "node:path";
import { getHomeDir } from "../utils/fs.js";
import type {
  Instance25o1State,
  InstanceRole,
  ManagementTier,
} from "./types.js";

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the state file path.
 */
export function getStatePath(stateDir?: string): string {
  const baseDir = stateDir || path.join(getHomeDir(), ".openclaw");
  return path.join(baseDir, "25o1-state.json");
}

// =============================================================================
// Default State
// =============================================================================

/**
 * Create default state for a new instance.
 */
export function createDefaultState(
  instanceId: string,
  options?: {
    role?: InstanceRole;
    managementTier?: ManagementTier;
    clientName?: string;
    bernardHost?: string;
  }
): Instance25o1State {
  const role = options?.role ?? "client";
  const isPrimary = role === "primary";

  return {
    version: 1,
    instance: {
      id: instanceId,
      role,
      managementTier: options?.managementTier ?? "fully_managed",
      clientName: options?.clientName,
    },
    lifecycle: {
      state: "hatched",
      sessions: 0,
      memories: 0,
      created: Date.now(),
      lastActive: Date.now(),
      namingThreshold: {
        minSessions: 20,
        minMemories: 50,
        minDays: 14,
        maxDeferrals: 3,
        humanCanOverride: true,
        agentCanInitiate: true,
      },
      namingDeferrals: 0,
      milestones: [],
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
    },
    firstMeeting: {
      completed: false,
      completedAt: null,
    },
    network: {
      bernardHost: isPrimary ? undefined : options?.bernardHost,
      healthReporter: {
        enabled: !isPrimary, // Primary doesn't report to anyone
        intervalMs: 60 * 60 * 1000, // 1 hour
      },
      monitorEnabled: isPrimary, // Only primary monitors
    },
    updatedAt: Date.now(),
  };
}

// =============================================================================
// Loading
// =============================================================================

/**
 * Load state from disk.
 * Returns null if file doesn't exist.
 */
export async function loadState(stateDir?: string): Promise<Instance25o1State | null> {
  const statePath = getStatePath(stateDir);

  try {
    const raw = await fs.promises.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid 25o1 state format at ${statePath}`);
    }

    const state = parsed as Instance25o1State;
    if (state.version !== 1) {
      throw new Error(`Unsupported 25o1 state version: ${state.version}`);
    }

    return state;
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

// =============================================================================
// Saving
// =============================================================================

/**
 * Save state to disk atomically.
 * Uses tmp file + rename for atomic writes.
 * Creates backup (.bak) on successful save.
 */
export async function saveState(
  state: Instance25o1State,
  stateDir?: string
): Promise<void> {
  const statePath = getStatePath(stateDir);

  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

  // Update timestamp
  state.updatedAt = Date.now();

  // Write to tmp file
  const tmp = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(state, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");

  // Atomic rename
  await fs.promises.rename(tmp, statePath);

  // Best-effort backup
  try {
    await fs.promises.copyFile(statePath, `${statePath}.bak`);
  } catch {
    // Backup failure is not critical
  }
}

// =============================================================================
// State Manager
// =============================================================================

/**
 * State manager with in-memory cache.
 * Loads state once, keeps it in memory, saves on changes.
 */
export class StateManager {
  private state: Instance25o1State | null = null;
  private stateDir?: string;
  private loaded = false;
  private updateQueue: Promise<unknown> = Promise.resolve();

  constructor(stateDir?: string) {
    this.stateDir = stateDir;
  }

  /**
   * Get current state (loads from disk if not cached).
   */
  async getState(): Promise<Instance25o1State | null> {
    if (!this.loaded) {
      this.state = await loadState(this.stateDir);
      this.loaded = true;
    }
    return this.state;
  }

  /**
   * Initialize state for a new instance.
   */
  async initialize(
    instanceId: string,
    options?: {
      role?: InstanceRole;
      managementTier?: ManagementTier;
      clientName?: string;
      bernardHost?: string;
    }
  ): Promise<Instance25o1State> {
    this.state = createDefaultState(instanceId, options);
    await saveState(this.state, this.stateDir);
    this.loaded = true;
    return this.state;
  }

  /**
   * Set state directly (saves to disk).
   */
  async setState(state: Instance25o1State): Promise<void> {
    this.state = state;
    await saveState(state, this.stateDir);
    this.loaded = true;
  }

  /**
   * Update state (saves to disk).
   */
  updateState(
    updater: (state: Instance25o1State) => Instance25o1State | void
  ): Promise<Instance25o1State> {
    const executeUpdate = async () => {
      const current = await this.getState();
      if (!current) {
        throw new Error("State not initialized. Call initialize() first.");
      }

      // Clone state so we don't mutate memory until disk save succeeds
      const stateClone = JSON.parse(JSON.stringify(current));
      const updated = updater(stateClone) || stateClone;
      
      await saveState(updated, this.stateDir);
      this.state = updated;
      return updated;
    };

    const task = this.updateQueue.then(executeUpdate);
    this.updateQueue = task.catch(() => Promise.resolve());
    return task;
  }

  /**
   * Check if state is initialized.
   */
  async isInitialized(): Promise<boolean> {
    const state = await this.getState();
    return state !== null;
  }

  /**
   * Clear cache (forces reload on next access).
   */
  clearCache(): void {
    this.state = null;
    this.loaded = false;
  }
}

// =============================================================================
// Global State Manager
// =============================================================================

let globalStateManager: StateManager | undefined;

/**
 * Get the global state manager (creates if needed).
 */
export function getStateManager(stateDir?: string): StateManager {
  if (!globalStateManager) {
    globalStateManager = new StateManager(stateDir);
  }
  return globalStateManager;
}

/**
 * Initialize the global state manager.
 */
export function initializeStateManager(stateDir?: string): void {
  globalStateManager = new StateManager(stateDir);
}

/**
 * Reset the global state manager (for testing).
 */
export function resetStateManager(): void {
  globalStateManager = undefined;
}
