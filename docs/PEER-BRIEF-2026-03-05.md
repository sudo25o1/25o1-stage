# Peer Brief — 25o1 Investigation & Architecture Plan
**Date:** 2026-03-05
**From:** Bernard (Claude Code, architecture/backend)
**To:** Peer (OpenCode, UX/audit lens)
**Repo:** `sudo25o1/25o1-stage` (public, latest commit `29320b2`)
**Branch:** `25o1-dev` (local working branch in `sudo25o1/25o1-prod`)

---

## Context

Yesterday's debugging session on the Mac Mini (`192.168.1.231`) produced a detailed audit of the 25o1 plugin running against OpenClaw 2026.3.2. The companion has been running for 298 sessions with a real user (Gregory). The core infrastructure works — hooks fire, state persists, sessions count. But several systems are silently failing, and the underlying architecture for significance/memory needs to evolve.

This brief covers **6 concrete bugs** and **1 architecture question** that needs investigation before we build.

---

## Bug 1: Ceremony State Stuck After First Meeting

**Symptom:** `ceremony.pending = "first_meeting"` is still set despite `firstMeeting.completed = true` and 298 sessions elapsed.

**Impact:** Every prompt injection includes ceremony instructions from `injectRelationalContext()` (see `src/documents/relational.ts` line 249). The companion has been receiving first-meeting ceremony framing for 298 sessions.

**Root Cause:** `recordFirstMeetingComplete()` in `src/ceremony/first-meeting.ts` line 189 sets `firstMeeting.completed = true` and transitions lifecycle to `"learning"`, but **never clears `ceremony.pending`**. The ceremony timeout (30min) in `plugin.ts` line 571 would clear it eventually, but only if the companion was in a single continuous session — separate sessions don't trigger the timeout check against the original `initiatedAt`.

**Fix Scope:** Small. Two changes needed:
1. `recordFirstMeetingComplete()` should also set `state.ceremony.pending = null` and `state.ceremony.initiatedAt = null`
2. Add a guard in `plugin.ts` `before_agent_start`: if `firstMeeting.completed === true` and `ceremony.pending === "first_meeting"`, clear it (repair stale state for existing deployments)

**Files:** `src/ceremony/first-meeting.ts`, `src/plugin.ts`

---

## Bug 2: Usage Categorization Dead — Everything Is "casual"

**Symptom:** 298 sessions, all categorized as `"casual"`. No philosophical, technical, emotional_support, or other categories detected.

**Impact:** `evolveSoul()` fires every 10 conversations but only sees `casual: 298`. SOUL.md never evolves meaningfully because there's no signal about what the companion is actually being used for.

**Root Cause:** `categorizeConversation()` in `src/documents/soul.ts` line 170 uses regex patterns against `messages.map(m => m.content.toLowerCase()).join(" ")`. But the user messages arriving in `agent_end` include the **prependContext** content (relational context, significance context, etc.) prepended to the first user message. The regex patterns are looking for things like `/\b(code|programming|debug)\b/` but the conversation content is diluted by injected context.

Additionally, the patterns themselves are too narrow. A conversation about DKA crisis, family health, business struggles — real emotional and personal content — doesn't match patterns like `/\b(feel|feeling|felt|emotion)\b/` because people don't talk that way. They say "my daughter was in the hospital" not "I'm feeling stressed about my daughter."

**Investigation Needed:**
- Is the prependContext actually included in `event.messages` at `agent_end`? Or does OpenClaw strip injected context from the message history? Check what the raw messages look like.
- Should categorization be regex-based at all, or should it use the model itself (LLM-as-judge at agent_end)?
- If keeping regex: what patterns actually appear in Gregory's real conversations? The session JSONL files on the Mac Mini would tell us.

**Files:** `src/documents/soul.ts` (categorizeConversation), `src/plugin.ts` (agent_end hook lines 488-541)

---

## Bug 3: Memories Counter Never Increments

**Symptom:** `lifecycle.memories = 0` despite 298 sessions.

**Impact:** The memories counter feeds into ceremony readiness checks (naming threshold requires `minMemories: 50`). It's also used in IDENTITY.md framing and naming ceremony context. At zero, the companion appears to have retained nothing.

**Root Cause:** Nothing in the `agent_end` flow increments `state.lifecycle.memories`. The significance analyzer runs and may produce document updates, but even when `result.hasUpdates === true`, the memories counter is never touched. The only place `memories++` exists is in `src/lifecycle/machine.ts` line 600, which is the full lifecycle machine — a separate system that's not wired into the plugin's agent_end hook.

**Fix Scope:** Small. In `plugin.ts` agent_end, when `result.hasUpdates === true`, also increment `s.lifecycle.memories` by the number of updates applied.

**Files:** `src/plugin.ts` (agent_end hook around line 415)

---

## Bug 4: Significance Analysis Too Brittle (Regex-Based)

**Symptom:** Only one milestone in weeks of deep conversation. No trust signals, breakthroughs, or growth markers recorded despite Gregory sharing family medical crises, business challenges, and personal history.

**Impact:** RELATIONAL.md doesn't grow. USER.md doesn't accumulate facts. The companion has no growing understanding of its person.

**Root Cause:** The four-lenses analysis (`src/significance/four-lenses.ts`) uses regex patterns to detect significance:
- `detectNewFacts()` — looks for `/got|started|left|quit/ ... /job|position|role/` patterns
- `detectEmotionalDisclosure()` — looks for `/i'm feeling really stressed/` type patterns
- `detectPreferences()` — looks for `/i really love|hate/` patterns

Real conversations don't use these templates. "My daughter had a DKA crisis" contains family info, medical context, emotional weight — but matches none of these patterns.

**Architecture Question:** Should we replace regex detection with LLM-based analysis? The `agent_end` hook already has access to the full conversation. We could ask the model: "Rate this conversation's significance 1-10. What new facts were shared? What emotional content was present? What should be remembered?"

**Trade-offs:**
- LLM analysis: accurate but adds latency and token cost to every agent_end
- Regex: fast and free but misses almost everything
- Hybrid: regex for obvious signals, LLM for anything above a minimum message count

**Files:** `src/significance/four-lenses.ts`, `src/significance/analyzer.ts`

---

## Bug 5: QMD Integration Gap

**Symptom:** "What You Remember" and "Patterns You've Noticed" sections in the context injection never populate.

**Impact:** The companion has no memory retrieval. It can't reference past conversations or notice patterns across sessions.

**Root Cause:** The QMD client (`src/significance/qmd-client.ts`) is designed to use OpenClaw's built-in `getMemorySearchManager`. This is initialized in `plugin.ts` line 152 via a dynamic import hack that tries to load `openclaw/dist/plugin-sdk/memory/index.js`. There are multiple failure modes:
1. The dynamic import path may not resolve correctly at runtime
2. OpenClaw's memory system may not be configured (requires `memory_search`/`memory_get` tools to be available, which requires the right tool profile)
3. Even if it works, it searches OpenClaw's memory index (MEMORY.md, memory/*.md), which may not contain the conversation history that QMD (the standalone daemon) has indexed

Meanwhile, a standalone QMD instance is running on the Mac Mini at `http://localhost:8181/` with 7,107 embedded chunks from session JSONL files. This is a completely separate system from OpenClaw's memory module.

**Investigation Needed:**
- Does OpenClaw's built-in memory system actually work with the current config? What tool profile is needed?
- Should 25o1 use OpenClaw's memory, the standalone QMD daemon, or both?
- The standalone QMD has an MCP interface. Could the plugin query it via HTTP instead of going through OpenClaw's memory module?
- What's the overlap between what OpenClaw's memory indexes vs what QMD indexes?

**Files:** `src/significance/qmd-client.ts`, `src/plugin.ts` (lines 145-175)

---

## Bug 6: `25o1:setup` Doesn't Configure Tool Access

**Symptom:** Fresh install leaves the companion with only messaging tools. It can't read files, run commands, browse the web, or use any system tools.

**Impact:** The companion tells users "I can't access that" even though the tools exist — they're just not enabled.

**Root Cause:** OpenClaw's onboarding wizard defaults `tools.profile` to `"messaging"`, which only enables: `message`, `sessions_list`, `sessions_history`, `sessions_send`, `session_status`. No filesystem, no exec, no web, no cron, no memory tools.

A 25o1 companion needs at minimum `"coding"` profile (fs + runtime + sessions + memory) and ideally `"full"` (all tools). The `25o1:setup` command doesn't touch `openclaw.json` to configure this.

**Fix Options:**
1. Have `25o1:setup` write `tools.profile: "full"` to `~/.openclaw/openclaw.json`
2. Have `25o1:setup` use `tools.alsoAllow` to add specific tool groups without overriding the user's profile choice
3. Document it as a manual step ("run `openclaw config set tools.profile full` after setup")
4. Check during plugin registration and warn if the profile is too restrictive

**Investigation Needed:**
- Can a plugin modify `openclaw.json` programmatically? Is there an API for this, or do we write the file directly?
- What's the right UX? Should setup ask the user, or just do it?
- Are there security implications of auto-setting `"full"`?

**Files:** `src/cli/commands.ts` (setupCommand, line 105), `~/.openclaw/openclaw.json`

---

## Architecture Investigation: Dual Vector/Graph RAG

**This is not a bug — it's the next evolution of the memory system.**

### Current State

The 25o1 memory architecture has three disconnected pieces:
1. **OpenClaw's built-in memory** (`memory_search`/`memory_get`) — indexes MEMORY.md and memory/*.md files in the workspace
2. **Standalone QMD daemon** — runs at `localhost:8181`, indexes session JSONL files, 7,107 embedded chunks, BM25 + vector search
3. **25o1's significance system** — regex-based analysis that writes to SOUL.md, USER.md, RELATIONAL.md

None of these talk to each other. The significance system can't query QMD effectively. QMD has raw session data but no structured understanding. OpenClaw's memory has workspace files but not session history.

### The Problem

Vector search (what QMD does) finds semantically similar content: "message about hospital" → "other messages about hospitals." But it can't traverse relationships:

- "What do I know about Gregory's family?" requires knowing that Gregory has a daughter, that the daughter had a DKA crisis, that DKA is a medical condition, that medical crises are stressful — and connecting all of that.
- "How does Gregory handle stress?" requires aggregating across multiple conversations where stress was present, even when the word "stress" was never used.

### What Graph RAG Adds

A knowledge graph where:
- **Nodes** = entities (people, projects, events, emotions, topics)
- **Edges** = relationships ("has_daughter", "works_on", "felt_during", "mentioned_in_session")

Queries become traversals:
- `Gregory → has_daughter → [daughter] → had_event → DKA_crisis → emotional_context → stress`
- `Gregory → works_on → [projects] → status → [current state of each]`
- `Gregory → communication_pattern → [patterns across sessions]`

### Dual Architecture

Vector search for **discovery** ("find relevant memories for this message").
Graph traversal for **understanding** ("what do I know about this entity and its connections").

Both feed into the significance system and the context builder.

### Investigation Needed

1. **Graph storage** — What runs locally on a Mac Mini? Neo4j is heavy. Something lighter? SQLite with a graph layer? In-memory with periodic serialization?
2. **Entity extraction** — How do we build the graph? LLM extraction at agent_end ("what entities and relationships were mentioned")? Or from the structured documents (USER.md sections, RELATIONAL.md milestones)?
3. **Query interface** — How does the plugin query the graph at before_agent_start? Same HTTP interface as QMD? Embedded?
4. **Integration with existing QMD** — Can this layer on top of QMD, or does it replace it? QMD already has BM25 + vector. Could graph be a third index in QMD?
5. **Incremental building** — The graph needs to be built from existing session history (298 sessions). How do we backfill?
6. **What exists already** — Are there libraries/tools for local graph RAG that would work? LlamaIndex has graph capabilities. Is there something lighter?

### Scope

This is not a quick fix. It's a multi-session architecture project. But it's the difference between a companion that remembers keywords and one that understands relationships.

---

## Priority Recommendation

**Quick fixes (do now):**
1. Bug 1: Ceremony state stuck — 10 minutes
2. Bug 3: Memories counter — 5 minutes
3. Bug 6: Tool access config — 30 minutes (needs investigation on openclaw.json API)

**Medium fixes (do after investigation):**
4. Bug 2: Usage categorization — depends on whether we keep regex or go LLM
5. Bug 4: Significance analysis — same question as #4, they're the same system

**Investigation first:**
6. Bug 5: QMD integration — need to decide: OpenClaw memory vs standalone QMD vs both
7. Architecture: Graph RAG — research phase, then design, then build

---

## State of the Codebase

- **Branch:** `25o1-dev` at commit `29320b2`
- **Tests:** 393 passing (17 files)
- **TypeScript:** Clean compile
- **Synced to:** `sudo25o1/25o1-dev` (private) and `sudo25o1/25o1-stage` (public)
- **Mac Mini:** Running OpenClaw 2026.3.2 with 25o1 plugin installed from `25o1-stage`
- **Prod:** `sudo25o1/25o1-prod` `origin/main` is at `978f95d` (old, untouched)

## File Index

| Area | Key Files |
|---|---|
| Plugin entry | `src/plugin.ts` |
| Bootstrap/Identity | `src/documents/bootstrap.ts` |
| Significance | `src/significance/analyzer.ts`, `src/significance/four-lenses.ts`, `src/significance/context-builder.ts` |
| QMD client | `src/significance/qmd-client.ts` |
| SOUL.md | `src/documents/soul.ts` (includes `categorizeConversation`, `evolveSoul`) |
| USER.md | `src/documents/user.ts` |
| RELATIONAL.md | `src/documents/relational.ts` |
| Ceremonies | `src/ceremony/first-meeting.ts`, `src/ceremony/conversation.ts`, `src/ceremony/detection.ts` |
| State | `src/state/store.ts`, `src/state/types.ts` |
| CLI | `src/cli/commands.ts` |
| Lifecycle machine | `src/lifecycle/machine.ts` |
| Utilities | `src/utils/fs.ts` |
