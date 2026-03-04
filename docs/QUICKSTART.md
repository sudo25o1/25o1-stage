# 25o1 Quick Start

Get a persistent AI companion running in 5 minutes.

## Prerequisites

- OpenClaw 2026.2.0+ installed and working
- Node.js 22+

## Install

```bash
npm install -g 25o1
```

## Configure

```bash
openclaw 25o1:setup
```

Answer the prompts:
- **Role**: `client` (unless you're setting up Bernard)
- **Instance ID**: Accept default or name it
- **Client name**: Your name
- **Management tier**: `fully_managed` for automatic repairs

## Start

```bash
openclaw gateway run
```

## Talk

Message your OpenClaw instance through any connected channel (WhatsApp, Telegram, etc.).

Your companion will introduce itself naturally. No scripted onboarding - just conversation.

## That's It

Over time, your companion will:
- Remember what you tell it
- Learn your communication style
- Adapt to time of day
- Eventually ask if you want to name it

For the full guide, see [SETUP.md](./SETUP.md).
