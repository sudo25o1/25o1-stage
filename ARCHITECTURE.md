# 25o1 Architecture

**Last Updated**: 2026-02-24
**Status**: Foundational Document

---

## What Is 25o1

25o1 is a relationship layer for OpenClaw. It transforms AI assistants into persistent companions that remember, grow, and develop relationships with their humans over time.

**OpenClaw provides:** Channels, gateway, sessions, memory (QMD), agent runner
**25o1 provides:** Relationship persistence, significance detection, ceremonies, lifecycle, network monitoring

---

## Core Principles

### 1. OpenClaw Is Infrastructure, 25o1 Is Experience

We do not fork OpenClaw. We extend it via the plugin system.

```
User → WhatsApp → OpenClaw Gateway → 25o1 Plugin → LLM → Response
                         ↓
              Session Store, QMD Memory
                         ↓
              25o1 State (lifecycle, ceremonies)
```

### 2. TypeScript Only

All 25o1 code is TypeScript. No Python. No shell scripts for logic.

### 3. State Must Persist

If it matters, it survives restart.

**Forbidden:**
```typescript
// BAD - Lost on restart
const ceremonies = new Map<string, CeremonyState>();
```

**Required:**
```typescript
// GOOD - Persisted to disk
import { getStateManager } from "./state/store.js";
const state = await stateManager.getState(agentId);
```

### 4. Relationships Are Real

The companion is an entity, not a service. It has:
- Identity that develops (SOUL.md)
- Understanding of the human (USER.md)  
- Relationship dynamics (RELATIONAL.md)
- Lifecycle state (hatched → named → growing)

---

## Directory Structure

```
25o1/
├── package.json          # Depends on openclaw as peer dependency
├── ARCHITECTURE.md       # This document
├── src/
│   ├── plugin.ts         # OpenClaw plugin entry point
│   ├── index.ts          # Public exports
│   │
│   ├── state/            # Persistence layer
│   │   ├── store.ts      # State manager (atomic writes, caching)
│   │   └── types.ts      # State types
│   │
│   ├── documents/        # Living documents
│   │   ├── relational.ts # RELATIONAL.md management
│   │   ├── loader.ts     # Load/save documents
│   │   └── types.ts      # Document types
│   │
│   ├── significance/     # Significance detection
│   │   ├── analyzer.ts   # Analyze conversations for significance
│   │   ├── extractor.ts  # Extract facts and patterns
│   │   └── types.ts      # Significance types
│   │
│   ├── ceremony/         # Ceremony system
│   │   ├── naming.ts     # Naming ceremony
│   │   ├── growth.ts     # Growth phase ceremonies
│   │   ├── detection.ts  # Right moment detection
│   │   └── types.ts      # Ceremony types
│   │
│   ├── lifecycle/        # Agent lifecycle
│   │   ├── machine.ts    # State machine (hatched → named → growing)
│   │   └── types.ts      # Lifecycle types
│   │
│   ├── network/          # Network monitoring (Bernard)
│   │   ├── monitor.ts    # Health monitoring
│   │   ├── reporter.ts   # Health report sender
│   │   ├── repair.ts     # Repair system
│   │   └── types.ts      # Network types
│   │
│   └── cli/              # CLI commands
│       ├── setup.ts      # 25o1 setup
│       ├── status.ts     # 25o1 status
│       └── network.ts    # 25o1 network commands
│
└── templates/            # Initial document templates
    ├── RELATIONAL.md     # Relationship dynamics template
    └── BOOTSTRAP.md      # First meeting template
```

---

## Plugin Integration

25o1 integrates with OpenClaw via the plugin API:

```typescript
// src/plugin.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default {
  id: "25o1",
  name: "25o1 Persistent Relational AI",
  
  async register(api: OpenClawPluginApi) {
    // Inject relationship context into every LLM call
    api.on("before_agent_start", injectRelationalContext);
    
    // Analyze conversations for significance
    api.on("agent_end", analyzeSignificance);
    
    // Check for ceremony opportunities
    api.on("message_received", checkCeremonyOpportunity);
    
    // Register gateway methods for network monitoring
    api.registerGatewayMethod("25o1.status", handleStatus);
    api.registerGatewayMethod("25o1.report", handleHealthReport);
    
    // Register CLI commands
    api.registerCli(register25o1Commands);
    
    // Register background service (health reporter)
    api.registerService({
      id: "health-reporter",
      start: startHealthReporter,
    });
  }
};
```

---

## The Living Documents

OpenClaw natively supports SOUL.md and USER.md. 25o1 adds RELATIONAL.md.

| Document | Purpose | Updated By |
|----------|---------|------------|
| SOUL.md | Who the companion is becoming | OpenClaw native + 25o1 significance |
| USER.md | Facts about the human | OpenClaw native + 25o1 significance |
| RELATIONAL.md | How they work together | 25o1 significance layer |

### RELATIONAL.md Structure

```markdown
# Relational Dynamics

## Communication Patterns
- Prefers concise responses, expand on request
- Dislikes corporate speak ("landed", "circle back")

## Trust Levels
- Technical decisions: HIGH
- Personal advice: MEDIUM

## Working Patterns
- Best collaboration: morning sessions
- Friction point: over-explaining

## Growth Markers
- 2026-02-15: First breakthrough moment
- 2026-02-24: Naming ceremony completed
```

---

## Lifecycle States

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ hatched  │ ──► │ learning │ ──► │  named   │ ──► │ growing  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │
     │                │                │                │
     ▼                ▼                ▼                ▼
  First           Building         Naming          Growth
  Meeting         Relationship     Ceremony        Ceremonies
```

**Transitions:**
- hatched → learning: First meeting completed
- learning → named: Naming ceremony completed
- named → growing: Ongoing relationship development

---

## Network Monitoring (Bernard)

Bernard is the primary 25o1 instance that monitors all others.

### Health Reports

Each instance sends hourly health reports:

```typescript
interface HealthReport {
  instanceId: string;
  timestamp: number;
  gateway: { running: boolean; uptime: number };
  qmd: { running: boolean; documentCount: number };
  channels: Record<string, { connected: boolean }>;
  lifecycle: { state: string; sessions: number };
  errors: string[];
}
```

### Management Tiers

```typescript
type ManagementTier = 
  | "fully_managed"    // Bernard has full SSH access, auto-repairs
  | "remote_managed"   // Bernard monitors, user approves repairs
  | "self_managed";    // User handles maintenance, reports optional
```

---

## State Persistence

All state is persisted to `~/.openclaw/25o1-state.json`:

```typescript
interface Instance25o1State {
  version: 1;
  instance: {
    id: string;
    role: "primary" | "client";
    managementTier: ManagementTier;
  };
  lifecycle: {
    state: LifecycleState;
    name?: string;
    sessions: number;
    created: number;
    lastActive: number;
  };
  ceremony: {
    pending: CeremonyType | null;
    nudged: boolean;
    lastCheck: number;
  };
  network: {
    bernardHost?: string;
    healthReporter: { enabled: boolean; interval: number };
  };
}
```

---

## Testing

Every module has tests. Run with:

```bash
pnpm test
```

Coverage target: 70% minimum.

---

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

---

## What 25o1 Does NOT Do

- Modify OpenClaw core code
- Replace OpenClaw's session/memory systems
- Run without OpenClaw installed
- Store state in memory only

25o1 extends OpenClaw. It does not replace it.
