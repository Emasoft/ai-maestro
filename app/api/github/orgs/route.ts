import { NextResponse } from 'next/server'
import { listOrgs } from '@/lib/github-cli'

// listOrgs() shells out to `gh api /user/orgs`, so this response is a function of two pieces of
// live external state: the GitHub account's current org membership, and whether the `gh` CLI on
// THIS host is authenticated. Neither is knowable at build time — the build machine may have no
// gh auth at all, in which case the cached body is a frozen 500 that no amount of logging in
// afterwards can clear. Joining or leaving an org would likewise never surface until a rebuild.
export const dynamic = 'force-dynamic'

// GET /api/github/orgs — List organizations
export async function GET() {
  try {
    const orgs = await listOrgs()
    return NextResponse.json({ orgs })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to list orgs: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
