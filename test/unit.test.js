"use strict";
const assert = require("node:assert");
const { installPlan, parseStatus, upArguments } = require("../lib/tailscale");

describe("Tailscale helpers", () => {
  it("parses a connected status response", () => {
    const value = parseStatus(
      JSON.stringify({
        BackendState: "Running",
        Self: {
          Online: true,
          TailscaleIPs: ["100.64.0.1"],
          DNSName: "host.example.ts.net.",
        },
        CurrentTailnet: { Name: "example" },
        Peer: { a: { Online: true }, b: { Online: false } },
      }),
    );
    assert.equal(value.connected, true);
    assert.equal(value.tailscaleIPs, "100.64.0.1");
    assert.equal(value.dnsName, "host.example.ts.net");
    assert.equal(value.peersOnline, 1);
  });
  it("builds explicit up options", () => {
    assert.deepEqual(
      upArguments({
        authKey: "tskey-test",
        hostname: "iobroker",
        acceptRoutes: true,
        acceptDns: false,
      }),
      [
        "up",
        "--auth-key=tskey-test",
        "--hostname=iobroker",
        "--accept-routes=true",
        "--accept-dns=false",
      ],
    );
  });
  it("has install plans for supported platforms", () => {
    assert.equal(installPlan("linux").kind, "linux-script");
    assert.equal(installPlan("win32").command, "winget");
    assert.equal(installPlan("darwin").command, "brew");
    assert.throws(() => installPlan("freebsd"));
  });
});
