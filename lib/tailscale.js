"use strict";

const os = require("node:os");

/**
 * Parse the JSON produced by `tailscale status --json`.
 *
 * @param {string} text JSON response
 * @returns {{connected: boolean, backendState: string, tailscaleIPs: string, dnsName: string, tailnet: string, peersOnline: number}} normalized status
 */
function parseStatus(text) {
  const status = JSON.parse(text);
  const self = status.Self || {};
  return {
    connected: status.BackendState === "Running" && self.Online !== false,
    backendState: String(status.BackendState || "Unknown"),
    tailscaleIPs: Array.isArray(self.TailscaleIPs)
      ? self.TailscaleIPs.join(", ")
      : "",
    dnsName: String(self.DNSName || "").replace(/\.$/, ""),
    tailnet: String(status.CurrentTailnet?.Name || status.MagicDNSSuffix || ""),
    peersOnline: Object.values(status.Peer || {}).filter(
      (peer) => peer && peer.Online,
    ).length,
  };
}

/**
 * Build arguments for the Tailscale up command.
 *
 * @param {{authKey?: string, hostname?: string, acceptRoutes?: boolean, acceptDns?: boolean, advertiseRoutes?: string, exitNode?: string}} config adapter configuration
 * @returns {string[]} command arguments
 */
function upArguments(config) {
  const args = ["up"];
  if (config.authKey) {
    args.push(`--auth-key=${config.authKey}`);
  }
  if (config.hostname) {
    args.push(`--hostname=${config.hostname}`);
  }
  args.push(`--accept-routes=${config.acceptRoutes ? "true" : "false"}`);
  args.push(`--accept-dns=${config.acceptDns !== false ? "true" : "false"}`);
  if (config.advertiseRoutes) {
    args.push(`--advertise-routes=${config.advertiseRoutes}`);
  }
  if (config.exitNode) {
    args.push(`--exit-node=${config.exitNode}`);
  }
  return args;
}

/**
 * Select the native installation mechanism.
 *
 * @param {NodeJS.Platform|string} platform operating system
 * @returns {{kind?: string, description?: string, command?: string, args?: string[]}} installation plan
 */
function installPlan(platform = os.platform()) {
  if (platform === "linux") {
    return {
      kind: "linux-script",
      description: "Official installer from https://tailscale.com/install.sh",
    };
  }
  if (platform === "win32") {
    return {
      command: "winget",
      args: [
        "install",
        "--id",
        "Tailscale.Tailscale",
        "--exact",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
    };
  }
  if (platform === "darwin") {
    return { command: "brew", args: ["install", "--cask", "tailscale-app"] };
  }
  throw new Error(`Automatic installation is not supported on ${platform}`);
}

module.exports = { installPlan, parseStatus, upArguments };
