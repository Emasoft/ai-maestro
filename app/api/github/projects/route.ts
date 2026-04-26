import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { listProjects, createProject, validateProjectUrl, hasProjectScope } from '@/lib/github-cli'

// GET /api/github/projects — List projects or validate a project URL
export async function GET(request: NextRequest) {
  try {
    if (!hasProjectScope()) {
      return NextResponse.json(
        { error: 'Missing GitHub project scope. Run: gh auth refresh -s project' },
        { status: 403 }
      )
    }

    const validateUrl = request.nextUrl.searchParams.get('validate')
    if (validateUrl) {
      // Defense-in-depth: validate URL format before passing to shell-backed function
      try {
        new URL(validateUrl)
      } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
      }
      const result = validateProjectUrl(validateUrl)
      return NextResponse.json(result)
    }

    const owner = request.nextUrl.searchParams.get('owner')
    if (!owner) {
      return NextResponse.json({ error: 'owner query parameter is required' }, { status: 400 })
    }
    // Defense-in-depth: validate owner format before passing to shell-backed function
    if (!/^[a-zA-Z0-9-]+$/.test(owner)) {
      return NextResponse.json({ error: 'Invalid owner — only alphanumeric and hyphens allowed' }, { status: 400 })
    }
    const projects = listProjects(owner)
    return NextResponse.json({ projects })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// POST /api/github/projects — Create a new project
export async function POST(request: NextRequest) {
  // #114: System-owner only — blocks agent tokens.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    if (!hasProjectScope()) {
      return NextResponse.json(
        { error: 'Missing GitHub project scope. Run: gh auth refresh -s project' },
        { status: 403 }
      )
    }
    const { owner, title } = await request.json()
    if (!owner || !title) {
      return NextResponse.json({ error: 'owner and title are required' }, { status: 400 })
    }
    // Defense-in-depth: validate owner format before passing to shell-backed function
    if (!/^[a-zA-Z0-9-]+$/.test(owner)) {
      return NextResponse.json({ error: 'Invalid owner — only alphanumeric and hyphens allowed' }, { status: 400 })
    }
    const project = createProject(owner, title)
    return NextResponse.json({ project })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to create project: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
