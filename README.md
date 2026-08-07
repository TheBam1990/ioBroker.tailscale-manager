# ioBroker.tailscale-manager

[Deutsch](READMEde.md)

Installs, monitors and controls the Tailscale client on the same host as this
ioBroker adapter instance. It provides permanent and temporary connections,
status information, auth-key provisioning and an official browser login for
identity providers such as GitHub or Google.

> This project is an independent ioBroker adapter and is not affiliated with
> or endorsed by Tailscale Inc.

## Requirements

- ioBroker js-controller 6.0.11 or newer
- ioBroker Admin 7.6.20 or newer
- Node.js 20 or newer
- administrator privileges for the one-time Tailscale system installation
- Linux: `/dev/net/tun` must be available

Automatic installation uses the official Tailscale installer on Linux,
`winget` on Windows and Homebrew on macOS. System installation can only work
when the ioBroker process has the required privileges. The adapter never
modifies sudoers or grants itself administrator rights.

## Authentication methods

### Method A: Tailscale auth key

This is the easiest method for a headless ioBroker server.

1. Open the Tailscale admin console **Keys** page.
2. Select **Generate auth key**.
3. Configure the key. For a permanent server, `Pre-approved` is useful;
   prefer a one-time key unless re-use is required.
4. Copy the key into **Tailscale auth key** in the adapter settings.
5. Optionally set a hostname such as `iobroker-203`.
6. Save the settings and set `control.connected` to `true`.

The auth key is an encrypted and protected ioBroker native setting. It is
never exposed as a state. For command execution, the adapter writes it to a
temporary owner-only file, passes Tailscale a `file:` reference and removes the
file immediately. Error text is additionally redacted.

### Method B: GitHub, Google or another browser identity provider

The adapter never requests or stores GitHub/Google credentials. Authentication
happens on the official Tailscale page in your browser.

1. If this device is already authenticated and you want to change identity,
   trigger `control.logout` once. This removes the device's local Tailscale
   login; it does not delete your GitHub or Google account.
2. Trigger `control.loginInteractive` once.
3. Wait until `info.loginUrl` contains an `https://login.tailscale.com/...`
   address.
4. Open that URL in a browser.
5. Choose the identity provider offered for your tailnet, for example GitHub
   or Google, and complete its login.
6. Check `info.connection`. It becomes `true` when the login succeeds.

The provider choices depend on the identity configuration of the tailnet. The
adapter cannot add a provider or convert one Tailscale account into another.

## Permanent connection

Write `true` or `false` to `control.connected`. The command state is updated
with `ack=true` after each poll, while `info.connection` provides a dedicated
read-only actual status.

## Temporary connection

1. Set `control.durationMinutes` to a value from 1 to 10080.
2. Trigger `control.enableTimed` once.
3. Tailscale connects immediately and disconnects at the deadline.

The Admin setting **Default duration for temporary connection** initializes
`control.durationMinutes` after an adapter start. `info.remainingSeconds` and
`info.remainingTime` count down every second. `info.enabledUntil` persists the
deadline, so an adapter restart does not lose the automatic disconnect.

## Data points

| State | Access | Description |
|---|---|---|
| `control.connected` | read/write | Permanent connection switch with acknowledged feedback |
| `control.durationMinutes` | read/write | Temporary connection duration in minutes |
| `control.enableTimed` | button | Connect now and disconnect after the selected duration |
| `control.install` | button | Attempt to install Tailscale |
| `control.loginInteractive` | button | Start official browser authentication |
| `control.logout` | button | Log this local device out of Tailscale |
| `control.refresh` | button | Refresh status immediately |
| `info.connection` | read | Actual Tailscale connection status |
| `info.installed` | read | Whether the Tailscale executable is installed |
| `info.serviceRunning` | read | Whether the local daemon is responding |
| `info.tunAvailable` | read | Linux TUN device availability |
| `info.backendState` | read | Tailscale backend state, e.g. `Running` or `NeedsLogin` |
| `info.loginUrl` | read | Official interactive login URL |
| `info.tailscaleIPs` | read | Assigned IPv4 and IPv6 addresses |
| `info.dnsName` | read | MagicDNS name |
| `info.tailnet` | read | Tailnet name |
| `info.peersOnline` | read | Number of online peers |
| `info.enabledUntil` | read | Temporary connection deadline |
| `info.remainingSeconds` | read | Remaining temporary connection time in seconds |
| `info.remainingTime` | read | Formatted remaining time (`HH:MM:SS`) |
| `info.lastError` | read | Last adapter or command error |

## Proxmox LXC

Tailscale kernel networking requires `/dev/net/tun`. On a Proxmox host, pass
the device to the container, for example:

```sh
pct set <CTID> --dev0 path=/dev/net/tun
pct reboot <CTID>
```

After restart, verify `/dev/net/tun` inside the container. This is a Proxmox
host permission and cannot be granted by an adapter running inside the
container. The adapter reports the condition through `info.tunAvailable` and
`info.setupHint`.

## Security notes

- Prefer scoped, one-time or pre-approved auth keys.
- Revoke a key immediately if it appears in a log or is otherwise disclosed.
- Configure Tailscale grants/ACLs according to the least-privilege principle.
- `control.logout` affects the device identity and should be protected in
  visualizations and scripts.
- Enabling Tailscale changes network connectivity of the ioBroker host.

## Changelog

### 0.0.1 (2026-08-07)

- Initial test version with installation, encrypted auth-key handling,
  interactive browser login, permanent and timed control, TUN diagnostics and
  connection status.

## License

MIT License

Copyright (c) 2026 TheBam
