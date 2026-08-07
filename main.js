"use strict";

const utils = require("@iobroker/adapter-core");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { installPlan, parseStatus, upArguments } = require("./lib/tailscale");

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitized(value, secret = "") {
  let text = String(value || "");
  if (secret) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/tskey-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          error.details = String(stderr || stdout || "").trim();
          reject(error);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        timeout: 30000,
        headers: { "User-Agent": "ioBroker.tailscale-manager" },
      },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          return download(
            new URL(response.headers.location, url).toString(),
            destination,
          ).then(resolve, reject);
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download returned HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          fs
            .writeFile(destination, Buffer.concat(chunks), { mode: 0o700 })
            .then(resolve, reject),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("Download timeout")));
    request.on("error", reject);
  });
}

class TailscaleManager extends utils.Adapter {
  constructor(options = {}) {
    super({ ...options, name: "tailscale-manager" });
    this.pollTimer = null;
    this.disableTimer = null;
    this.countdownTimer = null;
    this.busy = false;
    this.stopped = false;
    this.on("ready", () => this.onReady());
    this.on("stateChange", (id, state) => this.onStateChange(id, state));
    this.on("unload", (callback) => this.onUnload(callback));
  }

  async onReady() {
    this.stopped = false;
    await this.subscribeStatesAsync("control.*");
    await this.setStateAsync("info.lastError", "", true);
    const defaultMinutes = Math.min(
      Math.max(Number(this.config.defaultDurationMinutes) || 60, 1),
      10080,
    );
    await this.setStateAsync("control.durationMinutes", defaultMinutes, true);
    const enabledUntilState = await this.getStateAsync("info.enabledUntil");
    const enabledUntil = Number(enabledUntilState?.val) || 0;
    if (enabledUntil > Date.now()) {
      this.armTimedDisconnect(enabledUntil);
    } else {
      await this.clearTimedConnection();
    }
    if (this.config.autoInstall && !(await this.isInstalled())) {
      await this.perform("install", () => this.install());
    }
    await this.refresh();
    this.schedulePoll();
  }

  schedulePoll() {
    if (this.stopped) {
      return;
    }
    if (this.pollTimer) {
      this.clearTimeout(this.pollTimer);
    }
    const seconds = Math.min(
      Math.max(Number(this.config.pollInterval) || 15, 5),
      3600,
    );
    this.pollTimer = this.setTimeout(
      () => void this.refresh().finally(() => this.schedulePoll()),
      seconds * 1000,
    );
  }

  async isInstalled() {
    try {
      await run("tailscale", ["version"], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  async isTunAvailable() {
    if (os.platform() !== "linux") {
      return true;
    }
    try {
      await fs.access("/dev/net/tun");
      return true;
    } catch {
      return false;
    }
  }

  async refresh() {
    const installed = await this.isInstalled();
    await this.setStateAsync("info.installed", installed, true);
    const tunAvailable = await this.isTunAvailable();
    await this.setStateAsync("info.tunAvailable", tunAvailable, true);
    await this.setStateAsync(
      "info.setupHint",
      tunAvailable
        ? ""
        : "Linux requires /dev/net/tun. For a Proxmox LXC, enable the TUN device in the container configuration on the Proxmox host.",
      true,
    );
    if (!installed) {
      await this.setDisconnected("Tailscale is not installed");
      return;
    }
    if (!tunAvailable) {
      await this.setDisconnected(
        "Tailscale is installed, but /dev/net/tun is missing. Enable TUN in the Proxmox LXC configuration and restart the container.",
      );
      await this.setStateAsync("info.backendState", "MissingTUN", true);
      return;
    }
    try {
      const version = await run("tailscale", ["version"], { timeout: 10000 });
      await this.setStateAsync(
        "info.version",
        version.stdout.split(/\r?\n/)[0].trim(),
        true,
      );
      const result = await run("tailscale", ["status", "--json"], {
        timeout: 15000,
      });
      const status = parseStatus(result.stdout);
      await Promise.all([
        this.setStateAsync("info.connection", status.connected, true),
        this.setStateAsync("control.connected", status.connected, true),
        this.setStateAsync("info.serviceRunning", true, true),
        this.setStateAsync("info.backendState", status.backendState, true),
        this.setStateAsync("info.tailscaleIPs", status.tailscaleIPs, true),
        this.setStateAsync("info.dnsName", status.dnsName, true),
        this.setStateAsync("info.tailnet", status.tailnet, true),
        this.setStateAsync("info.peersOnline", status.peersOnline, true),
        this.setStateAsync("info.lastUpdate", Date.now(), true),
        this.setStateAsync("info.lastError", "", true),
      ]);
    } catch (error) {
      await this.setDisconnected(
        `Status failed: ${message(error)}${error.details ? `: ${error.details}` : ""}`,
      );
    }
  }

  async setDisconnected(error) {
    await Promise.all([
      this.setStateAsync("info.connection", false, true),
      this.setStateAsync("control.connected", false, true),
      this.setStateAsync("info.serviceRunning", false, true),
      this.setStateAsync("info.backendState", "Unavailable", true),
      this.setStateAsync("info.lastError", error, true),
      this.setStateAsync("info.lastUpdate", Date.now(), true),
    ]);
  }

  async connect() {
    if (!(await this.isInstalled())) {
      throw new Error("Tailscale is not installed");
    }
    let keyFile = "";
    const commandConfig = { ...this.config, authKey: "" };
    try {
      if (this.config.authKey) {
        keyFile = path.join(
          os.tmpdir(),
          `iobroker-tailscale-auth-${process.pid}-${randomUUID()}`,
        );
        await fs.writeFile(keyFile, this.config.authKey, { mode: 0o600 });
        commandConfig.authKey = `file:${keyFile}`;
      }
      const args = upArguments(commandConfig);
      await run("tailscale", args, { timeout: 120000 });
    } finally {
      if (keyFile) {
        await fs.rm(keyFile, { force: true });
      }
    }
    await this.refresh();
  }

  async interactiveLogin() {
    if (!(await this.isInstalled())) {
      throw new Error("Tailscale is not installed");
    }
    if (!(await this.isTunAvailable())) {
      throw new Error(
        "/dev/net/tun is missing; interactive login cannot start",
      );
    }
    await this.setStateAsync("info.loginUrl", "", true);
    const args = upArguments({ ...this.config, authKey: "" });
    await new Promise((resolve, reject) => {
      const child = spawn("tailscale", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const collect = (chunk) => {
        output += chunk.toString();
        const match = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (match) {
          void this.setStateAsync("info.loginUrl", match[0], true);
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timeout = this.setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Interactive login timed out after 10 minutes"));
      }, 600000);
      child.on("error", (error) => {
        this.clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        this.clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(output.trim() || `tailscale up exited with code ${code}`),
          );
        }
      });
    });
    await this.refresh();
  }

  async disconnect() {
    if (!(await this.isInstalled())) {
      throw new Error("Tailscale is not installed");
    }
    await run("tailscale", ["down"], { timeout: 30000 });
    await this.clearTimedConnection();
    await this.refresh();
  }

  async logout() {
    if (!(await this.isInstalled())) {
      throw new Error("Tailscale is not installed");
    }
    await run("tailscale", ["logout"], { timeout: 30000 });
    await this.clearTimedConnection();
    await this.setStateAsync("info.loginUrl", "", true);
    await this.refresh();
  }

  formatRemaining(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  async updateRemaining(until) {
    const seconds = Math.max(Math.ceil((until - Date.now()) / 1000), 0);
    await Promise.all([
      this.setStateAsync("info.remainingSeconds", seconds, true),
      this.setStateAsync(
        "info.remainingTime",
        this.formatRemaining(seconds),
        true,
      ),
    ]);
    if (seconds > 0 && !this.stopped) {
      this.countdownTimer = this.setTimeout(
        () => void this.updateRemaining(until),
        1000,
      );
    }
  }

  armTimedDisconnect(until) {
    if (this.disableTimer) {
      this.clearTimeout(this.disableTimer);
    }
    if (this.countdownTimer) {
      this.clearTimeout(this.countdownTimer);
    }
    const delay = Math.max(until - Date.now(), 0);
    this.disableTimer = this.setTimeout(
      () => void this.perform("timed disconnect", () => this.disconnect()),
      delay,
    );
    void this.updateRemaining(until);
  }

  async clearTimedConnection() {
    if (this.disableTimer) {
      this.clearTimeout(this.disableTimer);
    }
    if (this.countdownTimer) {
      this.clearTimeout(this.countdownTimer);
    }
    this.disableTimer = null;
    this.countdownTimer = null;
    await Promise.all([
      this.setStateAsync("info.enabledUntil", 0, true),
      this.setStateAsync("info.remainingSeconds", 0, true),
      this.setStateAsync("info.remainingTime", "00:00:00", true),
    ]);
  }

  async enableTimed() {
    const durationState = await this.getStateAsync("control.durationMinutes");
    const minutes = Math.min(
      Math.max(Number(durationState?.val) || 60, 1),
      10080,
    );
    await this.connect();
    const until = Date.now() + minutes * 60000;
    await this.setStateAsync("info.enabledUntil", until, true);
    this.armTimedDisconnect(until);
  }

  async install() {
    if (await this.isInstalled()) {
      this.log.info("Tailscale is already installed");
      return this.refresh();
    }
    const plan = installPlan();
    if (plan.kind === "linux-script") {
      const installer = path.join(
        os.tmpdir(),
        `tailscale-install-${process.pid}.sh`,
      );
      try {
        await download("https://tailscale.com/install.sh", installer);
        if (process.getuid?.() === 0) {
          await run("/bin/sh", [installer]);
        } else {
          await run("sudo", ["-n", "/bin/sh", installer]);
        }
      } finally {
        await fs.rm(installer, { force: true });
      }
    } else {
      await run(plan.command, plan.args);
    }
    if (!(await this.isInstalled())) {
      throw new Error(
        "Installation finished, but tailscale executable was not found",
      );
    }
    await this.refresh();
  }

  async perform(name, action) {
    if (this.busy || this.stopped) {
      return;
    }
    this.busy = true;
    try {
      await action();
      await this.setStateAsync("info.lastError", "", true);
    } catch (error) {
      const details = error.details
        ? `: ${sanitized(error.details, this.config.authKey)}`
        : "";
      const safeMessage = sanitized(message(error), this.config.authKey);
      this.log.warn(`${name} failed: ${safeMessage}${details}`);
      await this.setStateAsync(
        "info.lastError",
        `${name} failed: ${safeMessage}${details}`,
        true,
      );
    } finally {
      this.busy = false;
    }
  }

  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    const relative = id.slice(this.namespace.length + 1);
    if (relative === "control.connected") {
      void this.perform(state.val ? "connect" : "disconnect", () =>
        state.val ? this.connect() : this.disconnect(),
      );
    } else if (relative === "control.enableTimed" && state.val) {
      void this.perform("timed connect", () => this.enableTimed());
    } else if (relative === "control.install" && state.val) {
      void this.perform("install", () => this.install());
    } else if (relative === "control.loginInteractive" && state.val) {
      void this.perform("interactive login", () => this.interactiveLogin());
    } else if (relative === "control.logout" && state.val) {
      void this.perform("logout", () => this.logout());
    } else if (relative === "control.refresh" && state.val) {
      void this.perform("refresh", () => this.refresh());
    }
  }

  onUnload(callback) {
    this.stopped = true;
    if (this.pollTimer) {
      this.clearTimeout(this.pollTimer);
    }
    if (this.disableTimer) {
      this.clearTimeout(this.disableTimer);
    }
    if (this.countdownTimer) {
      this.clearTimeout(this.countdownTimer);
    }
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options) => new TailscaleManager(options);
} else {
  new TailscaleManager();
}
