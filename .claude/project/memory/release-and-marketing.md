---
name: release-and-marketing
description: "do I need to draft an X twitter post when opening a PR / where do marketing files go / marketing folder gitignored / X post template for a release / PR creation checklist marketing"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

# release-and-marketing

Every PR to main pairs with a draft X (Twitter) post, and all marketing content is written
into a single gitignored `marketing/` folder — never the project root.

### Pull Request Protocol

**IMPORTANT:** Every time you create a Pull Request to main, also draft an X (Twitter) post to
announce the release.

**PR Creation Checklist:**
1. ✅ **VERSION BUMPED** (see the Pre-PR Checklist — this should already be done)
2. Create PR with comprehensive description (summary, features, bug fixes, breaking changes)
3. Draft X post highlighting key features and improvements
4. Include release notes or link to PR in the post
5. Use relevant hashtags: #AIcoding #DevTools #OpenSource
6. Consider adding screenshots/GIFs for visual features
7. Post during peak hours (9-11am or 1-3pm EST)

**X Post Template:**
```
[Emoji] Shipping [Feature Name] today!

Key improvements:
• [Feature 1]
• [Feature 2]
• [Feature 3]

[Call to action - Star/Try/Share]
[Link to PR or GitHub]

#AIcoding #DevTools
```

**Examples:**
- Major release: "Shipping AI Maestro v0.3.3! 🚀"
- Feature addition: "New feature: SSH configuration for tmux 🔐"
- Bug fixes: "Squashed bugs and improved stability 🐛"

Keep posts concise (<280 chars when possible), engaging, and focused on user benefits rather
than technical implementation.

### Marketing Content Location

**IMPORTANT:** All marketing content files MUST be created in the `marketing/` folder:

```
marketing/
  medium-article.md      # Blog posts for Medium
  linkedin-post.md       # LinkedIn content
  x-post.md              # X/Twitter posts
  findings.md            # Research notes (planning skill)
  task_plan.md           # Task tracking (planning skill)
  progress.md            # Progress logs (planning skill)
```

- The `marketing/` folder is gitignored - content is deleted after publishing
- Never create these files in the project root
- When using the planning skill for marketing tasks, set the output directory to `marketing/`

## See also


^ATOM-PTK5-9364 [desc:"git-cliff release notes copy commit subjects verbatim — a bare @word in a subject pages a real account from the release body", keywords: release_notes_paged_someone changelog_mention_notification git-cliff_commit_subject_at-mention release_body_linkifies, ocd: 2026-08-08, lmd: 2026-08-08]

Release notes built by git-cliff copy commit SUBJECTS verbatim into the CHANGELOG, and the
canonical pipeline uses that section as the GitHub RELEASE BODY — where a word-boundary `@word`
linkifies and PAGES a live account. Commits about the anti-paging rule itself are the most
likely carriers. Durable fix: a `cliff.toml` postprocessor backticking word-boundary `@word`
(a hand edit of CHANGELOG.md is undone by the next git-cliff run). Found by the assistant-role
session at its v0.3.3 release; filed for the canonical template as CPV#202.

## Notes and lessons learned
