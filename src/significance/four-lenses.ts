/**
 * Four Lenses Analysis
 *
 * Implements the four lenses for analyzing conversation significance:
 * 1. Significance - Is this worth remembering?
 * 2. Pattern - Have I seen this before?
 * 3. Contradiction - Does this conflict with what I knew?
 * 4. Gap - What don't I know that I should?
 */

import type {
  SignificanceLens,
  LensResult,
  LensItem,
  ConversationMessage,
  QMDContext,
  TimeMode,
} from "./types.js";

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze a conversation through all four lenses.
 */
export function analyzeWithFourLenses(
  messages: ConversationMessage[],
  qmdContext: QMDContext,
  timeMode: TimeMode
): LensResult[] {
  return [
    analyzeSignificance(messages, timeMode),
    analyzePatterns(messages, qmdContext),
    analyzeContradictions(messages, qmdContext),
    analyzeGaps(messages, qmdContext),
  ];
}

// =============================================================================
// Lens 1: Significance
// =============================================================================

/**
 * Significance lens: Is this worth remembering?
 * 
 * Looks for:
 * - New facts about them (job change, moved cities, new hobby)
 * - Emotional disclosure (stressed about X, excited about Y)
 * - Preferences revealed (hates meetings, loves mornings)
 */
function analyzeSignificance(
  messages: ConversationMessage[],
  timeMode: TimeMode
): LensResult {
  const items: LensItem[] = [];
  const userMessages = messages.filter(m => m.role === "user");

  for (const message of userMessages) {
    const content = message.content;

    // Check for new facts
    const factItems = detectNewFacts(content);
    items.push(...factItems);

    // Check for emotional disclosures
    const emotionalItems = detectEmotionalDisclosure(content);
    items.push(...emotionalItems);

    // Check for preferences
    const preferenceItems = detectPreferences(content);
    items.push(...preferenceItems);
  }

  // Adjust confidence based on time mode (personal time = more significance to personal shares)
  if (timeMode === "personal") {
    for (const item of items) {
      if (item.content.includes("feel") || item.content.includes("personal")) {
        item.confidence = Math.min(1, item.confidence * 1.2);
      }
    }
  }

  return {
    lens: "significance",
    found: items.length > 0,
    items,
  };
}

/**
 * Detect new facts in a message.
 */
function detectNewFacts(content: string): LensItem[] {
  const items: LensItem[] = [];

  // Job/work changes
  const jobPatterns = [
    /(?:got|started|left|quit|joined)\s+(?:a\s+)?(?:new\s+)?(?:job|position|role)/i,
    /(?:got\s+)?promoted\s+to/i,
    /(?:working|work)\s+(?:at|for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i,
    /new\s+(?:job|position|role)\s+(?:at|with)/i,
  ];
  for (const pattern of jobPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "Job/work change mentioned",
        confidence: 0.8,
        evidence: content.match(pattern)?.[0],
      });
      break;
    }
  }

  // Location changes
  const locationPatterns = [
    /(?:moved|moving|relocated)\s+to\s+([A-Z][a-z]+)/i,
    /(?:living|live)\s+in\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i,
  ];
  for (const pattern of locationPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "Location/move mentioned",
        confidence: 0.8,
        evidence: content.match(pattern)?.[0],
      });
      break;
    }
  }

  // New hobby/interest
  const hobbyPatterns = [
    /(?:started|picked up|getting into|learning)\s+([a-z]+(?:ing)?)/i,
    /(?:new|into)\s+(?:hobby|interest)/i,
  ];
  for (const pattern of hobbyPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "New interest/hobby mentioned",
        confidence: 0.6,
        evidence: content.match(pattern)?.[0],
      });
      break;
    }
  }

  // Family/relationship mentions
  const familyPatterns = [
    /my\s+(?:wife|husband|partner|girlfriend|boyfriend|spouse)/i,
    /my\s+(?:son|daughter|kids?|children|baby|child)/i,
    /my\s+(?:mom|dad|mother|father|parents?|brother|sister|sibling)/i,
  ];
  for (const pattern of familyPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "Family/relationship mentioned",
        confidence: 0.7,
        evidence: content.match(pattern)?.[0],
      });
      break;
    }
  }

  return items;
}

/**
 * Detect emotional disclosures.
 */
function detectEmotionalDisclosure(content: string): LensItem[] {
  const items: LensItem[] = [];

  const emotionalPatterns = [
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:stressed|anxious|worried|nervous)/i, emotion: "stress/anxiety" },
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:excited|thrilled|pumped|stoked)/i, emotion: "excitement" },
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:frustrated|annoyed|irritated|angry)/i, emotion: "frustration" },
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:sad|down|depressed|low)/i, emotion: "sadness" },
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:happy|great|good|wonderful)/i, emotion: "happiness" },
    { pattern: /(?:i'?m?|feeling)\s+(?:really\s+)?(?:overwhelmed|burnt out|exhausted)/i, emotion: "overwhelm" },
    { pattern: /(?:struggling|having a hard time)\s+with/i, emotion: "difficulty" },
  ];

  for (const { pattern, emotion } of emotionalPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: `Emotional disclosure: ${emotion}`,
        confidence: 0.75,
        evidence: content.match(pattern)?.[0],
      });
    }
  }

  return items;
}

/**
 * Detect preference statements.
 */
function detectPreferences(content: string): LensItem[] {
  const items: LensItem[] = [];

  const preferencePatterns = [
    { pattern: /i\s+(?:really\s+)?(?:love|enjoy|like)\s+(.+?)(?:\.|,|!|$)/i, type: "positive" },
    { pattern: /i\s+(?:really\s+)?(?:hate|dislike|can't stand)\s+(.+?)(?:\.|,|!|$)/i, type: "negative" },
    { pattern: /i\s+(?:prefer|always|never)\s+(.+?)(?:\.|,|!|$)/i, type: "preference" },
    { pattern: /(?:my favorite|the best)\s+(.+?)(?:\.|,|!|$)/i, type: "favorite" },
  ];

  for (const { pattern, type } of preferencePatterns) {
    const match = content.match(pattern);
    if (match) {
      items.push({
        content: `Preference (${type}): ${match[1]?.trim()}`,
        confidence: 0.7,
        evidence: match[0],
      });
    }
  }

  return items;
}

// =============================================================================
// Lens 2: Pattern
// =============================================================================

/**
 * Pattern lens: Have I seen this before?
 * 
 * Looks for:
 * - Recurring topics (third time they mentioned their sister)
 * - Behavioral patterns (always vents about work on Tuesdays)
 * - Emotional patterns (gets quiet when tired)
 */
function analyzePatterns(
  messages: ConversationMessage[],
  qmdContext: QMDContext
): LensResult {
  const items: LensItem[] = [];

  // Check existing patterns from QMD context
  for (const pattern of qmdContext.patterns) {
    if (pattern.confidence > 0.5) {
      items.push({
        content: pattern.description,
        confidence: pattern.confidence,
        occurrences: pattern.occurrences,
      });
    }
  }

  // Look for potential new patterns in current messages
  const userMessages = messages.filter(m => m.role === "user");
  const fullContent = userMessages.map(m => m.content).join(" ");

  // Topic repetition within this conversation
  const topicCounts = new Map<string, number>();
  const entities = extractTopics(fullContent);
  for (const entity of entities) {
    topicCounts.set(entity, (topicCounts.get(entity) || 0) + 1);
  }

  for (const [topic, count] of topicCounts) {
    if (count >= 2) {
      items.push({
        content: `Topic repeated: "${topic}" (${count} times this conversation)`,
        confidence: 0.5,
        occurrences: count,
      });
    }
  }

  return {
    lens: "pattern",
    found: items.length > 0,
    items,
  };
}

/**
 * Extract topics/entities from text for pattern tracking.
 */
function extractTopics(text: string): string[] {
  const topics: string[] = [];

  // Proper nouns
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) || [];
  topics.push(...properNouns);

  // Common topic indicators
  const topicPatterns = [
    /(?:the|my)\s+(\w+\s+\w+|\w+)/gi,
  ];

  for (const pattern of topicPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[1].length > 3) {
        topics.push(match[1]);
      }
    }
  }

  return topics;
}

// =============================================================================
// Lens 3: Contradiction
// =============================================================================

/**
 * Contradiction lens: Does this conflict with what I knew?
 * 
 * Types:
 * - I was wrong (misunderstanding)
 * - They changed (real evolution)
 * - Context-dependent (both true in different situations)
 */
function analyzeContradictions(
  messages: ConversationMessage[],
  qmdContext: QMDContext
): LensResult {
  const items: LensItem[] = [];

  // Check contradictions identified during QMD query
  for (const contradiction of qmdContext.contradictions) {
    items.push({
      content: `Contradiction: "${contradiction.current}" vs previous "${contradiction.previous}"`,
      confidence: 0.7,
      previousKnowledge: contradiction.previous,
    });
  }

  // Look for explicit corrections in current messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const message of userMessages) {
    const correctionItems = detectCorrections(message.content);
    items.push(...correctionItems);
  }

  return {
    lens: "contradiction",
    found: items.length > 0,
    items,
  };
}

/**
 * Detect explicit corrections in a message.
 */
function detectCorrections(content: string): LensItem[] {
  const items: LensItem[] = [];

  const correctionPatterns = [
    /(?:actually|no),?\s+(?:i|it'?s?)\s+(.+)/i,
    /that'?s?\s+(?:not|wrong)/i,
    /you(?:'ve)?\s+got\s+(?:it|that)\s+wrong/i,
    /i\s+(?:didn't|don't|never)\s+(?:say|mean|said)/i,
  ];

  for (const pattern of correctionPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "Explicit correction detected",
        confidence: 0.9,
        evidence: content,
      });
      break;
    }
  }

  return items;
}

// =============================================================================
// Lens 4: Gap
// =============================================================================

/**
 * Gap lens: What don't I know that I should?
 * 
 * Identifies:
 * - Mentioned entities without context
 * - References to unknown people/places/projects
 * - Assumed shared knowledge that we don't have
 */
function analyzeGaps(
  messages: ConversationMessage[],
  qmdContext: QMDContext
): LensResult {
  const items: LensItem[] = [];

  // Gaps identified during QMD query
  for (const gap of qmdContext.gaps) {
    items.push({
      content: `Unknown: "${gap.entity}"`,
      confidence: 0.6,
      suggestedQuestion: gap.suggestedQuestion,
    });
  }

  // Look for new potential gaps in current messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const message of userMessages) {
    const gapItems = detectPotentialGaps(message.content);
    
    // Filter out gaps we already know about
    const knownEntities = new Set(qmdContext.gaps.map(g => g.entity.toLowerCase()));
    const newGaps = gapItems.filter(
      item => !knownEntities.has(item.content.toLowerCase())
    );
    
    items.push(...newGaps);
  }

  return {
    lens: "gap",
    found: items.length > 0,
    items,
  };
}

/**
 * Detect potential knowledge gaps in a message.
 */
function detectPotentialGaps(content: string): LensItem[] {
  const items: LensItem[] = [];

  // References with "the" (implies shared knowledge)
  const thePattern = /the\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  let match;
  while ((match = thePattern.exec(content)) !== null) {
    items.push({
      content: match[1],
      confidence: 0.5,
      suggestedQuestion: `What's ${match[1]}?`,
    });
  }

  // Pronouns without clear antecedent
  const pronounPatterns = [
    /\b(?:he|she|they)\s+(?:said|told|asked|wants?|thinks?)/i,
  ];
  for (const pattern of pronounPatterns) {
    if (pattern.test(content)) {
      items.push({
        content: "Unclear pronoun reference",
        confidence: 0.4,
        suggestedQuestion: "Who are you referring to?",
      });
      break;
    }
  }

  return items;
}

// =============================================================================
// Score Calculation
// =============================================================================

/**
 * Calculate overall significance score from lens results.
 */
export function calculateSignificanceScore(lenses: LensResult[]): number {
  let totalScore = 0;
  let totalWeight = 0;

  const weights: Record<SignificanceLens, number> = {
    significance: 1.0,
    pattern: 0.7,
    contradiction: 0.8,
    gap: 0.3, // Gaps are awareness, not significance
  };

  for (const lens of lenses) {
    if (!lens.found) continue;

    const weight = weights[lens.lens];
    const itemScore = lens.items.reduce((sum, item) => sum + item.confidence, 0);
    const normalizedScore = Math.min(1, itemScore / lens.items.length);

    totalScore += normalizedScore * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Determine if lens results warrant document updates.
 */
export function shouldUpdateDocuments(
  lenses: LensResult[],
  score: number
): boolean {
  // High confidence items always warrant update
  const hasHighConfidence = lenses.some(
    lens => lens.items.some(item => item.confidence >= 0.8)
  );
  if (hasHighConfidence) return true;

  // Medium score with multiple items
  const totalItems = lenses.reduce((sum, l) => sum + l.items.length, 0);
  if (score >= 0.5 && totalItems >= 3) return true;

  // Explicit corrections always update
  const hasCorrection = lenses.find(l => l.lens === "contradiction")
    ?.items.some(i => i.content.includes("correction"));
  if (hasCorrection) return true;

  return false;
}
