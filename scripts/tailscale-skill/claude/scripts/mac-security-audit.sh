#!/usr/bin/env bash
# =============================================================================
# mac-security-audit.sh — комплексный аудит безопасности macOS (ТОЛЬКО ЧТЕНИЕ)
# -----------------------------------------------------------------------------
# Скрипт НИЧЕГО НЕ МЕНЯЕТ в системе. Он только собирает информацию и формирует
# Markdown-отчёт: открытые порты, внешняя доступность, файрвол, удалённый доступ,
# VPN/туннели, перехват трафика, доверенные сертификаты, автозагрузка
# (persistence) включая BTM и системные расширения, запущенные процессы и их
# подписи, секреты в открытом виде, гигиена SSH-ключей, пользователи, логи
# входов, расширения браузеров, TCC-разрешения.
#
# Совместим с bash 3.2 (системный /bin/bash на macOS).
# Использование:
#   ./mac-security-audit.sh                 # отчёт на ~/Desktop/mac-security-report-<дата>.md
#   ./mac-security-audit.sh /путь/file.md   # отчёт в указанный файл
#   ./mac-security-audit.sh --help
# =============================================================================

VERSION="1.5.0"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'HELP'
mac-security-audit.sh — read-only аудит безопасности macOS

  ./mac-security-audit.sh [путь-к-отчёту.md]

По умолчанию отчёт пишется на Рабочий стол. Скрипт не вносит изменений в систему.
Часть проверок (pf, профили, BTM, системный TCC) требует sudo / Full Disk Access —
если они недоступны, скрипт выведет команды для ручного запуска.
HELP
  exit 0
fi

STAMP="$(date '+%Y-%m-%d-%H%M%S')"
DATE_HUMAN="$(date '+%Y-%m-%d %H:%M:%S %Z')"
HOSTN="$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || echo mac)"
REPORT="${1:-$HOME/Desktop/mac-security-report-$STAMP.md}"

exec > >(tee "$REPORT") 2>&1

# ---- хелперы -----------------------------------------------------------------
RED="🔴"; YEL="🟡"; GRN="🟢"
WARN_N=0; CRIT_N=0
hr() { echo; }
have() { command -v "$1" >/dev/null 2>&1; }
sudo_ok() { sudo -n true >/dev/null 2>&1; }

# ---- предварительный сбор ключевых флагов (для сводки) -----------------------
FW_STATE="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null)"
echo "$FW_STATE" | grep -q "enabled" && FW_ON=1 || FW_ON=0
STEALTH="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null)"

netstat -an -p tcp 2>/dev/null | grep -E '\.22[[:space:]]' | grep -qi listen && SSH_ON=1 || SSH_ON=0
netstat -an -p tcp 2>/dev/null | grep -E '\.5900[[:space:]]' | grep -qi listen && VNC_ON=1 || VNC_ON=0

fdesetup status 2>/dev/null | grep -q "On" && FV_ON=1 || FV_ON=0
csrutil status 2>/dev/null | grep -q "enabled" && SIP_ON=1 || SIP_ON=0
spctl --status 2>/dev/null | grep -q "enabled" && GK_ON=1 || GK_ON=0

EXPOSED="$(netstat -an -p tcp 2>/dev/null | awk '/LISTEN/ && ($4 ~ /\*\./ || $4 ~ /^0\.0\.0\.0/ ) {print $4}' | sort -u)"
EXPOSED_N="$(echo "$EXPOSED" | grep -c . )"

# процессы из нетипичных мест
SUSP_PROC_N="$(ps -axo comm= 2>/dev/null | grep -cE '^/(tmp|var/tmp|private/tmp|Users/Shared)/')"

OSVER="$(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null))"

# секреты в логах ИИ-агентов (один проход — список файлов в temp для переиспользования)
# общий расширенный набор паттернов (лежит рядом со скриптом — самодостаточно для скилла)
_SPDIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$_SPDIR/secret-patterns.sh" ] && . "$_SPDIR/secret-patterns.sh"
AGENT_SECRET_RE="${SECRET_DETECT_RE:-sk-ant-[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9]{32}|gh[po]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}}"
AGENT_SECRET_RE_GREP="${SECRET_DETECT_RE_GREP:-$AGENT_SECRET_RE}"
AGENT_DIRS=("$HOME/.claude/projects" "$HOME/.claude/history.jsonl" "$HOME/.codex/sessions" "$HOME/.codex/archived_sessions" "$HOME/Library/Application Support/Cursor/User/History" "$HOME/.windsurf" "$HOME/.aider")
AGENT_EXIST=(); for _d in "${AGENT_DIRS[@]}"; do [ -e "$_d" ] && AGENT_EXIST+=("$_d"); done
TMPHITS="$(mktemp -t msa_agenthits 2>/dev/null || echo "/tmp/msa_agenthits.$$")"
if [ ${#AGENT_EXIST[@]} -gt 0 ]; then
  if have rg; then
    rg -l --no-messages -g '!node_modules' -g '!.git' -e "$AGENT_SECRET_RE" "${AGENT_EXIST[@]}" 2>/dev/null > "$TMPHITS"
  else
    grep -rIlE --exclude-dir=node_modules --exclude-dir=.git "$AGENT_SECRET_RE_GREP" "${AGENT_EXIST[@]}" 2>/dev/null > "$TMPHITS"
  fi
fi
AGENT_HITS_N="$(wc -l < "$TMPHITS" 2>/dev/null | tr -d ' ')"; [ -z "$AGENT_HITS_N" ] && AGENT_HITS_N=0

# ---- ШАПКА И СВОДКА -----------------------------------------------------------
echo "# 🔐 Аудит безопасности macOS"
echo
echo "- **Хост:** \`$HOSTN\`"
echo "- **Дата:** $DATE_HUMAN"
echo "- **macOS:** $OSVER"
echo "- **Скрипт:** mac-security-audit v$VERSION (read-only — изменений не вносит)"
echo
echo "## 📋 Сводка"
echo
[ "$FW_ON" = "1" ] && echo "- $GRN Файрвол: включён" || { echo "- $RED Файрвол: **ВЫКЛЮЧЕН**"; CRIT_N=$((CRIT_N+1)); }
[ "$SSH_ON" = "1" ] && { echo "- $YEL Входящий SSH (порт 22): **открыт**"; WARN_N=$((WARN_N+1)); } || echo "- $GRN Входящий SSH (порт 22): закрыт"
[ "$VNC_ON" = "1" ] && { echo "- $YEL Screen Sharing / VNC (5900): **открыт**"; WARN_N=$((WARN_N+1)); } || echo "- $GRN Screen Sharing / VNC (5900): закрыт"
[ "$FV_ON" = "1" ] && echo "- $GRN FileVault (шифрование диска): включён" || { echo "- $RED FileVault: **ВЫКЛЮЧЕН**"; CRIT_N=$((CRIT_N+1)); }
[ "$SIP_ON" = "1" ] && echo "- $GRN SIP: включён" || { echo "- $RED SIP: **ВЫКЛЮЧЕН**"; CRIT_N=$((CRIT_N+1)); }
[ "$GK_ON" = "1" ] && echo "- $GRN Gatekeeper: включён" || { echo "- $RED Gatekeeper: **ВЫКЛЮЧЕН**"; CRIT_N=$((CRIT_N+1)); }
if [ "$EXPOSED_N" -gt 0 ]; then echo "- $YEL Слушателей на всех интерфейсах: **$EXPOSED_N** (см. раздел «Сеть»)"; WARN_N=$((WARN_N+1)); fi
if [ "$SUSP_PROC_N" -gt 0 ]; then echo "- $RED Процессов из нетипичных путей (/tmp и т.п.): **$SUSP_PROC_N** (см. раздел «Процессы»)"; CRIT_N=$((CRIT_N+1)); fi
if [ "$AGENT_HITS_N" -gt 0 ]; then echo "- $RED Файлов с токенами в логах ИИ-агентов: **$AGENT_HITS_N** (раздел 17 — ротируй ключи!)"; CRIT_N=$((CRIT_N+1)); fi
echo
echo "> Итого: $CRIT_N критичных, $WARN_N предупреждений. Это эвристика — итоговую оценку делает человек/агент по разделам ниже."
hr

# ---- 1. ЗАЩИТЫ ОС -------------------------------------------------------------
echo "## 1. Базовые защиты ОС"
echo '```'
echo "SIP:        $(csrutil status 2>/dev/null)"
echo "FileVault:  $(fdesetup status 2>/dev/null)"
echo "Gatekeeper: $(spctl --status 2>/dev/null)"
echo "macOS:      $OSVER"
echo '```'
echo "### MDM / профили конфигурации"
echo '```'
profiles status -type enrollment 2>&1
echo '```'
if sudo_ok; then
  echo "Установленные профили конфигурации:"
  echo '```'
  sudo -n profiles -P 2>&1 | head -40
  echo '```'
else
  echo "> Список профилей требует sudo. Проверь вручную: \`sudo profiles -P\` (ищи навязанные прокси/сертификаты/DNS)."
fi
hr

# ---- 2. СЕТЬ ------------------------------------------------------------------
echo "## 2. Сеть: слушающие порты и внешняя доступность"
echo "### Слушающие TCP-порты"
echo '```'
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR==1 || /LISTEN/'
echo '```'
echo "### Порты на всех интерфейсах (потенциально видны из LAN/снаружи)"
echo '```'
netstat -an -p tcp 2>/dev/null | awk 'NR<3 || (/LISTEN/ && ($4 ~ /\*\./ || $4 ~ /^0\.0\.0\.0/))'
echo '```'
echo "> Привязка к \`*\`/\`0.0.0.0\` = доступно другим устройствам сети. \`127.0.0.1\` = только локально (безопаснее)."
echo "### Установленные соединения"
echo '```'
lsof -nP -i -sTCP:ESTABLISHED 2>/dev/null | awk 'NR==1 || /ESTABLISHED/' | head -60
echo '```'
hr

# ---- 3. ФАЙРВОЛ ---------------------------------------------------------------
echo "## 3. Файрвол"
echo '```'
echo "$FW_STATE"
echo "$STEALTH"
/usr/libexec/ApplicationFirewall/socketfilterfw --getblockall 2>/dev/null
echo '```'
echo "### pf (низкоуровневый файрвол / проброс портов)"
if sudo_ok; then
  echo '```'
  sudo -n pfctl -s info 2>&1 | head -3
  echo "--- NAT/RDR ---"
  sudo -n pfctl -s nat 2>&1 | head -20
  echo '```'
else
  echo "> Требует sudo. Вручную: \`sudo pfctl -s nat && sudo pfctl -s rules\` (только анкоры \`com.apple/*\` без \`rdr\` = норма)."
fi
hr

# ---- 4. УДАЛЁННЫЙ ДОСТУП ------------------------------------------------------
echo "## 4. Удалённый доступ"
echo '```'
[ "$SSH_ON" = "1" ] && echo "SSH (Remote Login): ВКЛЮЧЁН — порт 22 слушает" || echo "SSH (Remote Login): выключен"
[ "$VNC_ON" = "1" ] && echo "Screen Sharing / VNC: ВКЛЮЧЁН — порт 5900 слушает" || echo "Screen Sharing / VNC: выключен"
echo "ARD / Remote Management:"; ls /Library/Preferences/com.apple.RemoteManagement.plist >/dev/null 2>&1 && echo "  настроен (см. plist)" || echo "  не настроен (выключен)"
echo "Запущенные средства удалённого доступа:"
pgrep -lf -i "teamviewer|anydesk|screensharing|RemoteManagement|vnc" 2>/dev/null | grep -v pgrep || echo "  (не запущены)"
echo '```'
hr

# ---- 5. VPN И ТУННЕЛИ ---------------------------------------------------------
echo "## 5. VPN и туннели"
echo '```'
echo "--- Tailscale ---"
if [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>/dev/null | head -15 || echo "  (Tailscale установлен, статус недоступен)"
elif have tailscale; then tailscale status 2>/dev/null | head -15; else echo "  (не установлен)"; fi
echo "--- VPN/туннель процессы ---"
pgrep -lf -i "openvpn|wireguard|wg-|autossh|ngrok|cloudflared|frpc|sshuttle|proton|surfshark|outline" 2>/dev/null | grep -v pgrep || echo "  (нет)"
echo "--- Активные туннельные интерфейсы (utun/tun/tap/ppp с IP) ---"
ifconfig 2>/dev/null | awk '/^(utun|tun|tap|wg|ppp)[0-9]/{iface=$1} /inet /{if(iface){print iface, $2; iface=""}}'
echo "--- Reverse SSH (-R, проброс порта мака на удалённый сервер) ---"
pgrep -lf "ssh.*-R " 2>/dev/null | grep -v pgrep || echo "  (нет)"
echo '```'
hr

# ---- 6. СЕТЕВОЙ ПЕРЕХВАТ ------------------------------------------------------
echo "## 6. Перехват трафика: hosts / DNS / прокси"
echo "### /etc/hosts (нестандартные записи)"
echo '```'
grep -vE '^[[:space:]]*#|^[[:space:]]*$' /etc/hosts 2>/dev/null || echo "(пусто)"
echo '```'
echo "### DNS-серверы"
echo '```'
scutil --dns 2>/dev/null | grep 'nameserver\[' | sort -u
echo '```'
echo "### Системный прокси (по сетевым службам)"
echo '```'
for svc in $(networksetup -listallnetworkservices 2>/dev/null | tail -n +2); do
  for t in getwebproxy getsecurewebproxy getsocksfirewallproxy getautoproxyurl; do
    res="$(networksetup -$t "$svc" 2>/dev/null)"
    echo "$res" | grep -qiE 'Enabled: Yes|URL: http' && echo "[$svc] $t -> $(echo "$res" | tr '\n' ' ')"
  done
done | sort -u
echo "(если выше пусто — прокси нигде не включён)"
echo '```'
hr

# ---- 7. ДОВЕРЕННЫЕ СЕРТИФИКАТЫ ------------------------------------------------
echo "## 7. Доверенные сторонние root-сертификаты (вектор MITM)"
echo "> Кастомное доверие к root-CA = его владелец может подделать HTTPS любого сайта. Здесь должны быть только осознанно добавленные (корп-CA, гос-ЭЦП, dev-прокси)."
echo "### Admin domain"
echo '```'
security dump-trust-settings -d 2>&1 | head -40
echo '```'
echo "### User domain"
echo '```'
security dump-trust-settings 2>&1 | head -40
echo '```'
hr

# ---- 8. АВТОЗАГРУЗКА (базовая) ------------------------------------------------
echo "## 8. Автозагрузка (LaunchAgents/Daemons, cron, hooks)"
echo "### LaunchAgents/Daemons"
echo '```'
for d in "$HOME/Library/LaunchAgents" "/Library/LaunchAgents" "/Library/LaunchDaemons"; do
  echo "### $d"
  ls -la "$d" 2>/dev/null | tail -n +2 || echo "  (нет/пусто)"
  echo
done
echo '```'
echo "### Подозрительные инлайн-команды в plist (curl/base64/eval/…)"
echo '```'
grep -rlE 'curl |wget |base64|eval |python3? -c|osascript -e|/dev/tcp|nc -l?[[:space:]]' \
  "$HOME/Library/LaunchAgents" /Library/LaunchAgents /Library/LaunchDaemons 2>/dev/null \
  || echo "(чисто — ничего подозрительного не найдено)"
echo '```'
echo "### cron / login-hooks / shell-rc"
echo '```'
echo "crontab пользователя:"; crontab -l 2>&1 | grep -vE '^[[:space:]]*#' | head || true
echo "LoginHook:";  defaults read com.apple.loginwindow LoginHook 2>&1 | head -1
echo "LogoutHook:"; defaults read com.apple.loginwindow LogoutHook 2>&1 | head -1
echo "Подозрительное в shell-rc:"
grep -nEH 'curl |wget |base64|eval |/dev/tcp|nc -l?[[:space:]]|\| *(ba)?sh' \
  "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" 2>/dev/null \
  | grep -vE '#|conda|rbenv|nvm|brew shellenv' | head || echo "  (чисто)"
echo '```'
hr

# ---- 9. АВТОЗАГРУЗКА (продвинутая) -------------------------------------------
echo "## 9. Автозагрузка (продвинутая): BTM, расширения, kext, плагины"
echo "### Background Task Management (BTM) — реестр всех фоновых элементов (macOS 13+)"
if sudo_ok; then
  echo '```'
  sudo -n sfltool dumpbtm 2>&1 | grep -E 'Name:|Developer Name:|Type:|Disposition:|Identifier:|Executable' | head -150 || echo "(пусто)"
  echo '```'
else
  echo "> Требует sudo (+ Full Disk Access). Вручную: \`sudo sfltool dumpbtm\`. Ищи включённые/скрытые элементы, которые ты не ставил."
fi
echo "### Системные и сетевые расширения"
echo '```'
systemextensionsctl list 2>&1 | grep -iE 'enabled|activated|teamID|\.appex|extension' | head -40 || echo "(нет)"
echo '```'
echo "### Сторонние kernel extensions (kext)"
echo '```'
if have kmutil; then kmutil showloaded --list-only 2>/dev/null | grep -viE 'com\.apple|^[[:space:]]*$' | head -30 || echo "(только Apple / нужен root — норма)"
else kextstat 2>/dev/null | grep -v com.apple | head -30 || echo "(только Apple — норма)"; fi
echo '```'
echo "### Authorization plugins (вектор перехвата логина)"
echo '```'
ls -la /Library/Security/SecurityAgentPlugins/ 2>/dev/null | tail -n +2 || echo "(пусто/нет — норма)"
echo '```'
echo "### Системные cron / periodic / at"
echo '```'
echo "Системные crontab (/usr/lib/cron/tabs):"; ls -la /usr/lib/cron/tabs/ 2>/dev/null | tail -n +2 || echo "  (нет доступа/нет — норма)"
echo "/etc/crontab:"; [ -f /etc/crontab ] && grep -vE '^#|^[[:space:]]*$' /etc/crontab || echo "  (нет)"
echo "Нестандартные periodic-скрипты:"; find /etc/periodic -type f 2>/dev/null | grep -vE '/(daily|weekly|monthly)/[0-9]' | head || echo "  (только штатные)"
echo "at jobs:"; atq 2>/dev/null || echo "  (нет/отключено)"
echo '```'
hr

# ---- 10. ПРОЦЕССЫ: ПУТИ И ПОДПИСИ --------------------------------------------
echo "## 10. Запущенные процессы: расположение и подписи"
echo "### Процессы из нетипичных мест (/tmp, /var/tmp, /Users/Shared, скрытые каталоги)"
echo '```'
ps -axo pid=,user=,comm= 2>/dev/null | awk '$3 ~ "^/(tmp|var/tmp|private/tmp|Users/Shared)/"' | head -20
echo "(если пусто — ничего не выполняется из подозрительных путей)"
echo '```'
echo "### Подписи бинарников запущенных процессов (вне системных каталогов)"
echo '```'
ps -axo comm= 2>/dev/null | sort -u | grep '^/' \
 | grep -vE '^/(System|usr|sbin|bin)/' \
 | grep -vE '^/Library/Apple/' \
 | head -40 | while read -r p; do
    [ -e "$p" ] || continue
    s="$(codesign -d --verbose=2 "$p" 2>&1)"
    if echo "$s" | grep -qi "Authority=Software Signing\|Authority=Apple Mac OS"; then v="Apple   "
    elif echo "$s" | grep -qi "Authority=Developer ID"; then v="DevID   "
    elif echo "$s" | grep -qi "Apple Development\|Mac Developer"; then v="DevCert "
    elif echo "$s" | grep -qi "adhoc"; then v="$YEL ADHOC"
    elif echo "$s" | grep -qi "not signed\|is not signed"; then v="$RED НЕПОДП"
    else v="?       "; fi
    echo "$v  $p"
 done | sort -u | head -60
echo '```'
echo "> ⚠ ADHOC / НЕПОДП в нестандартном пути — повод присмотреться. Подписанные Apple/DevID — норма."
echo "### Свежие файлы (<14 дней) в местах малвари"
echo '```'
find "$HOME/Library/LaunchAgents" /Library/LaunchAgents /Library/LaunchDaemons \
     /tmp /var/tmp /Users/Shared -type f -mtime -14 2>/dev/null \
  | grep -vE '\.(log|out|err|state|uarplog)$' | head -30 || echo "(ничего свежего)"
echo '```'
hr

# ---- 11. СЕКРЕТЫ В ОТКРЫТОМ ВИДЕ ----------------------------------------------
echo "## 11. Секреты в открытом виде (показаны ПУТИ и счётчики, НЕ содержимое)"
echo '```'
echo "Файлы-кандидаты в \$HOME (без node_modules/Library/Trash):"
find "$HOME" -maxdepth 4 -type f \( -name ".env" -o -name "*.env" -o -name ".netrc" -o -name ".git-credentials" -o -name ".pgpass" \) 2>/dev/null \
  | grep -vE '/node_modules/|/\.Trash/|/Library/' | head -40
echo
echo "Облачные/инфра креды:"
for f in "$HOME/.aws/credentials" "$HOME/.config/gcloud" "$HOME/.kube/config" "$HOME/.docker/config.json" "$HOME/.npmrc"; do
  [ -e "$f" ] && echo "  есть: $f"
done
echo
echo "Совпадения секретов в истории shell (ТОЛЬКО счётчик, значения не выводятся):"
for h in "$HOME/.zsh_history" "$HOME/.bash_history"; do
  [ -f "$h" ] && echo "  $(basename "$h"): $(grep -cIE 'API_KEY|SECRET|TOKEN|PASSWORD|sk-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]|AKIA[0-9A-Z]{16}' "$h" 2>/dev/null) совпадений"
done
echo '```'
echo "> Значения НЕ выводятся. Если совпадений много — почисти историю, переведи секреты в менеджер/переменные окружения."
hr

# ---- 12. SSH-КЛЮЧИ -----------------------------------------------------------
echo "## 12. Гигиена SSH-ключей"
echo '```'
for k in "$HOME"/.ssh/id_* "$HOME"/.ssh/*_rsa "$HOME"/.ssh/*_ed25519; do
  [ -f "$k" ] || continue
  case "$k" in *.pub) continue;; esac
  head -3 "$k" 2>/dev/null | grep -q "BEGIN" || continue
  perms="$(stat -f '%Lp' "$k" 2>/dev/null)"
  enc="без passphrase"; head -3 "$k" 2>/dev/null | grep -q "ENCRYPTED" && enc="зашифрован"
  pflag=""; [ "$perms" != "600" ] && pflag=" $YEL права $perms (должно 600)"
  eflag=""; [ "$enc" = "без passphrase" ] && eflag=" $YEL"
  echo "$(basename "$k"): $enc$eflag | права $perms$pflag"
done
echo '```'
echo "> Ключи без passphrase: при утечке файла = мгновенный доступ к серверам. Права должны быть 600."
echo "### Кто может зайти НА мак (authorized_keys) и куда настроены подключения"
echo '```'
echo "authorized_keys:"; awk '{print "  "$1, $NF}' "$HOME/.ssh/authorized_keys" 2>/dev/null || echo "  (нет)"
echo "~/.ssh/config (Host):"; grep -iE '^[[:space:]]*host ' "$HOME/.ssh/config" 2>/dev/null | head -20 || echo "  (нет)"
echo '```'
hr

# ---- 13. ПОЛЬЗОВАТЕЛИ ---------------------------------------------------------
echo "## 13. Пользователи и доступ"
echo '```'
echo "Пользователи (не системные):"
dscl . list /Users 2>/dev/null | grep -vE '^_|^daemon$|^nobody$|^root$|^Guest$'
echo "Администраторы:"; dscl . -read /Groups/admin GroupMembership 2>/dev/null
echo "Автологин:"; defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>&1 | head -1
echo "Гостевой аккаунт:"; sysadminctl -guestAccount status 2>&1 | tail -1
echo '```'
hr

# ---- 14. ЛОГИ ВХОДОВ ----------------------------------------------------------
echo "## 14. Последние входы"
echo '```'
last 2>/dev/null | head -15
echo '```'
echo "> Ищи входы НЕ твоего пользователя или с удалённых адресов (поле host)."
echo "> Неудачные входы за неделю: \`log show --predicate 'eventMessage CONTAINS \"authentication failure\"' --last 7d\`"
hr

# ---- 15. РАСШИРЕНИЯ БРАУЗЕРОВ --------------------------------------------------
echo "## 15. Расширения браузеров"
echo '```'
if have python3; then
python3 - <<'PYEOF'
import os, json, glob
AS = os.path.expanduser("~/Library/Application Support")
browsers = {
    "Chrome": "Google/Chrome", "Brave": "BraveSoftware/Brave-Browser",
    "Edge": "Microsoft Edge", "Yandex": "Yandex/YandexBrowser",
    "Opera": "com.operasoftware.Opera", "Chromium": "Chromium",
    "Vivaldi": "Vivaldi", "Arc": "Arc",
}
def name_of(extdir):
    vers = [d for d in glob.glob(os.path.join(extdir, "*")) if os.path.isdir(d)]
    if not vers: return "?"
    last = sorted(vers)[-1]
    try: m = json.load(open(os.path.join(last, "manifest.json"), encoding="utf-8"))
    except Exception: return "?"
    nm = m.get("name", "?")
    if isinstance(nm, str) and nm.startswith("__MSG_"):
        key = nm[6:-2]; dl = m.get("default_locale", "en")
        for loc in [dl, "en", "en_US", "ru"]:
            p = os.path.join(last, "_locales", loc, "messages.json")
            if os.path.exists(p):
                try:
                    md = json.load(open(p, encoding="utf-8"))
                    for k, v in md.items():
                        if k.lower() == key.lower(): return v.get("message", nm)
                except Exception: pass
    return nm
for label, sub in browsers.items():
    root = os.path.join(AS, sub)
    if not os.path.isdir(root): continue
    rows = []
    for ep in glob.glob(os.path.join(root, "*", "Extensions")):
        prof = os.path.basename(os.path.dirname(ep))
        for ed in glob.glob(os.path.join(ep, "*")):
            eid = os.path.basename(ed)
            if eid == "Temp": continue
            rows.append((prof, name_of(ed), eid))
    if rows:
        print(f"== {label} ==")
        for prof, nm, eid in sorted(set(rows)):
            print(f"  [{prof}] {nm}  ({eid})")
PYEOF
else
  echo "(python3 не найден — пропускаю расшифровку; смотри chrome://extensions)"
fi
echo '```'
echo "### Firefox / Safari (структура иная — проверь отдельно)"
echo '```'
ff="$(find "$HOME/Library/Application Support/Firefox/Profiles" -name extensions.json 2>/dev/null | head -1)"
[ -n "$ff" ] && echo "Firefox extensions.json: $ff (открой для списка)" || echo "Firefox: профиль не найден"
echo "Safari App Extensions:"; pluginkit -mAvvv -p com.apple.Safari.extension 2>/dev/null | head -20 || echo "  (нет/недоступно)"
echo '```'
echo "> Сверь, что все расширения знакомы. Особое внимание — крипто-кошелькам и экспортёрам cookies."
hr

# ---- 16. TCC ------------------------------------------------------------------
echo "## 16. Приватные разрешения (TCC) — ТРЕБУЕТ РУЧНОЙ ПРОВЕРКИ"
echo "База TCC.db защищена SIP и читается только процессом с «Полным доступом к диску» (даже sudo не обходит)."
echo
echo "**Проверь глазами:** Системные настройки → Конфиденциальность и безопасность →"
echo "- **Универсальный доступ (Accessibility)** — полный контроль/кейлоггинг ← самое важное"
echo "- **Мониторинг ввода (Input Monitoring)** — перехват клавиатуры"
echo "- **Запись экрана (Screen Recording)**"
echo "- **Полный доступ к диску (Full Disk Access)**"
echo "- **Автоматизация (Apple Events)** — кто может управлять ДРУГИМИ приложениями (браузер/терминал/GUI). Особое внимание AI-агентам (Cursor/Codex) и интерпретаторам: при промпт-инъекции это путь к действиям от твоего имени"
echo
echo "Ищи незнакомые приложения, дубликаты системных процессов, голые интерпретаторы (python/node) с этими правами, остаточные доступы (например sshd-keygen-wrapper)."
if sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" "select 1" >/dev/null 2>&1; then
  echo
  echo "### USER TCC (терминалу выдан Full Disk Access):"
  echo '```'
  sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
    "SELECT service, client, CASE auth_value WHEN 2 THEN 'ALLOW' WHEN 3 THEN 'ALLOW' WHEN 0 THEN 'deny' ELSE auth_value END FROM access ORDER BY service" 2>&1 | head -60
  echo '```'
else
  echo
  echo "> Для чтения из CLI: дай терминалу «Полный доступ к диску», перезапусти его и выполни:"
  echo "> \`sqlite3 \"\$HOME/Library/Application Support/com.apple.TCC/TCC.db\" \"SELECT service,client,auth_value FROM access\"\`"
fi
hr

# ---- 17. СЕКРЕТЫ В ЛОГАХ ИИ-АГЕНТОВ ------------------------------------------
echo "## 17. Секреты в логах ИИ-агентов (Claude/Codex/Cursor/Windsurf)"
echo "> Логи сессий хранят вывод команд и вставленный текст — туда могли попасть токены. Показаны файлы, типы и счётчики — БЕЗ самих значений."
have rg || echo "> ⚠ Для быстрого скана установи ripgrep (\`brew install ripgrep\`) — без него grep по большим логам может занять минуты."
echo "### Объём логов агентов"
echo '```'
[ ${#AGENT_EXIST[@]} -gt 0 ] && du -sh "${AGENT_EXIST[@]}" 2>/dev/null || echo "(логи агентов не найдены)"
echo '```'
echo "### Файлы с потенциальными токенами"
echo '```'
if [ "$AGENT_HITS_N" -gt 0 ]; then
  sed "s#$HOME/#~/#" "$TMPHITS" 2>/dev/null | head -30
  [ "$AGENT_HITS_N" -gt 30 ] && echo "  … и ещё $((AGENT_HITS_N-30)) файлов"
  echo "Всего файлов с совпадениями: $AGENT_HITS_N"
else echo "(высокоэнтропийных токенов не найдено — чисто)"; fi
echo '```'
if [ "$AGENT_HITS_N" -gt 0 ] && [ ${#AGENT_EXIST[@]} -gt 0 ]; then
  echo "### Разбивка по типам токенов (счётчики, значения замаскированы)"
  echo '```'
  { if have rg; then rg -oIN --no-messages -g '!node_modules' -e "$AGENT_SECRET_RE" "${AGENT_EXIST[@]}" 2>/dev/null
    else tr '\n' '\0' < "$TMPHITS" 2>/dev/null | xargs -0 grep -hIoE "$AGENT_SECRET_RE_GREP" 2>/dev/null; fi; } \
    | grep -viE 'EXAMPLE' | grep -v 'REDACTED' \
    | sed -E 's/(sk-ant-|sk-proj-|sk-or-v1-|github_pat_|gh[posru]_|glpat-|A[KS]IA|xox[baprs]-|AIza|ya29\.|SG\.|npm_|dop_v1_|sk_(live|test)_|pk_(live|test)_|eyJ|sk-).*/\1…/' \
    | sort | uniq -c | sort -rn | head -15
  echo '```'
  echo "> Раз токен попал в лог — считай его скомпрометированным: **ротируй** (создай новый, отзови старый)."
  echo "> Старые логи можно почистить: \`~/.codex/sessions\`, завершённые проекты в \`~/.claude/projects\`, \`Cursor/User/History\`."
fi
hr

# ---- 18. ОБНОВЛЕНИЯ ОС --------------------------------------------------------
echo "## 18. Обновления ОС и анти-малварь Apple"
echo '```'
echo "Авто-обновления (расписание):"; softwareupdate --schedule 2>/dev/null | sed 's/^/  /' || echo "  (недоступно)"
echo "Авто-установка security-обновлений:"
defaults read /Library/Preferences/com.apple.SoftwareUpdate CriticalUpdateInstall 2>/dev/null | sed 's/^/  CriticalUpdateInstall=/' || echo "  (по умолчанию)"
echo "XProtect (анти-малварь) версия:"
defaults read /Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info CFBundleShortVersionString 2>/dev/null | sed 's/^/  /' || echo "  (недоступно)"
echo "История последних обновлений:"; softwareupdate --history 2>/dev/null | head -6 | sed 's/^/  /' || echo "  (недоступно)"
echo '```'
echo "> Живой список доступных обновлений (сетевой запрос, может быть медленным): \`softwareupdate -l\`"
hr

# ---- 19. ПОДПИСИ УСТАНОВЛЕННЫХ ПРИЛОЖЕНИЙ ------------------------------------
echo "## 19. Подписи установленных приложений (/Applications)"
echo "> Норма: Apple / Developer ID. Подозрительно: неподписанные / adhoc / неизвестный разработчик."
echo '```'
_unsigned=0; _total=0
for app in /Applications/*.app; do
  [ -d "$app" ] || continue
  _total=$((_total+1))
  s="$(codesign -dvv "$app" 2>&1)"
  if echo "$s" | grep -qi "Authority=Apple"; then :
  elif echo "$s" | grep -qi "Authority=Developer ID"; then :
  else
    auth="$(echo "$s" | grep -i 'Authority=' | head -1 | sed 's/.*[Aa]uthority=//')"
    echo "  ⚠ $(basename "$app"): ${auth:-НЕ ПОДПИСАН / неизвестно}"
    _unsigned=$((_unsigned+1))
  fi
done
echo "Проверено приложений: $_total; без подписи Apple/Developer ID: $_unsigned"
echo '```'
echo "> Полная проверка нотаризации (сетевая): \`spctl -a -vvv -t exec /Applications/Имя.app\`"
hr

# ---- 20. ПРОИСХОЖДЕНИЕ ПРИЛОЖЕНИЙ --------------------------------------------
echo "## 20. Происхождение и свежесть приложений"
echo "### Приложения с атрибутом quarantine (откуда скачаны)"
echo '```'
_found=0
for app in /Applications/*.app; do
  q="$(xattr -p com.apple.quarantine "$app" 2>/dev/null)"
  [ -n "$q" ] && { echo "  $(basename "$app"): $(echo "$q" | awk -F';' '{print $3}')"; _found=1; }
done
[ "$_found" = 0 ] && echo "  (нет .app с quarantine — норма для давно установленных)"
echo '```'
echo "### Недавно изменённые приложения (<30 дней)"
echo '```'
find /Applications -maxdepth 1 -name '*.app' -mtime -30 2>/dev/null | sed 's#/Applications/#  #' | grep . || echo "  (нет)"
echo '```'
hr

# ---- 21. РЕЗЕРВНЫЕ КОПИИ И БЛОКИРОВКА ЭКРАНА ---------------------------------
echo "## 21. Резервные копии и блокировка экрана"
echo '```'
echo "Time Machine назначения:"; tmutil destinationinfo 2>/dev/null | grep -E 'Name|Kind|Mount' | sed 's/^/  /' || echo "  (Time Machine не настроен)"
echo "Последний бэкап:"; tmutil latestbackup 2>/dev/null | sed 's/^/  /' || echo "  (нет/недоступно)"
echo "Пароль при пробуждении/заставке:"
_ap="$(defaults read com.apple.screensaver askForPassword 2>/dev/null)"; _apd="$(defaults read com.apple.screensaver askForPasswordDelay 2>/dev/null)"
echo "  askForPassword=${_ap:-?} (1=требовать), задержка=${_apd:-?} сек (0=сразу)"
echo '```'
echo "> Ручная проверка (нужны привилегии/GUI): Find My Mac (включён?), Secure Boot — \`sudo bputil -d\` (Apple Silicon), автоблокировка экрана."
hr

# ---- 22. СОХРАНЁННЫЕ ПАРОЛИ БРАУЗЕРОВ ----------------------------------------
echo "## 22. Сохранённые пароли в браузерах (количество, БЕЗ значений)"
echo '```'
_ASD="$HOME/Library/Application Support"
_TMPLD="$(mktemp -t msa_ld 2>/dev/null || echo "/tmp/msa_ld.$$")"
for b in "Google/Chrome" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Yandex/YandexBrowser" "com.operasoftware.Opera"; do
  [ -d "$_ASD/$b" ] || continue
  find "$_ASD/$b" -maxdepth 2 -name "Login Data" 2>/dev/null | while IFS= read -r ld; do
    cp "$ld" "$_TMPLD" 2>/dev/null || continue
    n="$(sqlite3 "$_TMPLD" "SELECT count(*) FROM logins" 2>/dev/null)"
    [ -n "$n" ] && [ "$n" != "0" ] && echo "  $b [$(basename "$(dirname "$ld")")]: $n паролей"
  done
done
for lj in "$_ASD/Firefox/Profiles"/*/logins.json; do
  [ -f "$lj" ] && echo "  Firefox [$(basename "$(dirname "$lj")")]: $(grep -o '"guid"' "$lj" 2>/dev/null | wc -l | tr -d ' ') записей"
done
rm -f "$_TMPLD"
echo "(пусто = сохранённых паролей не найдено или БД недоступна)"
echo '```'
echo "> Значения НЕ выводятся (зашифрованы). Много паролей в браузере = лакомая цель — рассмотри отдельный менеджер (Bitwarden у тебя есть)."
hr

# ---- 23. РАСШИРЕНИЯ IDE -------------------------------------------------------
echo "## 23. Расширения IDE (VS Code / Cursor / Windsurf)"
echo "> Расширения IDE выполняют произвольный код с твоими правами — вектор supply-chain. Ставь только из доверенных источников."
echo '```'
for d in "$HOME/.vscode/extensions" "$HOME/.vscode-insiders/extensions" "$HOME/.cursor/extensions" "$HOME/.windsurf/extensions" "$HOME/.vscode-oss/extensions"; do
  [ -d "$d" ] || continue
  cnt="$(ls "$d" 2>/dev/null | grep -vE '^\.|\.json$|\.vsixsignature$' | wc -l | tr -d ' ')"
  echo "  ${d/#$HOME/~}: $cnt расширений"
done
echo '```'
echo "> Полный список: \`ls ~/.vscode/extensions\`. Сверь, что все расширения знакомы."
hr

# ---- 24. КАРТА ИСХОДЯЩИХ СОЕДИНЕНИЙ ------------------------------------------
echo "## 24. Карта исходящих соединений (выявление маячков / C2)"
echo "> Снимок текущих исходящих TCP — процесс → удалённый адрес, сгруппировано. Регулярные соединения НЕЗНАКОМОГО процесса к одному IP = повод проверить."
echo '```'
lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1 {n=split($9,a,"->"); if(n==2) print $1"  ->  "a[2]}' | sort | uniq -c | sort -rn | head -30
echo '```'
echo "> Для ПОСТОЯННОГО мониторинга исходящих ставь Little Snitch или LuLu (бесплатный, open-source) — они спрашивают разрешение на каждое новое исходящее соединение."
hr

# ---- 25. KEYCHAIN -------------------------------------------------------------
echo "## 25. Keychain (связки ключей) — обзор без содержимого"
echo '```'
echo "Связки в поиске:"; security list-keychains 2>/dev/null | sed 's/^/  /'
echo "Связка по умолчанию:"; security default-keychain 2>/dev/null | sed 's/^/  /'
echo "Файлы связок:"; ls -la "$HOME/Library/Keychains/" 2>/dev/null | awk 'NR>1 && !/^d/ {print "  "$5" "$NF}'
echo '```'
echo "> Содержимое НЕ дампим (вызвало бы запросы доступа). Норма — login.keychain-db + системные. Незнакомая связка в поиске — повод проверить."
hr

# ---- 26. ЭСКАЛАЦИЯ ПРИВИЛЕГИЙ -------------------------------------------------
echo "## 26. Эскалация привилегий"
echo "### sudoers.d (содержимое требует sudo)"
echo '```'
ls -la /etc/sudoers.d/ 2>/dev/null | awk 'NR>1' | sed 's/^/  /' || echo "  (нет доступа/пусто)"
echo "  (проверь NOPASSWD вручную: sudo cat /etc/sudoers /etc/sudoers.d/*)"
echo '```'
echo "### Каталоги в \$PATH с правом записи для всех (риск PATH-hijacking)"
echo '```'
_wwp=0
echo "$PATH" | tr ':' '\n' | while IFS= read -r d; do
  [ -d "$d" ] || continue
  [ -n "$(find "$d" -maxdepth 0 -perm -0002 2>/dev/null)" ] && echo "  ⚠ world-writable: $d ($(stat -f '%Sp %Su' "$d" 2>/dev/null))"
done | grep . || echo "  (world-writable каталогов в PATH не найдено — норма)"
echo '```'
echo "### DYLD-инъекции (подмена библиотек)"
echo '```'
env | grep -i '^DYLD' | sed 's/^/  /' || true
env | grep -qi '^DYLD' || echo "  нет DYLD_* в окружении (норма)"
echo '```'
hr

# ---- 27. SHARING-СЕРВИСЫ ------------------------------------------------------
echo "## 27. Sharing-сервисы (общий доступ)"
echo '```'
echo "Слушающие порты общего доступа:"
netstat -an -p tcp 2>/dev/null | grep -i listen | grep -E '\.(445|548|631|3689|5900|88)[^0-9]' | sed 's/^/  /' || echo "  (нет)"
netstat -an -p tcp 2>/dev/null | grep -i listen | grep -qE '\.(445|548|631|3689|5900|88)[^0-9]' || echo "  (порты файл/печать/медиа/экран-шеринга не слушают — норма)"
echo "Процессы шеринга:"
_sh="$(pgrep -lf "smbd|AppleFileServer|ODSAgent|InternetSharing" 2>/dev/null | grep -v pgrep)"
[ -n "$_sh" ] && echo "$_sh" | sed 's/^/  /' || echo "  (file/media sharing не запущены)"
echo '```'
echo "> 445=SMB(файлы), 548=AFP, 631=печать, 3689=медиа, 5900=экран, 88=Kerberos. Ненужное выключи: Настройки → Общий доступ."
hr

# ---- ХВОСТ --------------------------------------------------------------------
echo "## ✅ Дальше"
echo
echo "Скрипт собрал данные. Триаж (норма / подозрительно) и рекомендации по"
echo "устранению с командами и откатами — см. \`docs/CHECKS.md\` в репозитории."
echo
echo "> Отчёт содержит чувствительные данные (IP, имена, инфраструктуру) — **не публикуй его как есть**."
echo
echo "---"
echo "_Сгенерировано mac-security-audit v$VERSION • $DATE_HUMAN • $HOSTN_"
rm -f "$TMPHITS" 2>/dev/null
sync
