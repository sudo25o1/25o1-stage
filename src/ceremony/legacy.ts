/**
 * Legacy Ceremony Types
 *
 * Backward compatibility types for the plugin.ts interface.
 */

import type { Instance25o1State, LifecycleState } from "../state/types.js";
import { processCeremonyResponseAndUpdateState } from "./conversation.js";

// =============================================================================
// Legacy Types (for plugin.ts compatibility)
// =============================================================================

export interface MessageEvent {
  content: string;
  from: string;
  channel: string;
}

export interface CeremonyResponseResult {
  handled: boolean;
  newState?: LifecycleState;
  name?: string;
}

/**
 * Legacy wrapper for processing ceremony responses.
 * Used by plugin.ts for the message_received hook.
 */
export async function processCeremonyResponse(
  event: MessageEvent,
  state: Instance25o1State,
): Promise<CeremonyResponseResult> {
  // If no pending ceremony, nothing to handle
  if (!state.ceremony.pending) {
    return { handled: false };
  }

  try {
    const result = await processCeremonyResponseAndUpdateState(event.content);

    if (!result.processed) {
      return { handled: false };
    }

    return {
      handled: true,
      newState: result.newState,
      name: result.newName,
    };
  } catch {
    return { handled: false };
  }
}
