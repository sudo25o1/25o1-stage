/**
 * 25o1 Status Reporter
 *
 * Each 25o1 instance runs this to report health to Bernard.
 * Reports are hourly, non-disruptive, and privacy-preserving.
 */

import { randomBytes } from "node:crypto";
import type {
  StatusReport,
  ServiceStatuses,
  ServiceStatus,
  QmdStatus,
  AgentServiceStatus,
  ChannelStatus,
  CronJobStatus,
  SystemStatus,
  ResourceUsage,
  NetworkStatus,
  ActivityMetrics,
  Issue,
  IssueComponent,
  MonitorConfig,
} from "./types.js";
import { DEFAULT_MONITOR_CONFIG } from "./types.js";
import { getStateManager } from "../state/store.js";

// =============================================================================
// Status Reporter
// =============================================================================

export class StatusReporter {
  private instanceId: string;
  private clientId: string;
  private config: MonitorConfig;
  private reportTimer?: NodeJS.Timeout;

  constructor(instanceId: string, clientId: string, config: Partial<MonitorConfig> = {}) {
    this.instanceId = instanceId;
    this.clientId = clientId;
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Report Generation
  // ---------------------------------------------------------------------------

  async generateReport(): Promise<StatusReport> {
    const [services, system, activity] = await Promise.all([
      this.checkServices(),
      this.checkSystem(),
      this.getActivityMetrics(),
    ]);

    const issues = await this.detectIssues(services, system, activity);

    const health = this.assessOverallHealth(services, system, issues);

    return {
      instanceId: this.instanceId,
      clientId: this.clientId,
      timestamp: new Date(),
      health,
      services,
      system,
      activity,
      issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Service Checks
  // ---------------------------------------------------------------------------

  private async checkServices(): Promise<ServiceStatuses> {
    const [gateway, qmd, agent, channels, cron] = await Promise.all([
      this.checkGateway(),
      this.checkQmd(),
      this.checkAgent(),
      this.checkChannels(),
      this.checkCronJobs(),
    ]);

    return { gateway, qmd, agent, channels, cron };
  }

  private async checkGateway(): Promise<ServiceStatus> {
    try {
      const pid = await this.getProcessPid("25o1 gateway");
      if (!pid) {
        return { running: false, lastError: "Process not found" };
      }

      // Try to reach the health endpoint
      const response = await this.fetchWithTimeout("http://localhost:18789/health", 5000);

      if (!response.ok) {
        return {
          running: true,
          pid,
          lastError: `Health check failed: ${response.status}`,
        };
      }

      const uptime = await this.getProcessUptime(pid);

      return { running: true, pid, uptime };
    } catch (error) {
      return {
        running: false,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkQmd(): Promise<QmdStatus> {
    try {
      const pid = await this.getProcessPid("qmd");
      if (!pid) {
        return {
          running: false,
          documentCount: 0,
          indexHealthy: false,
          needsReindex: true,
          lastError: "Process not found",
        };
      }

      // Query QMD status
      const response = await this.fetchWithTimeout("http://localhost:3030/status", 5000);

      if (!response.ok) {
        return {
          running: true,
          pid,
          documentCount: 0,
          indexHealthy: false,
          needsReindex: true,
          lastError: `Status check failed: ${response.status}`,
        };
      }

      const status = await response.json() as Record<string, unknown>;
      const uptime = await this.getProcessUptime(pid);

      return {
        running: true,
        pid,
        uptime,
        documentCount: (status.totalDocuments as number) || 0,
        lastSync: status.lastSync ? new Date(status.lastSync as string) : undefined,
        indexHealthy: (status.needsEmbedding as number) === 0,
        needsReindex: (status.needsEmbedding as number) > 0,
      };
    } catch (error) {
      return {
        running: false,
        documentCount: 0,
        indexHealthy: false,
        needsReindex: true,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkAgent(): Promise<AgentServiceStatus> {
    try {
      // Read agent state from state store
      const agentState = await this.readAgentState();

      const state = typeof agentState?.state === "string" ? agentState.state : "unknown";
      const name = typeof agentState?.name === "string" ? agentState.name : undefined;
      const lastActiveRaw = agentState?.lastActive;
      const lastActive =
        typeof lastActiveRaw === "string" || typeof lastActiveRaw === "number"
          ? new Date(lastActiveRaw)
          : new Date(0);

      return {
        state,
        name,
        lastActive,
        memoryHealthy: await this.checkMemoryHealth(),
        relationshipHealth: this.assessRelationshipHealth(agentState),
      };
    } catch {
      return {
        state: "unknown",
        lastActive: new Date(0),
        memoryHealthy: false,
        relationshipHealth: "critical",
      };
    }
  }

  private async checkChannels(): Promise<ChannelStatus[]> {
    try {
      // Query gateway for channel status
      const response = await this.fetchWithTimeout("http://localhost:18789/channels/status", 5000);

      if (!response.ok) {
        return [];
      }

      const channels = await response.json() as Record<string, unknown>[];

      return channels.map((ch: Record<string, unknown>) => ({
        name: ch.name as string,
        connected: ch.connected as boolean,
        lastMessageReceived: ch.lastMessageReceived
          ? new Date(ch.lastMessageReceived as string)
          : undefined,
        lastMessageSent: ch.lastMessageSent ? new Date(ch.lastMessageSent as string) : undefined,
        errorCount24h: (ch.errorCount24h as number) || 0,
        lastError: ch.lastError as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  private async checkCronJobs(): Promise<CronJobStatus[]> {
    try {
      // Query gateway for cron status
      const response = await this.fetchWithTimeout("http://localhost:18789/cron/status", 5000);

      if (!response.ok) {
        return [];
      }

      const jobs = await response.json() as Record<string, unknown>[];

      return jobs.map((job: Record<string, unknown>) => ({
        name: job.name as string,
        scheduled: job.scheduled as boolean,
        lastRun: job.lastRun ? new Date(job.lastRun as string) : undefined,
        lastSuccess: (job.lastSuccess as boolean) ?? true,
        nextRun: job.nextRun ? new Date(job.nextRun as string) : undefined,
        lastError: job.lastError as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // System Checks
  // ---------------------------------------------------------------------------

  private async checkSystem(): Promise<SystemStatus> {
    const [memory, disk, network, macos] = await Promise.all([
      this.checkMemory(),
      this.checkDisk(),
      this.checkNetwork(),
      this.checkMacOS(),
    ]);

    const uptime = await this.getSystemUptime();
    const sleepPrevented = await this.isSleepPrevented();

    return {
      awake: true, // If we're running, we're awake
      sleepPrevented,
      uptime,
      memory,
      disk,
      network,
      macos,
    };
  }

  private async checkMemory(): Promise<ResourceUsage> {
    try {
      const { execSync } = await import("node:child_process");

      // macOS: use vm_stat
      const output = execSync("vm_stat").toString();
      const pageSize = 16384; // Default page size on Apple Silicon

      const freeMatch = output.match(/Pages free:\s+(\d+)/);
      const activeMatch = output.match(/Pages active:\s+(\d+)/);
      const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
      const wiredMatch = output.match(/Pages wired down:\s+(\d+)/);

      const free = parseInt(freeMatch?.[1] || "0") * pageSize;
      const active = parseInt(activeMatch?.[1] || "0") * pageSize;
      const inactive = parseInt(inactiveMatch?.[1] || "0") * pageSize;
      const wired = parseInt(wiredMatch?.[1] || "0") * pageSize;

      const total = free + active + inactive + wired;
      const used = active + wired;
      const percentage = Math.round((used / total) * 100);

      return {
        used,
        total,
        percentage,
        pressure: this.assessPressure(
          percentage,
          this.config.thresholds.memoryWarning,
          this.config.thresholds.memoryCritical,
        ),
      };
    } catch {
      return { used: 0, total: 0, percentage: 0, pressure: "normal" };
    }
  }

  private async checkDisk(): Promise<ResourceUsage> {
    try {
      const { execSync } = await import("node:child_process");

      const output = execSync("df -k /").toString();
      const lines = output.trim().split("\n");
      const parts = lines[1].split(/\s+/);

      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      const percentage = Math.round((used / total) * 100);

      return {
        used,
        total,
        percentage,
        pressure: this.assessPressure(
          percentage,
          this.config.thresholds.diskWarning,
          this.config.thresholds.diskCritical,
        ),
      };
    } catch {
      return { used: 0, total: 0, percentage: 0, pressure: "normal" };
    }
  }

  private async checkNetwork(): Promise<NetworkStatus> {
    const networkReachable = await this.canReach(this.config.networkEndpoint);
    const networkLatency = networkReachable
      ? await this.measureLatency(this.config.networkEndpoint)
      : undefined;
    const internetReachable = await this.canReach("https://1.1.1.1");
    const localIp = await this.getLocalIp();

    return {
      networkReachable,
      networkLatency,
      internetReachable,
      localIp,
    };
  }

  private async checkMacOS(): Promise<SystemStatus["macos"]> {
    try {
      const { execSync } = await import("node:child_process");

      // Power source
      const pmOutput = execSync("pmset -g batt").toString();
      const powerSource = pmOutput.includes("AC Power") ? "ac" : "battery";
      const batteryMatch = pmOutput.match(/(\d+)%/);
      const batteryPercent = batteryMatch ? parseInt(batteryMatch[1]) : undefined;

      // Thermal state
      const thermalOutput = execSync("pmset -g therm 2>/dev/null || echo 'nominal'").toString();
      let thermalState: "nominal" | "fair" | "serious" | "critical" = "nominal";
      if (thermalOutput.includes("critical")) {
        thermalState = "critical";
      } else if (thermalOutput.includes("serious")) {
        thermalState = "serious";
      } else if (thermalOutput.includes("fair")) {
        thermalState = "fair";
      }

      return { powerSource, batteryPercent, thermalState };
    } catch {
      return { powerSource: "ac", thermalState: "nominal" };
    }
  }

  // ---------------------------------------------------------------------------
  // Activity Metrics
  // ---------------------------------------------------------------------------

  private async getActivityMetrics(): Promise<ActivityMetrics> {
    try {
      // Query gateway for activity metrics
      const response = await this.fetchWithTimeout("http://localhost:18789/metrics/activity", 5000);

      if (!response.ok) {
        return this.defaultActivityMetrics();
      }

      const metrics = await response.json() as Record<string, unknown>;

      return {
        lastInteraction: new Date((metrics.lastInteraction as string | number) || 0),
        sessions24h: (metrics.sessions24h as number) || 0,
        tokensToday: (metrics.tokensToday as number) || 0,
        tokenLimit: metrics.tokenLimit as number | undefined,
        tokenLimitExceeded: (metrics.tokensToday as number) >= ((metrics.tokenLimit as number) || Infinity),
        errors24h: (metrics.errors24h as number) || 0,
      };
    } catch {
      return this.defaultActivityMetrics();
    }
  }

  private defaultActivityMetrics(): ActivityMetrics {
    return {
      lastInteraction: new Date(0),
      sessions24h: 0,
      tokensToday: 0,
      tokenLimitExceeded: false,
      errors24h: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Issue Detection
  // ---------------------------------------------------------------------------

  private async detectIssues(
    services: ServiceStatuses,
    system: SystemStatus,
    activity: ActivityMetrics,
  ): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Gateway issues
    if (!services.gateway.running) {
      issues.push(
        this.createIssue(
          "gateway",
          "critical",
          "Gateway service not running",
          true,
          "Restart gateway service",
        ),
      );
    }

    // QMD issues
    if (!services.qmd.running) {
      issues.push(
        this.createIssue("qmd", "critical", "QMD service not running", true, "Restart QMD service"),
      );
    } else if (!services.qmd.indexHealthy) {
      issues.push(
        this.createIssue("qmd", "warning", "QMD index needs reindexing", true, "Run qmd reindex"),
      );
    }

    // Channel issues
    for (const channel of services.channels) {
      if (!channel.connected) {
        issues.push(
          this.createIssue(
            "channel",
            "warning",
            `Channel ${channel.name} not connected`,
            true,
            `Restart ${channel.name} channel`,
          ),
        );
      }
    }

    // Cron issues
    for (const job of services.cron) {
      if (!job.lastSuccess && job.lastRun) {
        issues.push(
          this.createIssue(
            "cron",
            "warning",
            `Cron job ${job.name} failed`,
            true,
            `Investigate and restart ${job.name}`,
          ),
        );
      }
    }

    // System issues
    if (!system.sleepPrevented) {
      issues.push(
        this.createIssue(
          "system",
          "warning",
          "Sleep prevention not active - system may sleep",
          true,
          "Enable sleep prevention",
        ),
      );
    }

    if (system.memory.pressure === "critical") {
      issues.push(
        this.createIssue(
          "memory",
          "critical",
          `Memory pressure critical: ${system.memory.percentage}% used`,
          false,
          "Investigate memory usage",
        ),
      );
    } else if (system.memory.pressure === "warning") {
      issues.push(
        this.createIssue(
          "memory",
          "warning",
          `Memory pressure warning: ${system.memory.percentage}% used`,
          false,
        ),
      );
    }

    if (system.disk.pressure === "critical") {
      issues.push(
        this.createIssue(
          "disk",
          "critical",
          `Disk space critical: ${system.disk.percentage}% used`,
          false,
          "Free up disk space",
        ),
      );
    }

    if (!system.network.networkReachable) {
      issues.push(
        this.createIssue(
          "network",
          "critical",
          "Cannot reach Bernard - reports will not be delivered",
          false,
          "Check network connectivity",
        ),
      );
    }

    // Activity issues
    if (activity.tokenLimitExceeded) {
      issues.push(
        this.createIssue(
          "agent",
          "warning",
          "Token limit exceeded",
          false,
          "Notify client about usage",
        ),
      );
    }

    // Agent issues
    if (!services.agent.memoryHealthy) {
      issues.push(
        this.createIssue(
          "agent",
          "critical",
          "Agent memory system unhealthy",
          false,
          "Investigate memory corruption",
        ),
      );
    }

    return issues;
  }

  private createIssue(
    component: IssueComponent,
    severity: "info" | "warning" | "critical",
    description: string,
    canSelfRepair: boolean,
    suggestedFix?: string,
  ): Issue {
    return {
      id: `issue-${randomBytes(4).toString("hex")}`,
      component,
      severity,
      description,
      canSelfRepair,
      suggestedFix,
      detectedAt: new Date(),
      selfRepairAttempted: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Health Assessment
  // ---------------------------------------------------------------------------

  private assessOverallHealth(
    services: ServiceStatuses,
    system: SystemStatus,
    issues: Issue[],
  ): "healthy" | "degraded" | "critical" | "offline" {
    const criticalIssues = issues.filter((i) => i.severity === "critical");
    const warningIssues = issues.filter((i) => i.severity === "warning");

    if (!services.gateway.running || !services.qmd.running) {
      return "critical";
    }

    if (criticalIssues.length > 0) {
      return "critical";
    }

    if (warningIssues.length > 2) {
      return "degraded";
    }

    if (system.memory.pressure === "critical" || system.disk.pressure === "critical") {
      return "critical";
    }

    if (warningIssues.length > 0) {
      return "degraded";
    }

    return "healthy";
  }

  private assessRelationshipHealth(
    agentState: Record<string, unknown> | null,
  ): "healthy" | "needs_attention" | "critical" {
    if (!agentState) {
      return "critical";
    }

    const state = agentState.state as string;
    if (state === "corrupted") {
      return "critical";
    }
    if (state === "repairing") {
      return "needs_attention";
    }

    return "healthy";
  }

  private assessPressure(
    percentage: number,
    warningThreshold: number,
    criticalThreshold: number,
  ): "normal" | "warning" | "critical" {
    if (percentage >= criticalThreshold) {
      return "critical";
    }
    if (percentage >= warningThreshold) {
      return "warning";
    }
    return "normal";
  }

  // ---------------------------------------------------------------------------
  // Report Sending
  // ---------------------------------------------------------------------------

  async sendToNetwork(report: StatusReport): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(this.config.networkEndpoint, 10000, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "25o1.report",
          params: report,
          id: Date.now()
        }),
      });

      return response.ok;
    } catch {
      // Bernard unreachable - will be detected in next report
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  start(): void {
    this.scheduleNextReport();
  }

  stop(): void {
    if (this.reportTimer) {
      clearTimeout(this.reportTimer);
      this.reportTimer = undefined;
    }
  }

  private scheduleNextReport(): void {
    this.reportTimer = setTimeout(async () => {
      try {
        const report = await this.generateReport();
        await this.sendToNetwork(report);
      } catch (error) {
        console.error("Failed to send status report:", error);
      }
      this.scheduleNextReport();
    }, this.config.reportInterval * 1000);
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  private async getProcessPid(processName: string): Promise<number | undefined> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(`pgrep -f "${processName}"`).toString().trim();
      const pid = parseInt(output.split("\n")[0]);
      return isNaN(pid) ? undefined : pid;
    } catch {
      return undefined;
    }
  }

  private async getProcessUptime(pid: number): Promise<number> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(`ps -o etime= -p ${pid}`).toString().trim();
      return this.parseEtime(output);
    } catch {
      return 0;
    }
  }

  private parseEtime(etime: string): number {
    // Format: [[dd-]hh:]mm:ss
    // Parse from right to left: seconds, minutes, hours, days
    const segments = etime.split(/[-:]/);
    const len = segments.length;
    let seconds = parseInt(segments[len - 1]) || 0;
    if (len > 1) {
      seconds += (parseInt(segments[len - 2]) || 0) * 60;
    }
    if (len > 2) {
      seconds += (parseInt(segments[len - 3]) || 0) * 3600;
    }
    if (len > 3) {
      seconds += (parseInt(segments[len - 4]) || 0) * 86400;
    }
    return seconds;
  }

  private async getSystemUptime(): Promise<number> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync("sysctl -n kern.boottime").toString();
      const match = output.match(/sec = (\d+)/);
      if (match) {
        const bootTime = parseInt(match[1]);
        return Math.floor(Date.now() / 1000) - bootTime;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async isSleepPrevented(): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync("pmset -g assertions").toString();
      return output.includes("PreventUserIdleSystemSleep") || output.includes("caffeinate");
    } catch {
      return false;
    }
  }

  private async canReach(url: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(url, 5000, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async measureLatency(url: string): Promise<number> {
    const start = Date.now();
    try {
      await this.fetchWithTimeout(url, 5000, { method: "HEAD" });
      return Date.now() - start;
    } catch {
      return -1;
    }
  }

  private async getLocalIp(): Promise<string | undefined> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync("ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1")
        .toString()
        .trim();
      return output || undefined;
    } catch {
      return undefined;
    }
  }

  private async readAgentState(): Promise<Record<string, unknown> | null> {
    try {
      const stateManager = getStateManager();
      const state = await stateManager.getState();
      if (!state) return null;
      
      return {
        state: state.lifecycle.state,
        name: state.lifecycle.name,
        lastActive: state.lifecycle.lastActive,
      };
    } catch {
      return null;
    }
  }

  private async checkMemoryHealth(): Promise<boolean> {
    try {
      // For now, assume healthy if we can read state
      const stateManager = getStateManager();
      await stateManager.getState();
      return true;
    } catch {
      return false;
    }
  }

  private async fetchWithTimeout(
    url: string,
    timeout: number,
    options?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// =============================================================================
// Public API (keeping existing interface)
// =============================================================================

export interface ReporterConfig {
  bernardHost: string;
  intervalMs: number;
  instanceId: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface ReporterHandle {
  stop: () => void;
}

let reporterInstance: StatusReporter | null = null;

/**
 * Start the health reporter.
 * Reports health to Bernard at the configured interval.
 */
export async function startHealthReporter(config: ReporterConfig): Promise<ReporterHandle> {
  const { bernardHost, intervalMs, instanceId, logger } = config;

  logger.info(`Starting health reporter for ${instanceId}, reporting to ${bernardHost}`);

  // Create status reporter with adapted config
  // Use /rpc endpoint for OpenClaw Gateway methods
  const rpcEndpoint = bernardHost.endsWith('/') ? `${bernardHost}rpc` : `${bernardHost}/rpc`;
  const monitorConfig: Partial<MonitorConfig> = {
    reportInterval: Math.floor(intervalMs / 1000),
    networkEndpoint: rpcEndpoint,
  };

  reporterInstance = new StatusReporter(instanceId, instanceId, monitorConfig);

  // Send initial report
  try {
    const report = await reporterInstance.generateReport();
    const success = await reporterInstance.sendToNetwork(report);
    if (!success) {
      logger.warn("Initial health report failed to send");
    }
  } catch (error) {
    logger.error(`Failed to send initial health report: ${error}`);
  }

  // Start periodic reporting
  reporterInstance.start();

  return {
    stop: () => {
      if (reporterInstance) {
        reporterInstance.stop();
        reporterInstance = null;
        logger.info("Health reporter stopped");
      }
    },
  };
}

/**
 * Stop the health reporter.
 */
export function stopHealthReporter(): void {
  if (reporterInstance) {
    reporterInstance.stop();
    reporterInstance = null;
  }
}