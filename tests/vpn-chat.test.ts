/**
 * Tests for VPN Global Chatroom backend (Phase A + B)
 *
 * Covers:
 * - types/human-directory.ts — HumanEntry, HumanDirectoryFile
 * - types/vpn-chat.ts — ChatMessage, BlocklistFile
 * - lib/human-directory.ts — CRUD for humans.json
 * - lib/vpn-chat-log.ts — append-only .jsonl chat log
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let TEST_DIR: string

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-chat-test-'))
})

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================================================
// Phase A: Human Directory Types
// ============================================================================

describe('types/human-directory', () => {
  it('HumanEntry has all required fields', async () => {
    /** Verify HumanEntry interface has hostId, displayName, tailscaleIp, lastSeen, status */
    const { isValidHumanEntry } = await import('@/types/human-directory')
    const valid = {
      id: 'emanuele@macbook-pro',
      hostId: 'macbook-pro',
      displayName: 'Emanuele',
      tailscaleIp: '100.64.1.2',
      lastSeen: '2026-04-11T18:32:17Z',
      status: 'online' as const,
    }
    expect(isValidHumanEntry(valid)).toBe(true)
  })

  it('rejects HumanEntry with missing required fields', async () => {
    /** Reject entries missing hostId or displayName */
    const { isValidHumanEntry } = await import('@/types/human-directory')
    expect(isValidHumanEntry({ id: 'x', hostId: '' })).toBe(false)
    expect(isValidHumanEntry({ id: 'x', displayName: '' })).toBe(false)
    expect(isValidHumanEntry(null)).toBe(false)
    expect(isValidHumanEntry(undefined)).toBe(false)
  })

  it('rejects HumanEntry with invalid status', async () => {
    /** Only online/offline/away are valid status values */
    const { isValidHumanEntry } = await import('@/types/human-directory')
    const bad = {
      id: 'test@host',
      hostId: 'host',
      displayName: 'Test',
      tailscaleIp: '100.64.1.1',
      lastSeen: new Date().toISOString(),
      status: 'invalid-status',
    }
    expect(isValidHumanEntry(bad)).toBe(false)
  })
})

// ============================================================================
// Phase A: Human Directory CRUD
// ============================================================================

describe('lib/human-directory', () => {
  it('loadHumans returns empty array when file does not exist', async () => {
    /** Loading from nonexistent file should not throw, returns empty */
    const mod = await import('@/lib/human-directory')
    const result = mod.loadHumans(TEST_DIR)
    expect(result).toEqual([])
  })

  it('upsertHuman creates a new entry and persists it', async () => {
    /** Upserting a new human should write to disk and be loadable */
    const mod = await import('@/lib/human-directory')
    const entry = {
      id: 'alice@laptop',
      hostId: 'laptop',
      displayName: 'Alice',
      tailscaleIp: '100.64.2.3',
      lastSeen: new Date().toISOString(),
      status: 'online' as const,
    }
    mod.upsertHuman(entry, TEST_DIR)
    const humans = mod.loadHumans(TEST_DIR)
    expect(humans).toHaveLength(1)
    expect(humans[0].id).toBe('alice@laptop')
    expect(humans[0].displayName).toBe('Alice')
  })

  it('upsertHuman updates an existing entry by id', async () => {
    /** Second upsert with same id should update, not duplicate */
    const mod = await import('@/lib/human-directory')
    const entry = {
      id: 'bob@desktop',
      hostId: 'desktop',
      displayName: 'Bob',
      tailscaleIp: '100.64.3.4',
      lastSeen: '2026-04-10T10:00:00Z',
      status: 'online' as const,
    }
    mod.upsertHuman(entry, TEST_DIR)
    mod.upsertHuman({ ...entry, displayName: 'Bobby', lastSeen: '2026-04-11T12:00:00Z' }, TEST_DIR)
    const humans = mod.loadHumans(TEST_DIR)
    expect(humans).toHaveLength(1)
    expect(humans[0].displayName).toBe('Bobby')
    expect(humans[0].lastSeen).toBe('2026-04-11T12:00:00Z')
  })

  it('getHuman returns null for unknown id', async () => {
    /** Getting a nonexistent human returns null, not undefined */
    const mod = await import('@/lib/human-directory')
    const result = mod.getHuman('nonexistent@host', TEST_DIR)
    expect(result).toBeNull()
  })

  it('getHuman returns the entry for a known id', async () => {
    /** Getting an existing human returns the full entry */
    const mod = await import('@/lib/human-directory')
    const entry = {
      id: 'carol@server',
      hostId: 'server',
      displayName: 'Carol',
      tailscaleIp: '100.64.5.6',
      lastSeen: new Date().toISOString(),
      status: 'offline' as const,
    }
    mod.upsertHuman(entry, TEST_DIR)
    const found = mod.getHuman('carol@server', TEST_DIR)
    expect(found).not.toBeNull()
    expect(found!.displayName).toBe('Carol')
  })

  it('saveHumans uses atomic write (tmp + rename)', async () => {
    /** After save, no .tmp files should remain — atomic write pattern */
    const mod = await import('@/lib/human-directory')
    mod.upsertHuman({
      id: 'dave@mini',
      hostId: 'mini',
      displayName: 'Dave',
      tailscaleIp: '100.64.7.8',
      lastSeen: new Date().toISOString(),
      status: 'online' as const,
    }, TEST_DIR)
    const files = fs.readdirSync(TEST_DIR)
    const tmpFiles = files.filter(f => f.includes('.tmp.'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('loadHumans handles corrupted JSON gracefully', async () => {
    /** If the file is corrupted, return empty rather than throw */
    const mod = await import('@/lib/human-directory')
    const humansFile = path.join(TEST_DIR, 'humans.json')
    fs.mkdirSync(TEST_DIR, { recursive: true })
    fs.writeFileSync(humansFile, '{{{{not valid json', 'utf-8')
    const result = mod.loadHumans(TEST_DIR)
    expect(result).toEqual([])
  })

  it('file permissions are 0o600 (owner-only)', async () => {
    /** Security: humans.json should not be world-readable */
    const mod = await import('@/lib/human-directory')
    mod.upsertHuman({
      id: 'eve@host',
      hostId: 'host',
      displayName: 'Eve',
      tailscaleIp: '100.64.9.10',
      lastSeen: new Date().toISOString(),
      status: 'online' as const,
    }, TEST_DIR)
    const humansFile = path.join(TEST_DIR, 'humans.json')
    const stat = fs.statSync(humansFile)
    expect(stat.mode & 0o777).toBe(0o600)
  })
})

// ============================================================================
// Phase B: Chat Message Types
// ============================================================================

describe('types/vpn-chat', () => {
  it('ChatMessage has all required fields', async () => {
    /** Verify ChatMessage interface shape */
    const { isValidChatMessage } = await import('@/types/vpn-chat')
    const valid = {
      id: '01HYZ123ABC',
      senderHostId: 'macbook-pro',
      senderName: 'Emanuele',
      content: 'Hello world',
      timestamp: '2026-04-11T18:32:17.123Z',
      type: 'text' as const,
    }
    expect(isValidChatMessage(valid)).toBe(true)
  })

  it('rejects messages with empty content', async () => {
    /** Empty string content is invalid */
    const { isValidChatMessage } = await import('@/types/vpn-chat')
    const bad = {
      id: 'msg-1',
      senderHostId: 'host',
      senderName: 'Test',
      content: '',
      timestamp: new Date().toISOString(),
      type: 'text' as const,
    }
    expect(isValidChatMessage(bad)).toBe(false)
  })

  it('rejects messages with content exceeding 4096 chars', async () => {
    /** Content must be at most 4096 characters */
    const { isValidChatMessage } = await import('@/types/vpn-chat')
    const bad = {
      id: 'msg-2',
      senderHostId: 'host',
      senderName: 'Test',
      content: 'x'.repeat(4097),
      timestamp: new Date().toISOString(),
      type: 'text' as const,
    }
    expect(isValidChatMessage(bad)).toBe(false)
  })

  it('accepts system type messages', async () => {
    /** System messages (join/leave notices) are valid */
    const { isValidChatMessage } = await import('@/types/vpn-chat')
    const sys = {
      id: 'msg-3',
      senderHostId: 'system',
      senderName: 'System',
      content: 'Alice joined the chatroom',
      timestamp: new Date().toISOString(),
      type: 'system' as const,
    }
    expect(isValidChatMessage(sys)).toBe(true)
  })
})

// ============================================================================
// Phase B: Chat Log (append-only .jsonl)
// ============================================================================

describe('lib/vpn-chat-log', () => {
  it('appendMessage writes a line to the daily .jsonl file', async () => {
    /** Each message becomes one JSON line in the day file */
    const mod = await import('@/lib/vpn-chat-log')
    const msg = {
      id: 'msg-append-1',
      senderHostId: 'host-a',
      senderName: 'Alice',
      content: 'Hello everyone',
      timestamp: '2026-04-11T18:32:17.123Z',
      type: 'text' as const,
    }
    mod.appendMessage(msg, TEST_DIR)
    const messages = mod.getMessages(50, undefined, TEST_DIR)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Hello everyone')
  })

  it('getMessages returns messages in chronological order', async () => {
    /** Messages should come back oldest-first */
    const mod = await import('@/lib/vpn-chat-log')
    const msgs = [
      { id: 'm1', senderHostId: 'h', senderName: 'A', content: 'First', timestamp: '2026-04-11T10:00:00Z', type: 'text' as const },
      { id: 'm2', senderHostId: 'h', senderName: 'B', content: 'Second', timestamp: '2026-04-11T10:01:00Z', type: 'text' as const },
      { id: 'm3', senderHostId: 'h', senderName: 'C', content: 'Third', timestamp: '2026-04-11T10:02:00Z', type: 'text' as const },
    ]
    for (const m of msgs) mod.appendMessage(m, TEST_DIR)
    const result = mod.getMessages(50, undefined, TEST_DIR)
    expect(result.map(r => r.content)).toEqual(['First', 'Second', 'Third'])
  })

  it('getMessages respects limit parameter', async () => {
    /** Requesting limit=2 should return only the 2 most recent messages */
    const mod = await import('@/lib/vpn-chat-log')
    for (let i = 0; i < 5; i++) {
      mod.appendMessage({
        id: `lim-${i}`,
        senderHostId: 'h',
        senderName: 'X',
        content: `Message ${i}`,
        timestamp: `2026-04-11T10:0${i}:00Z`,
        type: 'text' as const,
      }, TEST_DIR)
    }
    const result = mod.getMessages(2, undefined, TEST_DIR)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Message 3')
    expect(result[1].content).toBe('Message 4')
  })

  it('getMessages supports cursor-based pagination with before parameter', async () => {
    /** Passing before=timestamp returns only messages before that time */
    const mod = await import('@/lib/vpn-chat-log')
    const msgs = [
      { id: 'p1', senderHostId: 'h', senderName: 'A', content: 'Old', timestamp: '2026-04-11T08:00:00Z', type: 'text' as const },
      { id: 'p2', senderHostId: 'h', senderName: 'B', content: 'Middle', timestamp: '2026-04-11T09:00:00Z', type: 'text' as const },
      { id: 'p3', senderHostId: 'h', senderName: 'C', content: 'New', timestamp: '2026-04-11T10:00:00Z', type: 'text' as const },
    ]
    for (const m of msgs) mod.appendMessage(m, TEST_DIR)
    const result = mod.getMessages(50, '2026-04-11T10:00:00Z', TEST_DIR)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.content)).toEqual(['Old', 'Middle'])
  })

  it('getMessageCount returns total number of messages', async () => {
    /** Count should match the number of appended messages */
    const mod = await import('@/lib/vpn-chat-log')
    for (let i = 0; i < 3; i++) {
      mod.appendMessage({
        id: `cnt-${i}`,
        senderHostId: 'h',
        senderName: 'X',
        content: `Msg ${i}`,
        timestamp: `2026-04-11T10:0${i}:00Z`,
        type: 'text' as const,
      }, TEST_DIR)
    }
    expect(mod.getMessageCount(TEST_DIR)).toBe(3)
  })

  it('daily rotation creates files per date', async () => {
    /** Messages from different dates go to different .jsonl files */
    const mod = await import('@/lib/vpn-chat-log')
    mod.appendMessage({
      id: 'day1',
      senderHostId: 'h',
      senderName: 'A',
      content: 'Day one',
      timestamp: '2026-04-10T12:00:00Z',
      type: 'text' as const,
    }, TEST_DIR)
    mod.appendMessage({
      id: 'day2',
      senderHostId: 'h',
      senderName: 'A',
      content: 'Day two',
      timestamp: '2026-04-11T12:00:00Z',
      type: 'text' as const,
    }, TEST_DIR)
    const chatDir = path.join(TEST_DIR, 'vpn-chat')
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'))
    expect(files.length).toBe(2)
    expect(files.some(f => f.includes('2026-04-10'))).toBe(true)
    expect(files.some(f => f.includes('2026-04-11'))).toBe(true)
  })

  it('getMessages reads across day boundaries', async () => {
    /** Pagination should cross daily file boundaries seamlessly */
    const mod = await import('@/lib/vpn-chat-log')
    mod.appendMessage({
      id: 'cross1',
      senderHostId: 'h',
      senderName: 'A',
      content: 'Yesterday',
      timestamp: '2026-04-10T23:59:00Z',
      type: 'text' as const,
    }, TEST_DIR)
    mod.appendMessage({
      id: 'cross2',
      senderHostId: 'h',
      senderName: 'A',
      content: 'Today',
      timestamp: '2026-04-11T00:01:00Z',
      type: 'text' as const,
    }, TEST_DIR)
    const result = mod.getMessages(50, undefined, TEST_DIR)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Yesterday')
    expect(result[1].content).toBe('Today')
  })

  it('handles empty log directory gracefully', async () => {
    /** getMessages on empty/missing dir returns empty array */
    const mod = await import('@/lib/vpn-chat-log')
    const result = mod.getMessages(50, undefined, TEST_DIR)
    expect(result).toEqual([])
    expect(mod.getMessageCount(TEST_DIR)).toBe(0)
  })
})

// ============================================================================
// Phase B: Blocklist
// ============================================================================

describe('lib/vpn-chat-log blocklist', () => {
  it('addBlock adds an id to the local blocklist', async () => {
    /** Blocking a user persists to blocklist.json */
    const mod = await import('@/lib/vpn-chat-log')
    mod.addBlock('alice@laptop', TEST_DIR)
    const blocked = mod.getBlocklist(TEST_DIR)
    expect(blocked).toContain('alice@laptop')
  })

  it('addBlock is idempotent (no duplicates)', async () => {
    /** Blocking the same user twice should not create duplicates */
    const mod = await import('@/lib/vpn-chat-log')
    mod.addBlock('bob@desktop', TEST_DIR)
    mod.addBlock('bob@desktop', TEST_DIR)
    const blocked = mod.getBlocklist(TEST_DIR)
    expect(blocked.filter(b => b === 'bob@desktop')).toHaveLength(1)
  })

  it('removeBlock removes an id from the blocklist', async () => {
    /** Unblocking removes the entry */
    const mod = await import('@/lib/vpn-chat-log')
    mod.addBlock('carol@server', TEST_DIR)
    mod.removeBlock('carol@server', TEST_DIR)
    const blocked = mod.getBlocklist(TEST_DIR)
    expect(blocked).not.toContain('carol@server')
  })

  it('removeBlock on non-blocked id is a no-op', async () => {
    /** Removing a user who is not blocked should not throw */
    const mod = await import('@/lib/vpn-chat-log')
    expect(() => mod.removeBlock('nobody@nowhere', TEST_DIR)).not.toThrow()
  })

  it('getBlocklist returns empty array when no blocklist exists', async () => {
    /** Fresh directory has no blocklist */
    const mod = await import('@/lib/vpn-chat-log')
    const blocked = mod.getBlocklist(TEST_DIR)
    expect(blocked).toEqual([])
  })
})
