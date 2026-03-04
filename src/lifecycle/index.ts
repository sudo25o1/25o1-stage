/**
 * 25o1 Lifecycle Module
 *
 * Public API for the agent lifecycle state machine.
 */

export { AgentLifecycle, createAgent } from "./machine.js";
export type {
  AgentIdentity,
  AgentState,
  AgentContext,
  GrowthPhase,
  StateTransition,
  TransitionTrigger,
  NamingThreshold,
  NamingAttempt,
  Milestone,
  Pattern,
  RepairContext,
  RepairTrigger,
  HealthStatus,
} from "../state/types.js";