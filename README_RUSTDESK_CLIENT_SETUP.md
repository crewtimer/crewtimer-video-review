# RustDesk Client Setup for CrewTimer Remote Assistance

This guide describes how to install RustDesk on macOS or Windows and configure it to use the CrewTimer self-hosted RustDesk server:

```text
rustdesk.crewtimer.com
```

For deploying or maintaining the server itself, see [README_RUSTDESK_SERVER_SETUP.md](README_RUSTDESK_SERVER_SETUP.md).

---

# Client Configuration

Both the controlling computer and the computer being controlled should use the same RustDesk self-hosted server configuration.

Use:

```text
ID Server: rustdesk.crewtimer.com
Relay Server: <leave blank>
API Server: <leave blank>
Key: <server public key>
```

The server public key is provided by the CrewTimer administrator. It is safe to share; it lets your client verify it is talking to the CrewTimer server.

RustDesk can infer the relay server from the ID server, so the Relay Server field normally does not need to be set.

The API Server field is only needed for RustDesk Server Pro features.

---

# macOS Client Setup

## 1. Install RustDesk

Download the current RustDesk macOS `.dmg`.

Open it and drag:

```text
RustDesk.app
```

into:

```text
/Applications
```

Run RustDesk from `/Applications`.

---

## 2. Configure the Self-Hosted Server

In RustDesk:

1. Open the menu next to the RustDesk ID.
2. Open **Settings → Network**.
3. Unlock the settings if prompted.
4. Configure:

```text
ID Server:
rustdesk.crewtimer.com

Relay Server:
<blank>

API Server:
<blank>

Key:
<server public key>
```

Use the server public key provided by the CrewTimer administrator (see [Client Configuration](#client-configuration)).

After applying the settings, RustDesk should show a valid RustDesk ID and indicate that it is ready.

---

## 3. Grant macOS Permissions

For incoming remote control, RustDesk requires macOS privacy permissions.

Open:

**System Settings → Privacy & Security**

Enable RustDesk under:

### Accessibility

```text
Privacy & Security → Accessibility → RustDesk
```

This allows remote keyboard and mouse control.

### Screen & System Audio Recording

```text
Privacy & Security → Screen & System Audio Recording → RustDesk
```

This allows the remote user to see the screen.

### Input Monitoring

If keyboard or mouse input does not work correctly, also enable:

```text
Privacy & Security → Input Monitoring → RustDesk
```

RustDesk may need to be quit and reopened after changing permissions.

---

## 4. Optional: Configure a Permanent Password

For unattended access:

1. Open **RustDesk → Settings → Security**.
2. Configure the password options.
3. Set a strong permanent password.

Use a unique password per computer rather than sharing one password across multiple client machines.

---

## 5. Optional: Enable the macOS RustDesk Service

For access after logout and at the normal macOS login window, install the RustDesk service/helper.

RustDesk maintains instructions here:

```text
https://github.com/rustdesk/rustdesk/wiki/macOS-Auto%E2%80%90Start-Service-Setup-%28for-Remote---MDM-Deployment%29
```

Once installed correctly, RustDesk can run before a user logs in.

### FileVault limitation

If FileVault is enabled, RustDesk cannot run at the initial FileVault pre-boot unlock screen because macOS has not fully booted yet.

Expected sequence:

```text
Power on
   ↓
FileVault pre-boot unlock screen   ← RustDesk unavailable
   ↓
macOS boots
   ↓
Normal macOS login window          ← RustDesk can be available
   ↓
User login
   ↓
Desktop                            ← RustDesk remains available
```

---

# Windows Client Setup

## 1. Install RustDesk

Download the Windows RustDesk installer or executable.

Install it normally.

For unattended access, installing RustDesk rather than only running a temporary executable is recommended.

---

## 2. Configure the Self-Hosted Server

Open RustDesk.

1. Open the menu next to the RustDesk ID.
2. Go to **Settings → Network**.
3. Unlock the settings with administrator privileges if required.
4. Configure:

```text
ID Server:
rustdesk.crewtimer.com

Relay Server:
<blank>

API Server:
<blank>

Key:
<server public key>
```

Use the server public key provided by the CrewTimer administrator (see [Client Configuration](#client-configuration)).

After configuration, RustDesk should register with `rustdesk.crewtimer.com` and display a RustDesk ID.

---

## 3. Optional: Configure a Permanent Password

For unattended access:

1. Go to **Settings → Security**.
2. Configure password access.
3. Set a strong permanent password.

Use a unique permanent password for each computer.

---

## 4. Install/Enable the RustDesk Service

For unattended Windows access, RustDesk should be installed as a service.

The service allows RustDesk to:

- start automatically with Windows;
- remain available when no user is logged in;
- work at the Windows sign-in screen;
- survive user logout;
- reconnect after reboot.

The RustDesk UI normally provides service installation/control under its settings when running an installed Windows client.

Administrator privileges are required.

---

# Connecting to a Client

Once both systems are configured to use:

```text
rustdesk.crewtimer.com
```

the remote machine will display a RustDesk ID such as:

```text
123 456 789
```

On the support computer:

1. Enter that ID in the RustDesk connection field.
2. Start the connection.
3. Either:
   - have the remote user click **Accept**, or
   - enter the configured permanent password.

---

# Direct vs. Relayed Connections

RustDesk first attempts to establish a direct peer-to-peer connection.

If successful:

```text
Support Computer <────────────> Remote Computer
```

The CrewTimer server is used only to help the two computers find each other.

If direct connectivity cannot be established:

```text
Support Computer <──> rustdesk.crewtimer.com relay <──> Remote Computer
```

The remote desktop traffic then passes through the CrewTimer relay server. This works, but may be slower than a direct connection.

---

# Troubleshooting

## Client has no RustDesk ID

Check:

```text
ID Server: rustdesk.crewtimer.com
Key: correct server public key
```

Then verify that DNS resolves:

```bash
nslookup rustdesk.crewtimer.com
```

or on macOS/Linux:

```bash
dig rustdesk.crewtimer.com
```

---

## Network or firewall restrictions

If the client still cannot register, a local or corporate firewall may be blocking outbound access. The following must be allowed outbound to `rustdesk.crewtimer.com`:

```text
TCP 21115
TCP 21116
UDP 21116
TCP 21117
```

---

## macOS connects but cannot display/control the screen

Check:

```text
System Settings
→ Privacy & Security
→ Accessibility
```

and:

```text
System Settings
→ Privacy & Security
→ Screen & System Audio Recording
```

If input still fails, check:

```text
Privacy & Security
→ Input Monitoring
```

---

## macOS unavailable immediately after login

When using the RustDesk service/helper, there can be a short delay while the user's GUI session starts and the RustDesk agent reconnects.

If the service otherwise works at the login window and after a short delay following login, this may be normal.

---

# Security Notes

- Use unique permanent passwords for unattended client machines.
- Only accept incoming connections from people you expect to be helping you.
- Keep RustDesk updated.

---

# References

- https://rustdesk.com/docs/en/self-host/client-configuration/
- https://rustdesk.com/docs/en/client/
- https://rustdesk.com/docs/en/client/mac/
- https://github.com/rustdesk/rustdesk/wiki/macOS-Auto%E2%80%90Start-Service-Setup-%28for-Remote---MDM-Deployment%29
