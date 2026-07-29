#!/bin/bash
# Server setup script for Tailscale OIDC deploy
# Run as root on the target server

set -euo pipefail

echo "🔧 Setting up server for Tailscale OIDC deploy..."

# ── 1. Tailscale SSH ──────────────────────────────────────────
echo "→ Enabling Tailscale SSH..."
tailscale set --ssh=true

TAILSCALE_IP=$(ip -4 addr show tailscale0 | grep -oP 'inet \K[\d.]+')
echo "  Tailscale IP: $TAILSCALE_IP"

# ── 2. SSH socket — add port 2222 ─────────────────────────────
echo "→ Configuring SSH socket (port 2222 on Tailscale IP)..."
mkdir -p /etc/systemd/system/ssh.socket.d
cat > /etc/systemd/system/ssh.socket.d/override.conf << EOF
[Socket]
ListenStream=
ListenStream=0.0.0.0:22
ListenStream=[::]:22
ListenStream=$TAILSCALE_IP:2222
FreeBind=yes
EOF
systemctl daemon-reload
systemctl restart ssh.socket
systemctl restart ssh

# ── 3. Firewall ───────────────────────────────────────────────
echo "→ Configuring UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22
ufw allow in on tailscale0 to any port 2222
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 4. Deploy user ────────────────────────────────────────────
echo "→ Creating deploy user..."
if ! id "deploy" &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy
fi

# ── 5. Docker registry auth ───────────────────────────────────
echo "→ Copying Docker registry auth to deploy user..."
mkdir -p /home/deploy/.docker
cp /root/.docker/config.json /home/deploy/.docker/config.json
chown -R deploy:deploy /home/deploy/.docker

# ── 6. SSH hardening ──────────────────────────────────────────
echo "→ Hardening SSH config..."
SSHD_CONFIG="/etc/ssh/sshd_config"
if ! grep -q "PermitRootLogin no" "$SSHD_CONFIG" 2>/dev/null; then
  echo "PermitRootLogin no" >> "$SSHD_CONFIG"
  echo "  Added: PermitRootLogin no"
fi
if ! grep -q "PasswordAuthentication no" "$SSHD_CONFIG" 2>/dev/null; then
  echo "PasswordAuthentication no" >> "$SSHD_CONFIG"
  echo "  Added: PasswordAuthentication no"
fi
if ! grep -q "X11Forwarding no" "$SSHD_CONFIG" 2>/dev/null; then
  echo "X11Forwarding no" >> "$SSHD_CONFIG"
  echo "  Added: X11Forwarding no"
fi
if ! grep -q "MaxAuthTries 3" "$SSHD_CONFIG" 2>/dev/null; then
  echo "MaxAuthTries 3" >> "$SSHD_CONFIG"
  echo "  Added: MaxAuthTries 3"
fi
if ! grep -q "LoginGraceTime 30" "$SSHD_CONFIG" 2>/dev/null; then
  echo "LoginGraceTime 30" >> "$SSHD_CONFIG"
  echo "  Added: LoginGraceTime 30"
fi
systemctl restart ssh

echo ""
echo "✅ Server setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create restricted SSH key for deploy user"
echo "  2. Set up GitHub Secrets (TS_OAUTH_CLIENT_ID, TS_AUDIENCE, DEPLOY_SSH_KEY)"
echo "  3. Add deploy.yml workflow to your repo"
echo ""
echo "⚠️  IMPORTANT: Test SSH access before closing your current session!"
echo "  ssh deploy@$TAILSCALE_IP  # should NOT get a shell"
