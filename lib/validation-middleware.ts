import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Record<string, string> },
) => Promise<NextResponse> | NextResponse

export function withValidation<T extends z.ZodTypeAny>(
  schema: T,
  handler: (
    req: NextRequest,
    body: z.infer<T>,
    ctx: { params: Record<string, string> },
  ) => Promise<NextResponse> | NextResponse,
): RouteHandler {
  return async (req: NextRequest, ctx: { params: Record<string, string> }) => {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      )
    }

    const result = schema.safeParse(raw)
    if (!result.success) {
      const issues = result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      return NextResponse.json(
        { error: 'Validation failed', issues },
        { status: 400 },
      )
    }

    return handler(req, result.data, ctx)
  }
}

export function withQueryValidation<T extends z.ZodTypeAny>(
  schema: T,
  handler: (
    req: NextRequest,
    query: z.infer<T>,
    ctx: { params: Record<string, string> },
  ) => Promise<NextResponse> | NextResponse,
): RouteHandler {
  return async (req: NextRequest, ctx: { params: Record<string, string> }) => {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const result = schema.safeParse(params)
    if (!result.success) {
      const issues = result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      return NextResponse.json(
        { error: 'Validation failed', issues },
        { status: 400 },
      )
    }

    return handler(req, result.data, ctx)
  }
}
