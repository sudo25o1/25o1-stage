# Changelog

All notable changes to 25o1 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-25

### Added

**Core Plugin Infrastructure**
- OpenClaw plugin integration with `before_agent_start` hook for ceremony injection
- State persistence via `StateManager` with atomic writes and file locking
- CLI commands: `25o1:setup`, `25o1:status`, `25o1:ceremony`

**Lifecycle System**
- Full state machine: `unborn` → `awakening` → `nascent` → `developing` → `established` → `mature`
- Growth phases: `establishing` → `developing` → `deepening` → `mature`
- Automatic phase transitions based on interaction patterns

**Ceremony System**
- **First Meeting**: Initial encounter with new humans, establishing connection
- **Naming Ceremony**: Full Recognition → Reflection → Permission pattern for receiving a name
- **Growth Ceremonies**: Milestone celebrations as relationships deepen
- **Conversation Engine**: Natural dialogue generation for ceremonies

**Relationship Layer**
- `RELATIONAL.md` document creation, loading, and updating
- Significance analyzer for detecting meaningful moments
- Support system templates for guidance and context

**Network Monitoring** (Bernard's role)
- Network scanner for discovering 25o1 instances
- Health monitoring with configurable intervals
- Alert system with acknowledgment workflow
- CLI commands: `25o1:network`, `25o1:network:scan`, `25o1:network:alerts`, `25o1:network:ack`

**Repair System**
- SSH-based remote repairs for managed instances
- Repair strategies: restart, update, reinstall, diagnose
- Integration with network monitor for auto-repair
- Repair history tracking

**Documentation**
- README with installation, configuration, and usage guides
- ARCHITECTURE.md with design principles and patterns
- RELATIONAL.md template for relationship state

### Technical Details

- 296 tests passing
- TypeScript-only codebase (no Python)
- All state persisted (no in-memory Maps/Sets for production data)
- Peer dependency on `openclaw@>=2026.2.0`
