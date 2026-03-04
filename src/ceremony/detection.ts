/**
 * Ceremony Detection
 *
 * Re-exports from the ceremony system for backward compatibility.
 */

// Re-export everything from the conversation engine
export {
  checkCeremonyOpportunity,
  generateCeremonyInitiation,
  generateCeremonyClosing,
  parseCeremonyResponse,
  processCeremonyResponseAndUpdateState,
  hasPendingCeremony,
  nudgeCeremony,
  clearCeremonyState,
  type CeremonyOpportunity,
  type CeremonyProcessResult,
} from "./conversation.js";

// Re-export naming ceremony functions
export {
  checkNamingReadiness,
  prepareNamingCeremony,
  processNamingResponse,
  generateCandidateNames,
  type NamingReadinessResult,
  type ReadinessFactor,
} from "./naming.js";

// Re-export first meeting functions
export {
  isFirstMeeting,
  recordFirstMeetingComplete,
  generateFirstMeetingMessage,
  generateAbbreviatedFirstMeeting,
  adjustForChannel,
  type FirstMeetingContext,
} from "./first-meeting.js";

// Re-export types
export type {
  CeremonyContext,
  CeremonyAttempt,
  NamingCeremonyContext,
  SignificantMoment,
  ObservedPattern,
  CandidateName,
  RecognitionPhase,
  Observation,
  Evidence,
  ReflectionPhase,
  Implication,
  Uncertainty,
  EmotionalContext,
  NamingProposal,
  PermissionPhase,
  PermissionRequest,
  PermissionOption,
  PreparedCeremony,
  CeremonyNarrative,
  CeremonyTiming,
  CeremonyResponse,
  CeremonyOutcome,
  StateChange,
  FollowUpAction,
  CeremonyMemory,
  ConversationContext,
} from "./types.js";

// Legacy exports for backward compatibility with the stub
export type { MessageEvent } from "./legacy.js";
export { processCeremonyResponse, type CeremonyResponseResult } from "./legacy.js";
