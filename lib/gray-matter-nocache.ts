/**
 * The options object EVERY `matter()` call in this repo must pass, and the reason is
 * memory, not parsing.
 *
 * THE DEFECT. gray-matter keeps a MODULE-LEVEL cache keyed by the full file text and
 * stores the parsed file including its `orig`:
 *
 *     const cached = matter.cache[file.content]
 *     if (!options) {
 *       if (cached) { ...return it... }
 *       // only cache if there are no options passed.
 *       matter.cache[file.content] = file
 *     }
 *                                     — gray-matter 4.0.3, index.js:35-47
 *
 * Nothing ever evicts it. So every markdown file the process parses is retained for the
 * life of that process, and memory tracks TOTAL BYTES EVER PARSED no matter how little
 * the caller keeps. In a CLI that is a bounded cost; in the long-lived AI Maestro server
 * it is an unbounded leak, because the corpora it parses are unbounded — every skill in
 * every marketplace it browses, every element of every plugin it converts.
 *
 * THE FIX. gray-matter skips the cache whenever ANY options object is passed (its own
 * comment: caching with options would mean caching option values too, negating the
 * benefit), and `defaults()` is `Object.assign({}, options)` — so `{}` is behaviourally
 * identical to passing nothing. This constant changes no parsing; it only declines to
 * leak.
 *
 * MEASURED, on the pillar corpus reader where it was found (TRDD-BQC8NQSW). Retaining
 * nothing but the frontmatter of 20 000 documents cost 456 MB with 10 KB bodies and
 * 104 MB with 1 KB bodies — IDENTICAL frontmatter, 4.4x the memory, because the cache
 * held the bodies. With this constant the retained heap is 35 MB on both. End to end, a
 * lint over 100 000 documents went from an OOM crash at 4.45 GB to a clean run at
 * 2.43 GB.
 *
 * DO NOT call `matter(x)` with one argument anywhere in this repo, and do not
 * "simplify" this argument away. `tests/unit/gray-matter-nocache.test.ts` fails if you
 * do — it is the only thing standing between a one-character edit and a leak nobody
 * would notice until a long-running server ran out of heap.
 */
export const NO_MATTER_CACHE: Record<string, never> = {}
