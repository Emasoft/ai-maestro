/**
 * Deliver a PIN to the PHYSICAL DESKTOP of the machine running the server.
 *
 * TRDD-P7XKV3N9. This is the second factor for a MAESTRO password change, and
 * the whole security property is this: an attacker who holds the password but
 * is not sitting at the console CANNOT READ THIS. The PIN travels over the OS's
 * own notification channel to a screen, never over HTTP.
 *
 * Which is why the PIN must never appear in an HTTP response body, a log line,
 * or an error message. If it can be read over the wire, it proves nothing and
 * this file is pointless. The route returns only "a PIN was delivered".
 *
 * FAIL CLOSED: if no channel is available, we return false and the caller MUST
 * refuse the operation. A presence check that degrades to "skip it" is not a
 * presence check — it is a comment.
 */
import { spawn } from 'child_process'
import { randomInt } from 'crypto'

/** A 6-digit PIN. Generated with the CSPRNG, not Math.random. */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Run a command with the PIN passed via argv-free channels where possible.
 *
 * The PIN is short-lived and single-use, so argv exposure is a much smaller
 * concern than it is for a password — but `ps` is still readable by any process
 * on the box, so we prefer stdin where the tool supports it.
 */
function run(cmd: string, args: string[], stdin?: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'] })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin)
    }
  })
}

/**
 * Show `pin` on the host's desktop. Returns false if no channel worked — the
 * caller then REFUSES the operation.
 */
export async function notifyConsole(title: string, pin: string): Promise<boolean> {
  const body = `PIN: ${pin}`

  if (process.platform === 'darwin') {
    // A dialog, not a banner: a Notification Center banner can be suppressed by
    // Do Not Disturb / Focus and would silently deliver nothing — which, since
    // we fail closed on a false return, would look like a broken feature rather
    // than a blocked one. `display dialog` is modal and cannot be missed.
    //
    // The script is passed on stdin (osascript reads it) so the PIN never lands
    // in argv, where any process could read it out of `ps`.
    const script = `display dialog ${JSON.stringify(`${title}\n\n${body}`)} with title "AI Maestro" buttons {"OK"} default button 1 giving up after 120`
    if (await run('osascript', ['-'], script)) return true
    // Fall back to a banner if the dialog channel is unavailable (headless mac,
    // no WindowServer session). Still a real desktop delivery.
    const fallback = `display notification ${JSON.stringify(body)} with title "AI Maestro" subtitle ${JSON.stringify(title)}`
    return run('osascript', ['-'], fallback)
  }

  if (process.platform === 'linux') {
    // notify-send is the de-facto channel; zenity is the modal fallback.
    if (await run('notify-send', ['--urgency=critical', `AI Maestro — ${title}`, body])) return true
    return run('zenity', ['--info', `--title=AI Maestro — ${title}`, `--text=${body}`])
  }

  if (process.platform === 'win32') {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null;` +
      `[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] > $null;` +
      `$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1);` +
      `$t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode(${JSON.stringify(`AI Maestro — ${title}: ${body}`)})) > $null;` +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AI Maestro').Show([Windows.UI.Notifications.ToastNotification]::new($t));`
    if (await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], ps)) return true
    const msgbox = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(`${title}\n\n${body}`)}, 'AI Maestro') > $null;`
    return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], msgbox)
  }

  // Unknown platform ⇒ no console channel ⇒ fail closed.
  return false
}
