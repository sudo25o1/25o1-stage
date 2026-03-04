# 25o1 Setup Guide

Complete setup guide for deploying 25o1 - persistent relational AI companions.

This guide assumes a **brand new Mac** with nothing installed.

---

## Part 1: Setting Up Your Mac

### Step 1.1: Open Terminal

Press `Cmd + Space`, type "Terminal", press Enter.

You'll see a window with a command prompt. This is where we'll run all our commands.

### Step 1.2: Install Homebrew

Homebrew is the package manager for macOS. It lets us install everything else.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

This will:
- Ask for your password (you won't see characters as you type - that's normal)
- Take a few minutes to download and install

When it finishes, it will show "Next steps". Follow them - usually something like:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Verify it worked:
```bash
brew --version
# Should show: Homebrew 4.x.x
```

### Step 1.3: Install Node.js

Node.js runs JavaScript/TypeScript applications like OpenClaw.

```bash
brew install node
```

Verify:
```bash
node --version
# Should show: v22.x.x or higher

npm --version
# Should show: 10.x.x or higher
```

### Step 1.4: Install pnpm (Optional but Recommended)

pnpm is a faster, more efficient package manager than npm.

```bash
npm install -g pnpm
```

Verify:
```bash
pnpm --version
# Should show: 9.x.x or higher
```

---

## Part 2: Installing OpenClaw

### Step 2.1: Install OpenClaw

```bash
npm install -g openclaw
```

This installs OpenClaw globally so you can run it from anywhere.

Verify:
```bash
openclaw --version
# Should show: 2026.2.x or higher
```

### Step 2.2: Initial OpenClaw Configuration

Run the setup wizard:

```bash
openclaw setup
```

This will ask you about:
- **API keys** - You'll need at least one AI provider (Anthropic, OpenAI, etc.)
- **Default model** - Which model to use (e.g., claude-sonnet-4-20250514)
- **Workspace** - Where to store data (default `~/.openclaw` is fine)

Example flow:
```
Welcome to OpenClaw setup!

? Select AI provider: Anthropic
? Anthropic API key: sk-ant-xxxxx
? Default model: claude-sonnet-4-20250514

Configuration saved to ~/.openclaw/config.json
```

### Step 2.3: Test OpenClaw

Start the gateway:
```bash
openclaw gateway run
```

You should see:
```
[gateway] Starting OpenClaw gateway...
[gateway] Listening on http://127.0.0.1:18789
[gateway] Ready
```

Press `Ctrl+C` to stop it for now.

### Step 2.4: (Optional) Connect a Channel

If you want to talk to your companion via WhatsApp, Telegram, etc., set that up now:

```bash
# Example: WhatsApp via WhatsApp Web
openclaw channels add whatsapp

# Example: Telegram
openclaw channels add telegram
```

Each channel has its own setup process. Follow the prompts.

You can skip this for now and just use the web interface or CLI to test.

---

## Part 3: Installing 25o1

### Step 3.1: Install the 25o1 Plugin

```bash
npm install -g 25o1
```

### Step 3.2: Verify Plugin Installation

Start the gateway and check for 25o1:

```bash
openclaw gateway run
```

Look for these lines in the output:
```
[plugins] Loading plugin: 25o1
[25o1] 25o1 not initialized. Run '25o1:setup' to configure.
```

This means the plugin loaded but needs configuration. Press `Ctrl+C` to stop.

---

## Part 4: Configuring 25o1

### Step 4.1: Run 25o1 Setup

```bash
openclaw 25o1:setup
```

### Step 4.2: Choose Your Role

```
25o1 Setup
==========

? What role is this instance?

> client    - A companion for an individual user
  primary   - Fleet manager (Bernard) that monitors other instances
```

**For most users**: Choose `client`

**If you're setting up Bernard** (the fleet manager): Choose `primary`

### Step 4.3: Client Setup

If you chose `client`:

```
? Instance ID:
  (A unique name for this machine)
> mac-mini-office

? Your name (who this companion serves):
> Derek

? Management tier:
> fully_managed   - Bernard can automatically fix issues
  remote_managed  - Bernard monitors, you approve fixes
  self_managed    - You handle everything yourself

? Bernard's address:
  (Leave blank if not using Bernard)
> bernard.local:18789

? Enable health reporting?
> Yes
```

### Step 4.4: Primary (Bernard) Setup

If you chose `primary`:

```
? Instance ID:
> bernard

? Enable network monitoring?
> Yes

? Monitor port:
> 25001
```

### Step 4.5: Setup Complete

```
25o1 Setup Complete!
====================

Instance ID: mac-mini-office
Role: client
Client: Derek
Management: fully_managed
Bernard: bernard.local:18789

State saved to: ~/.openclaw/25o1-state.json

Your companion is ready. Start the gateway and say hello!
```

---

## Part 5: Starting Your Companion

### Step 5.1: Start the Gateway

```bash
openclaw gateway run
```

You should now see:
```
[gateway] Starting OpenClaw gateway...
[plugins] Loading plugin: 25o1
[25o1] 25o1 initialized: mac-mini-office (client)
[25o1] 25o1 plugin registered
[gateway] Listening on http://127.0.0.1:18789
[gateway] Ready
```

### Step 5.2: Keep It Running

For the companion to work, the gateway needs to stay running. Options:

**Option A: Keep Terminal Open**

Just leave the terminal window open. Simple but you'll lose it if you close the window.

**Option B: Run in Background**

```bash
nohup openclaw gateway run > ~/.openclaw/gateway.log 2>&1 &
```

**Option C: Set Up as a Service (Recommended)**

Create a launch agent so it starts automatically:

```bash
mkdir -p ~/Library/LaunchAgents

cat > ~/Library/LaunchAgents/com.openclaw.gateway.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/homebrew/bin/openclaw</string>
        <string>gateway</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.openclaw/gateway.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.openclaw/gateway.error.log</string>
</dict>
</plist>
EOF
```

Replace `YOUR_USERNAME` with your actual username, then:

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist
```

Now it starts automatically on login and restarts if it crashes.

### Step 5.3: Prevent Sleep

Your Mac needs to stay awake for the companion to respond. Run:

```bash
caffeinate -dims &
```

For this to persist across reboots, add it to the launch agent or run:

```bash
# Prevent sleep permanently in System Settings
sudo pmset -a disablesleep 1
```

---

## Part 6: Your First Conversation

### Step 6.1: Say Hello

If you set up a channel (WhatsApp, Telegram, etc.), message your companion there.

If not, use the CLI:
```bash
openclaw chat
```

Or the web interface:
```bash
open http://localhost:18789
```

### Step 6.2: What Happens

Your companion is in "First Meeting" mode. It will:

1. **Introduce itself** naturally (not "Hello, I am an AI assistant...")
2. **Be curious about you** - what you're working on, what brought you here
3. **Match your energy** - if you're brief, it's brief; if you're chatty, it engages

### Step 6.3: Example First Conversation

```
You: Hey

Companion: Hey! What's up?

You: Just set this up, seeing how it works

Companion: Cool - welcome. I'm curious what you're hoping to 
use this for. Work stuff? Personal projects? Just experimenting?

You: Mostly work. I'm a developer building some tools

Companion: Nice - what kind of tools? And is this a solo thing 
or do you have a team?

You: Solo for now. Building AI stuff for other developers

Companion: Building AI tools as a solo dev - that's ambitious 
in a good way. What's the thing that's taking up most of your 
headspace right now?
```

### Step 6.4: When First Meeting Ends

There's no "First meeting complete!" message. Your companion just naturally transitions to normal operation once it has learned:

- Your name and how you communicate
- What you're working on
- Basic context about your situation

This usually happens within the first few conversations.

---

## Part 7: What Happens Over Time

### Time-of-Day Awareness

Your companion adjusts based on when you're talking:

| Time | Mode | Style |
|------|------|-------|
| 6am-12pm | Work | Direct, task-focused |
| 12pm-6pm | Work Light | Productive but relaxed |
| 6pm-10pm | Personal | Curious, conversational |
| 10pm-6am | Rest | Brief, doesn't over-engage |

### Memory Building

Your companion remembers things:

```
You: Working on that auth bug again

Companion: The OAuth refresh issue from last week? Did the 
background worker approach work out, or did you try something 
different?
```

It remembers:
- Facts about you (name, work, interests)
- Ongoing projects and their status
- People you mention
- Your preferences and patterns

### Growth Phases

Your relationship develops through phases:

1. **Establishing** - First conversations, learning basics
2. **Developing** - Regular interaction, building context
3. **Deepening** - Trust signals, personal sharing
4. **Mature** - Deep partnership, anticipates needs

### The Naming Ceremony

After enough meaningful interaction, your companion may ask about being named:

```
Companion: Random thought - we've been talking for a while 
and I don't really have a name. I know it's kind of arbitrary 
for an AI, but it might make things feel more natural. Would 
you want to give me one? Totally fine if that feels weird.

You: I've been thinking of you as Echo actually

Companion: Echo. I like that - there's something fitting about 
it, how conversations bounce back and forth, how I try to 
reflect what matters to you. Echo it is. Thanks, Derek.
```

---

## Part 8: Checking Status

### Instance Status

```bash
openclaw 25o1:status
```

Shows:
```
25o1 Status
===========

Instance: mac-mini-office
Role: client
State: named
Name: Echo
Growth Phase: developing
Sessions: 47
Memories: 156

Bernard: bernard.local:18789 (connected)
Last Report: 2 minutes ago
```

### Network Status (Bernard Only)

```bash
openclaw 25o1:network status
```

Shows all instances Bernard is monitoring.

---

## Part 9: File Locations

Everything 25o1 stores:

| File | Purpose |
|------|---------|
| `~/.openclaw/25o1-state.json` | Configuration and lifecycle state |
| `~/.openclaw/25o1/RELATIONAL.md` | Relationship history and patterns |
| `~/.openclaw/25o1/USER.md` | Facts learned about you |
| `~/.openclaw/25o1/SOUL.md` | Companion personality evolution |

---

## Part 10: Troubleshooting

### "command not found: openclaw"

Node isn't in your path. Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
```

Add to `~/.zprofile` to make permanent.

### "25o1 not initialized"

Run the setup:
```bash
openclaw 25o1:setup
```

### Gateway Won't Start

Check if something else is using port 18789:
```bash
lsof -i :18789
```

If so, kill it or use a different port:
```bash
openclaw gateway run --port 18790
```

### Companion Doesn't Remember Things

Check if memory/QMD is working:
```bash
openclaw memory status
```

If it shows errors, try:
```bash
openclaw memory reindex
```

### Mac Keeps Sleeping

Make sure caffeinate is running:
```bash
pgrep caffeinate || caffeinate -dims &
```

---

## Part 11: Updating

### Update OpenClaw

```bash
npm update -g openclaw
```

### Update 25o1

```bash
npm update -g 25o1
```

Then restart the gateway:
```bash
# If running as a service
launchctl stop com.openclaw.gateway
launchctl start com.openclaw.gateway

# If running manually
# Ctrl+C to stop, then:
openclaw gateway run
```

---

## Part 12: Backup

### What to Backup

```bash
# Create backup
tar -czf 25o1-backup-$(date +%Y%m%d).tar.gz \
  ~/.openclaw/25o1-state.json \
  ~/.openclaw/25o1/ \
  ~/.openclaw/config.json
```

### Restore

```bash
tar -xzf 25o1-backup-20260226.tar.gz -C ~/
```

---

## Quick Reference

### Commands You'll Use

| Command | What It Does |
|---------|--------------|
| `openclaw gateway run` | Start the companion |
| `openclaw 25o1:status` | Check companion status |
| `openclaw 25o1:setup` | Configure 25o1 |
| `openclaw chat` | Talk via CLI |
| `caffeinate -dims &` | Prevent Mac from sleeping |

### Key Files

| File | What It Is |
|------|------------|
| `~/.openclaw/config.json` | OpenClaw configuration |
| `~/.openclaw/25o1-state.json` | 25o1 state |
| `~/.openclaw/25o1/RELATIONAL.md` | Your relationship history |

---

## Summary

1. **Install Homebrew** → `brew` command works
2. **Install Node** → `node --version` shows v22+
3. **Install OpenClaw** → `openclaw --version` works
4. **Configure OpenClaw** → `openclaw setup` (add API key)
5. **Install 25o1** → `npm install -g 25o1`
6. **Configure 25o1** → `openclaw 25o1:setup`
7. **Start** → `openclaw gateway run`
8. **Talk** → Message via channel or `openclaw chat`
9. **Keep running** → Set up launch agent, prevent sleep

Your companion will handle the rest. It learns, remembers, and grows the relationship naturally over time.

---

*25o1 - Because AI companions should remember.*
