'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SearchResult, HighlightedSearchResult } from '@/types/search'

/**
 * Debounce delay for search queries (in milliseconds)
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Extract search terms from query for highlighting.
 * Removes common stop words and punctuation.
 * Pure helper — hoisted outside the hook to avoid recreation on every render.
 */
function extractSearchTerms(queryText: string): string[] {
  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2)

  const stopWords = new Set([
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again'
  ])

  return words.filter(word => !stopWords.has(word))
}

/**
 * Escape HTML entities to prevent XSS when injecting text into
 * highlighted HTML strings. Must be applied to every raw text
 * segment before concatenation with <mark> tags.
 * Pure helper — hoisted outside the hook to avoid recreation on every render.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Add highlighting to search results.
 * Uses optional chaining on result.text to guard against malformed API responses.
 * Pure helper — hoisted outside the hook to avoid recreation on every render.
 */
function highlightResults(
  searchResults: SearchResult[],
  highlightTerms: string[]
): HighlightedSearchResult[] {
  return searchResults.map((result) => {
    const text = result?.text ?? ''
    const highlightRanges: Array<{ start: number; end: number }> = []

    for (const term of highlightTerms) {
      const lowerText = text.toLowerCase()
      const lowerTerm = term.toLowerCase()
      let position = lowerText.indexOf(lowerTerm)

      while (position !== -1) {
        highlightRanges.push({ start: position, end: position + term.length })
        position = lowerText.indexOf(lowerTerm, position + term.length)
      }
    }

    highlightRanges.sort((a, b) => a.start - b.start)

    let highlightedText = ''
    let lastIndex = 0

    for (const range of highlightRanges) {
      // Escape non-highlighted text to prevent XSS injection
      highlightedText += escapeHtml(text.substring(lastIndex, range.start))
      highlightedText += `<mark>${escapeHtml(text.substring(range.start, range.end))}</mark>`
      lastIndex = range.end
    }

    // Escape trailing text as well
    highlightedText += escapeHtml(text.substring(lastIndex))

    return {
      ...result,
      highlightedText,
      highlightRanges
    }
  })
}

/**
 * Interface for search results with highlighting
 */
export interface SearchResults {
  results: HighlightedSearchResult[]
  total: number
  query: string
  highlights: string[]
  timestamp: number
}

/**
 * Hook for searching agent conversation data
 *
 * Provides debounced search, results management, and error handling
 * for searching across agent messages, conversations, and code.
 *
 * @param agentId - Agent ID to search within
 */
export function useAgentSearch(agentId: string) {
  const [query, setQuery] = useState<string>('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState<string>('')

  // Ref to track debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout>()

  // Ref to track if component is mounted (for async operations)
  const isMountedRef = useRef(true)

  // AbortController ref to cancel in-flight fetches when a newer query arrives,
  // preventing stale results from overwriting fresher ones.
  const abortControllerRef = useRef<AbortController | null>(null)

  // UI2-MIN-04: short-circuit re-fetches when the user re-submits the same
  // query string (e.g. typing then deleting then re-typing the same word
  // mid-debounce, or re-submitting via Enter without changing input). The
  // debounce protects against keystroke storms; this protects against the
  // edge case where debounce-fire is identical to the last completed query.
  const lastFetchedQueryRef = useRef<string | null>(null)

  // Properly track mount/unmount lifecycle so isMountedRef guards in
  // performSearch actually prevent state updates after unmount.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Abort any in-flight fetch on unmount
      abortControllerRef.current?.abort()
    }
  }, [])

  /**
   * Perform search with the current debounced query
   */
  const performSearch = useCallback(async (searchQuery: string) => {
    // Abort previous in-flight request so stale results never land
    abortControllerRef.current?.abort()

    if (!searchQuery.trim()) {
      setResults(null)
      setLoading(false)
      setError(null)
      lastFetchedQueryRef.current = null
      return
    }

    // UI2-MIN-04: skip the fetch if the query exactly matches the last one
    // we've already fetched — prevents duplicate backend calls from
    // setQuery('a') / setQuery('a') re-triggers.
    if (lastFetchedQueryRef.current === searchQuery) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    setError(null)

    try {
      console.log(`[useAgentSearch] Searching for: "${searchQuery}" in agent ${agentId}`)

      const queryParams = new URLSearchParams({
        q: searchQuery
      })

      const response = await fetch(
        `/api/agents/${agentId}/search?${queryParams.toString()}`,
        { signal: controller.signal }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // Runtime validation: ensure the response has the expected shape
      if (!data || !Array.isArray(data.results)) {
        throw new Error('Invalid search response')
      }

      if (!isMountedRef.current) return

      const searchResults: HighlightedSearchResult[] = data.results
      const searchTerms = extractSearchTerms(searchQuery)
      const highlightedResults = highlightResults(searchResults, searchTerms)

      setResults({
        results: highlightedResults,
        total: data.count || highlightedResults.length,
        query: searchQuery,
        highlights: searchTerms,
        timestamp: Date.now()
      })
      // UI2-MIN-04: remember the last successfully-completed query so a
      // resubmit short-circuits before incurring another backend call.
      lastFetchedQueryRef.current = searchQuery

      console.log(`[useAgentSearch] Found ${data.count} results for query "${searchQuery}"`)
    } catch (err) {
      // Silently ignore aborted requests — a newer query superseded this one
      if (err instanceof DOMException && err.name === 'AbortError') return

      if (!isMountedRef.current) return

      console.error('[useAgentSearch] Search failed:', err)
      setError(err instanceof Error ? err : new Error('Unknown search error'))
      setResults(null)
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [agentId])

  /**
   * Update search query with debouncing
   */
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [query])

  /**
   * Perform search when debounced query changes
   */
  useEffect(() => {
    performSearch(debouncedQuery)
  }, [debouncedQuery, performSearch])

  /**
   * Clear search results and query
   */
  const clearSearch = useCallback(() => {
    setQuery('')
    setResults(null)
    setError(null)
    setLoading(false)
  }, [])

  /**
   * Retry the last search
   */
  const retrySearch = useCallback(() => {
    if (debouncedQuery) {
      performSearch(debouncedQuery)
    }
  }, [debouncedQuery, performSearch])

  return {
    // State
    query,
    results,
    loading,
    error,

    // Actions
    setQuery,
    clearSearch,
    retrySearch
  }
}
