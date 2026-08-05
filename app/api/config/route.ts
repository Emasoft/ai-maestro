import { NextResponse } from 'next/server'
import { getSystemConfig } from '@/services/config-service'

// Every one of the five fields getSystemConfig() returns is read at request time, so a cached body
// is wrong in all five: `version` is an fs read of version.json (which scripts/bump-version.sh
// rewrites on every release), `loggingEnabled` and `port` come from process.env, `platform` from
// os.platform(), and `nodeVersion` from process.version.
//
// `nodeVersion` is the one that would mislead worst. Node 22 is a hard ABI constraint here
// (node-pty is built for NODE_MODULE_VERSION 127), so this field exists to answer "what is the
// server ACTUALLY running on" — and cached it answers "what built the bundle", which is the one
// answer that cannot diagnose an ABI mismatch. The env fields fail the same way for a different
// reason: `pm2 restart ecosystem.config.js --update-env` changes them WITHOUT a rebuild, so a
// static body reports the env of some earlier build indefinitely.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = getSystemConfig()
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Config] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
