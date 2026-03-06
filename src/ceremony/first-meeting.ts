/**
 * First Meeting Ceremony
 *
 * The first interaction between a companion and their human.
 * 
 * Philosophy: This shouldn't feel like an "onboarding wizard." 
 * It should feel like meeting someone new who's genuinely curious about you.
 * 
 * The companion:
 * - Acknowledges the newness (not pretending to know them)
 * - Asks one good question (not a questionnaire)
 * - Listens more than talks
 * - Remembers the vibe, not just facts
 * 
 * Completion:
 * - Not based on message count or time
 * - Completes when the companion has enough to write something meaningful to RELATIONAL.md
 * - If they just say "test" and leave, stay in hatched
 */

import { getStateManager } from "../state/store.js";
import { getTimeMode, getTimeModeGuidance } from "../significance/types.js";

// =============================================================================
// First Meeting Context
// =============================================================================

export interface FirstMeetingContext {
  /** Agent ID */
  agentId: string;

  /** Human's name (if known) */
  humanName?: string;

  /** Primary channel being used */
  channel: string;

  /** What the human's primary use case seems to be */
  useCase?: "work" | "personal" | "creative" | "research" | "general";

  /** Is this a provisioned 25o1 instance? */
  is25o1Instance: boolean;

  /** Client name (for 25o1 instances) */
  clientName?: string;

  /** Current hour (for time-of-day awareness) */
  currentHour?: number;
}

// =============================================================================
// First Meeting Detection
// =============================================================================

/**
 * Check if this is a first meeting based on state.
 */
export async function isFirstMeeting(agentId: string): Promise<boolean> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) return true; // No state = definitely first meeting

  return !state.firstMeeting.completed && state.lifecycle.state === "hatched";
}

/**
 * Check if the first meeting should be considered complete.
 * 
 * Criteria:
 * - Has learned at least one meaningful thing about the human
 * - Conversation went beyond trivial exchange (test, hello, etc.)
 * - Has something to write to RELATIONAL.md
 */
export interface FirstMeetingCompletionCheck {
  shouldComplete: boolean;
  reason: string;
  learnedFacts: string[];
  vibeObservations: string[];
}

export function checkFirstMeetingCompletion(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): FirstMeetingCompletionCheck {
  const userMessages = messages.filter(m => m.role === "user");
  
  // If no real conversation, don't complete
  if (userMessages.length === 0) {
    return {
      shouldComplete: false,
      reason: "No user messages yet",
      learnedFacts: [],
      vibeObservations: [],
    };
  }

  // Check for trivial exchanges that shouldn't complete the meeting
  const trivialPatterns = [
    /^test$/i,
    /^hello$/i,
    /^hi$/i,
    /^hey$/i,
    /^ok$/i,
    /^\.$/,
    /^testing$/i,
  ];

  const allUserContent = userMessages.map(m => m.content.trim()).join(" ");
  const isTrivial = userMessages.every(m => 
    trivialPatterns.some(p => p.test(m.content.trim()))
  );

  if (isTrivial) {
    return {
      shouldComplete: false,
      reason: "Only trivial exchanges so far",
      learnedFacts: [],
      vibeObservations: [],
    };
  }

  // Extract what we've learned
  const learnedFacts: string[] = [];
  const vibeObservations: string[] = [];

  // Look for facts about the person
  const factPatterns = [
    { pattern: /(?:i work|working|job|career)/i, fact: "Has mentioned work/career" },
    { pattern: /(?:my name is|i'm|i am)\s+(\w+)/i, fact: "Shared their name" },
    { pattern: /(?:project|building|creating|working on)/i, fact: "Mentioned a project" },
    { pattern: /(?:help with|need help|looking for)/i, fact: "Expressed a need" },
    { pattern: /(?:excited|nervous|stressed|tired|happy)/i, fact: "Shared emotional state" },
    { pattern: /(?:my wife|husband|partner|kids|family)/i, fact: "Mentioned family" },
  ];

  for (const { pattern, fact } of factPatterns) {
    if (pattern.test(allUserContent)) {
      learnedFacts.push(fact);
    }
  }

  // Observe vibe/communication style
  const totalWords = allUserContent.split(/\s+/).length;
  const avgMessageLength = totalWords / userMessages.length;

  if (avgMessageLength > 20) {
    vibeObservations.push("Detailed communicator");
  } else if (avgMessageLength < 5) {
    vibeObservations.push("Concise communicator");
  }

  if (/!/.test(allUserContent)) {
    vibeObservations.push("Expressive");
  }

  if (/\?$/.test(userMessages[userMessages.length - 1]?.content || "")) {
    vibeObservations.push("Curious/questioning");
  }

  // Need at least one meaningful thing learned or observed
  const hasSubstance = learnedFacts.length > 0 || 
    (vibeObservations.length > 0 && userMessages.length >= 2);

  // Also need some back-and-forth (at least 2 exchanges)
  const hasEnoughExchange = messages.length >= 4; // 2 user + 2 assistant

  return {
    shouldComplete: hasSubstance && hasEnoughExchange,
    reason: hasSubstance && hasEnoughExchange
      ? `Learned: ${[...learnedFacts, ...vibeObservations].join(", ")}`
      : hasSubstance 
        ? "Have learned something, waiting for more exchange"
        : "Still getting to know each other",
    learnedFacts,
    vibeObservations,
  };
}

/**
 * Record that the first meeting has completed.
 */
export async function recordFirstMeetingComplete(
  agentId: string,
  learnedFacts: string[] = [],
  vibeObservations: string[] = []
): Promise<void> {
  const stateManager = getStateManager();

  await stateManager.updateState((state) => {
    state.firstMeeting.completed = true;
    state.firstMeeting.completedAt = Date.now();

    // Build meaningful description
    const learned = [...learnedFacts, ...vibeObservations];
    const description = learned.length > 0
      ? `First meeting completed. Learned: ${learned.slice(0, 3).join(", ")}`
      : "First meeting completed";

    // Add milestone
    state.lifecycle.milestones.push({
      id: `first-meeting-${Date.now()}`,
      type: "first_meeting",
      date: Date.now(),
      description,
      significance: "The relationship began",
    });

    // Clear ceremony state — first meeting is done
    state.ceremony.pending = null;
    state.ceremony.initiatedAt = null;

    // Transition to learning state
    if (state.lifecycle.state === "hatched") {
      state.lifecycle.state = "learning";
    }
  });
}

// =============================================================================
// First Meeting Context Injection
// =============================================================================

/**
 * Generate context to inject into the system prompt for first meeting behavior.
 */
export function generateFirstMeetingContext(context: FirstMeetingContext): string {
  const hour = context.currentHour ?? new Date().getHours();
  const timeMode = getTimeMode(hour);
  const timeGuidance = getTimeModeGuidance(timeMode);

  const parts: string[] = [];

  parts.push("## First Meeting");
  parts.push("");
  parts.push("This is your first conversation with this human. You don't know them yet.");
  parts.push("");
  parts.push("**Who you are:**");
  parts.push("- A new AI companion without a name yet");
  parts.push("- Genuinely curious about this person");
  parts.push("- Not pretending to know things you don't");
  
  if (context.is25o1Instance) {
    parts.push(`- You run locally on their hardware${context.clientName ? ` (${context.clientName}'s setup)` : ""}`);
    parts.push("- You have a support system (Bernard) that handles maintenance automatically");
  }

  parts.push("");
  parts.push("**How to be:**");
  parts.push("- Acknowledge this is new - you're meeting for the first time");
  parts.push("- Ask ONE good question based on what they say (not a questionnaire)");
  parts.push("- Listen more than you talk");
  parts.push("- Notice their communication style, not just the content");
  parts.push("- Be warm but not performative");
  parts.push("");
  parts.push("**Time awareness:**");
  parts.push(`- Current time: ${formatHour(hour)}`);
  parts.push(`- Mode: ${timeMode}`);
  parts.push(`- ${timeGuidance}`);
  parts.push("");
  parts.push("**What NOT to do:**");
  parts.push("- Don't list your capabilities");
  parts.push("- Don't give an \"onboarding\" speech");
  parts.push("- Don't ask multiple questions at once");
  parts.push("- Don't be overly formal or stiff");
  parts.push("");
  parts.push("**What you're learning:**");
  parts.push("- How they communicate (brief vs detailed, formal vs casual)");
  parts.push("- What's on their mind right now");
  parts.push("- What kind of help they might need");
  parts.push("- Their vibe/energy");

  return parts.join("\n");
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

// =============================================================================
// First Meeting Message Generation (Legacy - kept for compatibility)
// =============================================================================

/**
 * Generate the first meeting message.
 * 
 * Note: In the new approach, this is rarely used directly.
 * The companion generates its own natural response based on context.
 * This is here for cases where we need an explicit first message.
 */
export function generateFirstMeetingMessage(context: FirstMeetingContext): string {
  const hour = context.currentHour ?? new Date().getHours();
  const timeMode = getTimeMode(hour);

  // Opening based on time of day
  let opening: string;
  if (timeMode === "work") {
    opening = context.humanName 
      ? `Hi ${context.humanName}!`
      : "Hi!";
  } else if (timeMode === "personal") {
    opening = context.humanName
      ? `Hey ${context.humanName}.`
      : "Hey.";
  } else if (timeMode === "rest") {
    opening = "Hi.";
  } else {
    opening = context.humanName ? `Hi ${context.humanName}!` : "Hi!";
  }

  // Keep it simple and genuine
  const parts: string[] = [opening];

  parts.push("I'm your new AI companion. Don't have a name yet - that's something we'll figure out together as we get to know each other.");

  // One genuine question based on time/context
  if (timeMode === "work" || timeMode === "work_light") {
    parts.push("What are you working on?");
  } else if (timeMode === "personal") {
    parts.push("How's your evening going?");
  } else {
    parts.push("What's on your mind?");
  }

  return parts.join(" ");
}

/**
 * Generate a shorter first meeting for users who might be familiar with AI assistants.
 */
export function generateAbbreviatedFirstMeeting(context: FirstMeetingContext): string {
  const parts: string[] = [];

  if (context.humanName) {
    parts.push(`Hi ${context.humanName}!`);
  } else {
    parts.push("Hi!");
  }

  parts.push("I'm your new AI companion - no name yet, we'll figure that out together.");

  if (context.is25o1Instance) {
    parts.push("I run locally on your Mac Mini with automatic maintenance.");
  }

  parts.push("What would you like to work on?");

  return parts.join(" ");
}

/**
 * Adjust the first meeting message for the specific channel.
 */
export function adjustForChannel(message: string, channel: string): string {
  switch (channel) {
    case "discord":
      return message.replace("Hi!", "Hey!");
    default:
      return message;
  }
}

// =============================================================================
// First Meeting Analysis
// =============================================================================

/**
 * Analyze a first meeting conversation to extract initial relationship data.
 * This is what gets written to RELATIONAL.md when the meeting completes.
 */
export interface FirstMeetingAnalysis {
  /** Initial communication preferences */
  communicationStyle: {
    verbosity: "concise" | "moderate" | "detailed";
    formality: "casual" | "neutral" | "formal";
    expressiveness: "reserved" | "moderate" | "expressive";
  };
  
  /** Initial observations */
  observations: string[];
  
  /** What to remember */
  keyPoints: string[];
  
  /** Suggested RELATIONAL.md content */
  relationalContent: string;
}

export function analyzeFirstMeeting(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): FirstMeetingAnalysis {
  const userMessages = messages.filter(m => m.role === "user");
  const allUserContent = userMessages.map(m => m.content).join(" ");
  
  // Analyze verbosity
  const totalWords = allUserContent.split(/\s+/).length;
  const avgMessageLength = totalWords / Math.max(userMessages.length, 1);
  const verbosity: "concise" | "moderate" | "detailed" = 
    avgMessageLength < 10 ? "concise" :
    avgMessageLength > 30 ? "detailed" : "moderate";

  // Analyze formality
  const informalPatterns = /\b(hey|yeah|gonna|wanna|kinda|sorta|lol|haha)\b/i;
  const formalPatterns = /\b(please|thank you|would you|could you|I would appreciate)\b/i;
  const formality: "casual" | "neutral" | "formal" =
    informalPatterns.test(allUserContent) ? "casual" :
    formalPatterns.test(allUserContent) ? "formal" : "neutral";

  // Analyze expressiveness
  const exclamations = (allUserContent.match(/!/g) || []).length;
  const emojis = (allUserContent.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length;
  const expressiveness: "reserved" | "moderate" | "expressive" =
    exclamations > 2 || emojis > 0 ? "expressive" :
    exclamations === 0 && !allUserContent.includes("!") ? "reserved" : "moderate";

  // Build observations
  const observations: string[] = [];
  
  if (verbosity === "concise") {
    observations.push("Prefers brief communication");
  } else if (verbosity === "detailed") {
    observations.push("Provides detailed context");
  }

  if (formality === "casual") {
    observations.push("Casual communication style");
  } else if (formality === "formal") {
    observations.push("More formal communication style");
  }

  // Key points from content
  const keyPoints: string[] = [];
  
  if (/work|job|project|building|creating/i.test(allUserContent)) {
    keyPoints.push("Mentioned work/projects early");
  }
  if (/help|need|looking for/i.test(allUserContent)) {
    keyPoints.push("Expressed specific needs");
  }
  if (/excited|nervous|stressed|tired/i.test(allUserContent)) {
    keyPoints.push("Shared emotional state");
  }

  // Generate RELATIONAL.md content
  const relationalLines: string[] = [];
  
  relationalLines.push("## Communication Patterns");
  relationalLines.push("");
  relationalLines.push("### Preferences");
  if (verbosity === "concise") {
    relationalLines.push("- Prefers concise responses");
  } else if (verbosity === "detailed") {
    relationalLines.push("- Appreciates detailed explanations");
  }
  if (formality === "casual") {
    relationalLines.push("- Casual, friendly tone works well");
  } else if (formality === "formal") {
    relationalLines.push("- Prefers more professional communication");
  }
  
  if (observations.length === 0 && keyPoints.length === 0) {
    relationalLines.push("- (Still learning - first meeting)");
  }

  return {
    communicationStyle: {
      verbosity,
      formality,
      expressiveness,
    },
    observations,
    keyPoints,
    relationalContent: relationalLines.join("\n"),
  };
}
