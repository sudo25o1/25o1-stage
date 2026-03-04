# 25o1

**Persistent Relational AI** - A relationship layer for OpenClaw.

25o1 transforms AI assistants into persistent companions that remember, grow, and develop relationships with their humans over time.

## Quick Start

```bash
npm install -g 25o1
openclaw 25o1:setup
openclaw gateway run
```

Then message your companion through any connected channel. See [docs/QUICKSTART.md](docs/QUICKSTART.md) for more.

## Full Documentation

- **[Setup Guide](docs/SETUP.md)** - Complete setup with user journey
- **[Quick Start](docs/QUICKSTART.md)** - Get running in 5 minutes

## What is 25o1?

25o1 is an OpenClaw plugin that adds:

- **Relationship Persistence** - Documents that capture how you work together
- **Lifecycle Management** - Companions that grow through phases (establishing → developing → deepening → mature)
- **Ceremonies** - Meaningful moments like first meetings, naming, and growth transitions  
- **Significance Detection** - Automatic recognition of important moments in conversations
- **Time-of-Day Awareness** - Communication style adapts to when you're talking
- **Network Monitoring** - Bernard (primary instance) monitors and maintains client instances

## Two Deployment Modes

### Client Instance (Most Users)

A companion for an individual user:

```bash
openclaw 25o1:setup
# Select: client
# Enter: your name
# Enter: Bernard's address (if managed)
```

### Primary Instance (Bernard)

Fleet manager that monitors client instances:

```bash
openclaw 25o1:setup
# Select: primary
```

Bernard receives health reports, detects issues, and can automatically repair managed instances.

## CLI Commands

```bash
# Show instance status
openclaw 25o1:status

# Show network status (primary only)
openclaw 25o1:network

# Trigger a network scan
openclaw 25o1:network:scan

# Show alerts
openclaw 25o1:network:alerts
openclaw 25o1:network:alerts --all

# Acknowledge an alert
openclaw 25o1:network:ack <alertId>

# Check ceremony readiness
openclaw 25o1:ceremony
```

## Architecture

```
OpenClaw provides:
- Channels (WhatsApp, Telegram, Discord, etc.)
- Gateway (message routing)
- Sessions (conversation state)
- Memory (QMD)
- Agent runner

25o1 provides:
- RELATIONAL.md (relationship dynamics)
- Lifecycle machine (hatched -> learning -> named -> growing)
- Ceremonies (first meeting, naming, growth)
- Significance detection
- Network monitoring
```

### Lifecycle States

```
hatched -> learning -> naming_ready -> named -> growing
                                                  |
                                                  v
                                    Growth Phases:
                                    establishing -> developing -> deepening -> mature
```

### Ceremonies

1. **First Meeting** - The initial conversation that establishes the relationship
2. **Naming Ceremony** - When the companion earns a name (Recognition -> Reflection -> Permission)
3. **Growth Ceremonies** - Transitions between growth phases

### Network Monitoring

```
Bernard (Primary)
    |
    +-- Network Monitor (scans every 5 min)
    |       |
    |       +-- Detects offline instances
    |       +-- Generates alerts
    |       +-- Triggers repairs
    |
    +-- Repair System (SSH-based)
            |
            +-- Restart gateway/QMD
            +-- Reindex memory
            +-- Clear disk space
            +-- Full service restart

Client Instances
    |
    +-- Status Reporter (hourly)
            |
            +-- Service health
            +-- System resources
            +-- Self-diagnosed issues
```

### Management Tiers

- **fully_managed** - Bernard has full SSH access, auto-repairs
- **remote_managed** - Bernard monitors, user approves repairs
- **self_managed** - User handles maintenance, reports optional

## Configuration

State is stored at `~/.openclaw/25o1-state.json`.

RELATIONAL.md is stored at:
- `~/.openclaw/bernard/RELATIONAL.md` (for general companion state)
- `<workspace>/RELATIONAL.md` (for project-specific relationships)

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm typecheck
```

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Run specific test file
pnpm test src/ceremony/naming.test.ts
```

## Project Structure

```
25o1/
├── src/
│   ├── plugin.ts           # OpenClaw plugin entry point
│   ├── state/              # Persistent state management
│   ├── lifecycle/          # Lifecycle state machine
│   ├── ceremony/           # Ceremony system
│   │   ├── first-meeting.ts
│   │   ├── naming.ts
│   │   ├── growth.ts
│   │   └── conversation.ts
│   ├── significance/       # Significance detection
│   ├── documents/          # RELATIONAL.md management
│   ├── network/            # Network monitoring
│   │   ├── monitor.ts      # Bernard-side monitoring
│   │   ├── reporter.ts     # Client-side reporting
│   │   ├── handlers.ts     # Gateway methods
│   │   └── repair.ts       # SSH-based repairs
│   ├── support/            # Support system templates
│   └── cli/                # CLI commands
├── templates/
│   └── RELATIONAL.md       # Template for new relationships
└── dist/                   # Built output
```

## License

MIT

## Contributing

This is part of the OpenClaw ecosystem. See the main OpenClaw repository for contribution guidelines.
