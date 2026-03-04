/**
 * Significance Layer
 *
 * The core loop for relationship persistence:
 * 1. Before response: Query QMD, build context with time awareness
 * 2. After response: Analyze through four lenses, update documents
 *
 * Philosophy: A good partner notices things, asks questions, revisits
 * stories, and learns continuously. Not interrogating. Not ignoring.
 * Natural attention shaped by time of day.
 */

// Types
export * from "./types.js";

// Context building (before_agent_start)
export { buildContext, formatContextForPrompt, hasSignificantContext } from "./context-builder.js";

// QMD integration
export {
  queryQMDContext,
  trackPatternObservation,
  isPatternConfirmed,
  initQMDClient,
  isQMDClientInitialized,
  type OpenClawConfigLike,
  type MemorySearchManagerLike,
} from "./qmd-client.js";

// Four lenses analysis
export {
  analyzeWithFourLenses,
  calculateSignificanceScore,
  shouldUpdateDocuments,
} from "./four-lenses.js";

// Main analyzer (agent_end)
export {
  analyzeSignificance,
  detectNamingMoment,
  detectFirstMeetingPattern,
  detectRelationshipDeepening,
  type SignificanceResult,
  type SignificanceSignal,
  type SignalType,
} from "./analyzer.js";
