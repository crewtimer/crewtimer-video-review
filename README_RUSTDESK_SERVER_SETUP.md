# RustDesk Server on Google Compute Engine

This guide describes how to deploy the open-source RustDesk server (`hbbs` + `hbbr`) on a Google Compute Engine VM using Google Cloud's **Standard Network Tier**, and how to configure macOS and Windows clients to use:

```text
rustdesk.crewtimer.com
```

The setup uses Docker Compose on Ubuntu.

---

## 1. Architecture

RustDesk Server OSS consists of two services:

- **hbbs** — RustDesk ID / rendezvous / signaling server
- **hbbr** — relay server used when a direct peer-to-peer connection cannot be established

RustDesk normally attempts a direct connection between the two clients. If NAT/firewall traversal fails, traffic is relayed through `hbbr`.

For a small support deployment, a Google Compute Engine `e2-micro` VM is generally sufficient.

---

## 2. Create the Google Compute Engine VM

In Google Cloud Console:

1. Go to **Compute Engine → VM instances**.
2. Click **Create instance**.
3. Use settings similar to:

   | Setting | Value |
   |---|---|
   | Name | `rustdesk-server` |
   | Region | `us-west1` |
   | Machine type | `e2-micro` |
   | Boot disk | Ubuntu 24.04 LTS |
   | Disk size | 10–20 GB |
   | External IPv4 | Enabled |

4. Open **Advanced options → Networking**.
5. Edit the VM's network interface.
6. Set:

   ```text
   Network Service Tier: Standard
   ```

7. Create the VM.

Google Cloud defaults to Premium Tier unless Standard Tier is explicitly selected.

> If using a static external IPv4 address, the reserved IP must also use the Standard Network Tier.

---

## 3. Reserve a Static External IP

A static IP is recommended so DNS continues pointing at the same server after VM restarts or replacement.

In Google Cloud Console:

1. Go to **VPC network → IP addresses**.
2. Reserve a regional external IPv4 address.
3. Select:
   - Region: same as the VM
   - Network tier: **Standard**
4. Assign it to `rustdesk-server`.

---

## 4. Configure DNS

Create an A record for:

```text
rustdesk.crewtimer.com
```

pointing to the VM's static external IPv4 address.

Example:

```text
rustdesk.crewtimer.com.    A    35.xxx.xxx.xxx
```

No HTTPS certificate is required for normal native RustDesk client connections.

---

## 5. Create Google Cloud Firewall Rules

For the normal RustDesk desktop clients, open:

```text
TCP 21115
TCP 21116
UDP 21116
TCP 21117
```

These ports are used as follows:

| Port | Protocol | Purpose |
|---|---|---|
| 21115 | TCP | NAT type test |
| 21116 | TCP | Connection service / TCP hole punching |
| 21116 | UDP | ID registration and heartbeat |
| 21117 | TCP | Relay service |

Ports `21118` and `21119` are used for RustDesk web clients and can remain closed unless web-client support is specifically needed.

### Suggested GCP firewall rule

In:

**VPC network → Firewall → Create firewall rule**

Use:

```text
Name: rustdesk-server
Direction: Ingress
Action: Allow
Targets: Specified target tags
Target tag: rustdesk
Source IPv4 ranges: 0.0.0.0/0
```

Protocols and ports:

```text
tcp:21115-21117
udp:21116
```

Then add this network tag to the VM:

```text
rustdesk
```

---

## 6. SSH Into the VM

From the Compute Engine VM page, click **SSH**, or connect using `gcloud`.

Update Ubuntu:

```bash
sudo apt update
sudo apt upgrade -y
```

Verify sudo access:

```bash
sudo whoami
```

Expected output:

```text
root
```

If using Google Cloud OS Login and sudo is denied, the account needs the **Compute OS Admin Login** IAM role.

---

## 7. Install Docker

Install Docker using Docker's convenience script:

```bash
wget -qO /tmp/get-docker.sh https://get.docker.com
sudo bash /tmp/get-docker.sh
```

Verify:

```bash
sudo docker --version
sudo docker compose version
```

---

## 8. Create the RustDesk Server Directory

Create a persistent server directory owned by `root`.

Using `root:root` avoids tying the RustDesk installation to a particular Google Cloud OS Login user. This is useful because different administrators may receive different Linux usernames when logging in to the VM.

```bash
sudo mkdir -p /opt/rustdesk
sudo chown root:root /opt/rustdesk
sudo chmod 755 /opt/rustdesk
cd /opt/rustdesk
```

Files under `/opt/rustdesk` should normally remain owned by `root:root`. Use `sudo` when creating or modifying server configuration files.

---

## 9. Create `compose.yml`

Create:

```text
/opt/rustdesk/compose.yml
```

Because `/opt/rustdesk` is owned by `root`, create or edit the file with `sudo`, for example:

```bash
sudo nano /opt/rustdesk/compose.yml
```

Use the following contents:

```yaml
services:
  hbbs:
    container_name: hbbs
    image: rustdesk/rustdesk-server:latest
    command: hbbs
    volumes:
      - ./data:/root
    network_mode: "host"
    depends_on:
      - hbbr
    restart: unless-stopped

  hbbr:
    container_name: hbbr
    image: rustdesk/rustdesk-server:latest
    command: hbbr
    volumes:
      - ./data:/root
    network_mode: "host"
    restart: unless-stopped
```

Start the server:

```bash
cd /opt/rustdesk
sudo docker compose up -d
```

Verify ownership remains system-level rather than tied to a login account:

```bash
sudo chown -R root:root /opt/rustdesk
```

Verify:

```bash
sudo docker ps
```

Both containers should be running:

```text
hbbs
hbbr
```

---

## 10. Check Server Logs

Check `hbbs`:

```bash
sudo docker logs hbbs
```

Check `hbbr`:

```bash
sudo docker logs hbbr
```

To follow logs continuously:

```bash
sudo docker logs -f hbbs
```

or:

```bash
sudo docker logs -f hbbr
```

---

## 11. Get the RustDesk Public Key

On first startup, `hbbs` creates an Ed25519 key pair in the persistent data directory.

Display the public key:

```bash
cat /opt/rustdesk/data/id_ed25519.pub
```

Save this value. Clients need it to securely connect to the self-hosted server.

The private key is:

```text
/opt/rustdesk/data/id_ed25519
```

Do **not** distribute the private key.

Back up the entire directory:

```text
/opt/rustdesk/data/
```

Keeping this directory preserves the server identity if the VM is rebuilt.

---

## 12. Verify Listening Ports

On the VM:

```bash
sudo ss -lntup | grep 211
```

You should normally see listeners corresponding to:

```text
21115/tcp
21116/tcp
21116/udp
21117/tcp
```

---

## 13. Updating the RustDesk Server

To update:

```bash
cd /opt/rustdesk
sudo docker compose pull
sudo docker compose up -d
```

The `./data` directory remains persistent.

To check current containers:

```bash
sudo docker ps
```

---

# Client Configuration

Both the controlling computer and the computer being controlled should use the same RustDesk self-hosted server configuration.

Use:

```text
ID Server: rustdesk.crewtimer.com
Relay Server: <leave blank>
API Server: <leave blank>
Key: <contents of id_ed25519.pub>
```

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

The key is the contents of:

```text
/opt/rustdesk/data/id_ed25519.pub
```

from the server.

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

The public key is the contents of:

```text
/opt/rustdesk/data/id_ed25519.pub
```

from the server.

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

The Google Compute Engine VM is used primarily for ID/rendezvous traffic.

If direct connectivity cannot be established:

```text
Support Computer <──> hbbr on GCE <──> Remote Computer
```

The remote desktop traffic then passes through the Google Compute Engine VM, increasing outbound network usage.

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

## Verify server containers

```bash
sudo docker ps
```

Expected:

```text
hbbs
hbbr
```

---

## Check logs

```bash
sudo docker logs hbbs
sudo docker logs hbbr
```

---

## Verify GCP firewall

The following must be reachable from the Internet:

```text
TCP 21115
TCP 21116
UDP 21116
TCP 21117
```

---

## Verify DNS

From a client:

```bash
nslookup rustdesk.crewtimer.com
```

The returned IP should match the external IP assigned to the GCE VM.

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

- Keep `/opt/rustdesk` owned by `root:root`; administer it with `sudo` rather than assigning it to a particular Google Cloud login user.
- Keep `/opt/rustdesk/data/id_ed25519` private.
- Only distribute `id_ed25519.pub`.
- Use unique permanent passwords for unattended client machines.
- Leave RustDesk web-client ports `21118` and `21119` closed unless they are specifically required.
- Keep Ubuntu, Docker, and RustDesk updated.
- Back up `/opt/rustdesk/data/`.
- Restrict Google Cloud IAM permissions to administrators who actually need server access.

---

# References

RustDesk documentation:

- https://rustdesk.com/docs/en/self-host/
- https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/
- https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/
- https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/docker/
- https://rustdesk.com/docs/en/self-host/client-configuration/
- https://rustdesk.com/docs/en/client/
- https://rustdesk.com/docs/en/client/mac/
- https://github.com/rustdesk/rustdesk/wiki/macOS-Auto%E2%80%90Start-Service-Setup-%28for-Remote---MDM-Deployment%29

Google Cloud documentation:

- https://docs.cloud.google.com/network-tiers/docs/set-network-tier
- https://docs.cloud.google.com/compute/docs/networking/network-overview
