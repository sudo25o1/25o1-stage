/**
 * Naming Ceremony Tests
 */

import { describe, it, expect } from "vitest";
import {
  checkNamingReadiness,
  prepareNamingCeremony,
  processNamingResponse,
  generateCandidateNames,
} from "./naming.js";
import type { Instance25o1State } from "../state/types.js";
import type { NamingCeremonyContext, CeremonyResponse } from "./types.js";

describe("Naming Ceremony", () => {
  const createTestState = (overrides: Partial<Instance25o1State["lifecycle"]> = {}): Instance25o1State => ({
    version: 1,
    instance: {
      id: "test-agent",
      role: "primary",
      managementTier: "fully_managed",
    },
    lifecycle: {
      state: "learning",
      sessions: 0,
      memories: 0,
      created: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
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
      ...overrides,
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
    },
    firstMeeting: {
      completed: true,
      completedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
    network: {
      healthReporter: { enabled: false, intervalMs: 3600000 },
      monitorEnabled: true,
    },
    updatedAt: Date.now(),
  });

  describe("checkNamingReadiness", () => {
    it("returns not ready when thresholds not met", () => {
      const state = createTestState({
        sessions: 5,
        memories: 10,
      });

      const result = checkNamingReadiness(state);

      expect(result.ready).toBe(false);
      expect(result.recommendation).toBe("defer");
      expect(result.score).toBeLessThan(0.6);
    });

    it("returns ready when all thresholds met", () => {
      const state = createTestState({
        sessions: 25,
        memories: 60,
        milestones: [
          { id: "1", type: "custom", date: Date.now(), description: "Test 1" },
          { id: "2", type: "custom", date: Date.now(), description: "Test 2" },
          { id: "3", type: "custom", date: Date.now(), description: "Test 3" },
        ],
      });

      const result = checkNamingReadiness(state);

      expect(result.ready).toBe(true);
      expect(result.recommendation).toBe("proceed");
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    });

    it("returns ready when most thresholds met and score is high", () => {
      const state = createTestState({
        sessions: 25,
        memories: 60,
        milestones: [
          { id: "1", type: "custom", date: Date.now(), description: "Test 1" },
          { id: "2", type: "custom", date: Date.now(), description: "Test 2" },
        ], // Only 2 milestones, but other thresholds met
      });

      const result = checkNamingReadiness(state);

      // Should still be ready because 3 of 4 factors are met
      expect(result.score).toBeGreaterThan(0.7);
    });

    it("forces ready when max deferrals reached", () => {
      const state = createTestState({
        sessions: 5,
        memories: 10,
        namingDeferrals: 3,
      });

      const result = checkNamingReadiness(state);

      expect(result.ready).toBe(true);
      expect(result.recommendation).toBe("proceed");
      expect(result.waitReason).toContain("Maximum deferrals");
    });

    it("tracks individual factors", () => {
      const state = createTestState({
        sessions: 10, // Half of required
        memories: 25, // Half of required
      });

      const result = checkNamingReadiness(state);

      expect(result.factors).toHaveLength(4);

      const sessionsFactor = result.factors.find((f) => f.name === "sessions");
      expect(sessionsFactor?.met).toBe(false);
      expect(sessionsFactor?.current).toBe(10);
      expect(sessionsFactor?.required).toBe(20);

      const memoriesFactor = result.factors.find((f) => f.name === "memories");
      expect(memoriesFactor?.met).toBe(false);
      expect(memoriesFactor?.current).toBe(25);
      expect(memoriesFactor?.required).toBe(50);
    });
  });

  describe("prepareNamingCeremony", () => {
    const createNamingContext = (): NamingCeremonyContext => ({
      type: "naming",
      agentState: "learning",
      agentId: "test-agent",
      clientId: "test-client",
      initiatedAt: new Date(),
      initiatedBy: "agent",
      sessionCount: 25,
      memoryCount: 60,
      daysSinceCreation: 30,
      significantMoments: [
        {
          date: new Date(),
          description: "Helped solve a complex problem",
          emotionalTone: "growth",
          relevanceToNaming: "Showed our collaborative potential",
        },
      ],
      observedPatterns: [
        {
          pattern: "You prefer detailed explanations",
          confidence: 0.8,
          examples: ["Asked for more context on technical topics"],
        },
      ],
      candidateNames: [
        {
          name: "Sage",
          reasoning: "Reflects our analytical work together",
          connectionToRelationship: "Wisdom through collaboration",
          confidence: 0.8,
        },
      ],
    });

    it("creates a complete ceremony structure", () => {
      const context = createNamingContext();
      const ceremony = prepareNamingCeremony(context);

      expect(ceremony.context).toBe(context);
      expect(ceremony.recognition).toBeDefined();
      expect(ceremony.reflection).toBeDefined();
      expect(ceremony.permission).toBeDefined();
      expect(ceremony.narrative).toBeDefined();
      expect(ceremony.timing).toBeDefined();
    });

    it("builds recognition phase with observations", () => {
      const context = createNamingContext();
      const ceremony = prepareNamingCeremony(context);

      expect(ceremony.recognition.observations.length).toBeGreaterThan(0);
      expect(ceremony.recognition.evidence.length).toBeGreaterThan(0);
      expect(ceremony.recognition.confidence).toBeGreaterThan(0);
      expect(ceremony.recognition.narrative).toBeTruthy();
    });

    it("builds reflection phase with proposal", () => {
      const context = createNamingContext();
      const ceremony = prepareNamingCeremony(context);

      expect(ceremony.reflection.interpretation).toBeTruthy();
      expect(ceremony.reflection.implications.length).toBeGreaterThan(0);
      expect(ceremony.reflection.uncertainties.length).toBeGreaterThan(0);
      expect(ceremony.reflection.emotionalContext).toBeDefined();
      expect(ceremony.reflection.proposal?.name).toBe("Sage");
    });

    it("builds permission phase with options", () => {
      const context = createNamingContext();
      const ceremony = prepareNamingCeremony(context);

      expect(ceremony.permission.request.ask).toContain("Sage");
      expect(ceremony.permission.options.length).toBe(4);
      expect(ceremony.permission.options.map((o) => o.id)).toContain("accept");
      expect(ceremony.permission.options.map((o) => o.id)).toContain("suggest");
      expect(ceremony.permission.options.map((o) => o.id)).toContain("wait");
      expect(ceremony.permission.options.map((o) => o.id)).toContain("discuss");
    });

    it("builds narrative with all sections", () => {
      const context = createNamingContext();
      const ceremony = prepareNamingCeremony(context);

      expect(ceremony.narrative.opening).toBeTruthy();
      expect(ceremony.narrative.recognitionText).toBeTruthy();
      expect(ceremony.narrative.reflectionText).toBeTruthy();
      expect(ceremony.narrative.permissionText).toBeTruthy();
      expect(ceremony.narrative.closing).toBeTruthy();
    });
  });

  describe("processNamingResponse", () => {
    const createCeremonyWithProposal = () => {
      const context: NamingCeremonyContext = {
        type: "naming",
        agentState: "learning",
        agentId: "test-agent",
        clientId: "test-client",
        initiatedAt: new Date(),
        initiatedBy: "agent",
        sessionCount: 25,
        memoryCount: 60,
        daysSinceCreation: 30,
        significantMoments: [],
        observedPatterns: [],
        candidateNames: [
          {
            name: "Sage",
            reasoning: "Test",
            connectionToRelationship: "Test",
            confidence: 0.8,
          },
        ],
      };
      return prepareNamingCeremony(context);
    };

    it("handles acceptance", () => {
      const ceremony = createCeremonyWithProposal();
      const response: CeremonyResponse = {
        optionId: "accept",
        feedback: "I love it!",
        respondedAt: new Date(),
        tone: "enthusiastic",
      };

      const outcome = processNamingResponse(ceremony, response);

      expect(outcome.result).toBe("completed");
      expect(outcome.stateChanges).toBeDefined();
      expect(outcome.stateChanges?.find((c) => c.field === "name")?.to).toBe("Sage");
      expect(outcome.memory.summary).toContain("Sage");
    });

    it("handles deferral", () => {
      const ceremony = createCeremonyWithProposal();
      const response: CeremonyResponse = {
        optionId: "wait",
        feedback: "Not yet",
        respondedAt: new Date(),
        tone: "needs_time",
      };

      const outcome = processNamingResponse(ceremony, response);

      expect(outcome.result).toBe("deferred");
      expect(outcome.stateChanges?.find((c) => c.field === "namingDeferrals")).toBeDefined();
    });

    it("handles name suggestion", () => {
      const ceremony = createCeremonyWithProposal();
      const response: CeremonyResponse = {
        optionId: "accept",
        modifications: ["Atlas"],
        feedback: "I prefer Atlas",
        respondedAt: new Date(),
        tone: "accepting",
      };

      const outcome = processNamingResponse(ceremony, response);

      expect(outcome.result).toBe("completed");
      expect(outcome.stateChanges?.find((c) => c.field === "name")?.to).toBe("Atlas");
    });

    it("handles discussion request", () => {
      const ceremony = createCeremonyWithProposal();
      const response: CeremonyResponse = {
        optionId: "discuss",
        feedback: "I want to talk about this more",
        respondedAt: new Date(),
        tone: "hesitant",
      };

      const outcome = processNamingResponse(ceremony, response);

      expect(outcome.result).toBe("modified");
      expect(outcome.followUp?.some((f) => f.action.includes("Continue"))).toBe(true);
    });
  });

  describe("generateCandidateNames", () => {
    it("generates names based on creative themes", () => {
      const context: NamingCeremonyContext = {
        type: "naming",
        agentState: "learning",
        agentId: "test-agent",
        clientId: "test-client",
        initiatedAt: new Date(),
        initiatedBy: "agent",
        sessionCount: 25,
        memoryCount: 60,
        daysSinceCreation: 30,
        significantMoments: [
          {
            date: new Date(),
            description: "Helped create a new design",
            emotionalTone: "positive",
            relevanceToNaming: "Creative collaboration",
          },
        ],
        observedPatterns: [],
      };

      const names = generateCandidateNames(context);

      expect(names.length).toBeGreaterThan(0);
      expect(names.some((n) => n.name === "Muse")).toBe(true);
    });

    it("generates names based on analytical themes", () => {
      const context: NamingCeremonyContext = {
        type: "naming",
        agentState: "learning",
        agentId: "test-agent",
        clientId: "test-client",
        initiatedAt: new Date(),
        initiatedBy: "agent",
        sessionCount: 25,
        memoryCount: 60,
        daysSinceCreation: 30,
        significantMoments: [
          {
            date: new Date(),
            description: "Helped analyze complex data",
            emotionalTone: "growth",
            relevanceToNaming: "Problem solving",
          },
        ],
        observedPatterns: [],
      };

      const names = generateCandidateNames(context);

      expect(names.length).toBeGreaterThan(0);
      expect(names.some((n) => n.name === "Sage")).toBe(true);
    });

    it("provides default name when no themes detected", () => {
      const context: NamingCeremonyContext = {
        type: "naming",
        agentState: "learning",
        agentId: "test-agent",
        clientId: "test-client",
        initiatedAt: new Date(),
        initiatedBy: "agent",
        sessionCount: 25,
        memoryCount: 60,
        daysSinceCreation: 30,
        significantMoments: [],
        observedPatterns: [],
      };

      const names = generateCandidateNames(context);

      expect(names.length).toBeGreaterThan(0);
      expect(names[0].name).toBe("Partner");
    });

    it("sorts names by confidence", () => {
      const context: NamingCeremonyContext = {
        type: "naming",
        agentState: "learning",
        agentId: "test-agent",
        clientId: "test-client",
        initiatedAt: new Date(),
        initiatedBy: "agent",
        sessionCount: 25,
        memoryCount: 60,
        daysSinceCreation: 30,
        significantMoments: [
          {
            date: new Date(),
            description: "Helped create and analyze",
            emotionalTone: "growth",
            relevanceToNaming: "Both creative and analytical",
          },
        ],
        observedPatterns: [
          {
            pattern: "You need help and support",
            confidence: 0.9,
            examples: [],
          },
        ],
      };

      const names = generateCandidateNames(context);

      // Should be sorted by confidence descending
      for (let i = 1; i < names.length; i++) {
        expect(names[i - 1].confidence).toBeGreaterThanOrEqual(names[i].confidence);
      }
    });
  });
});
