/**
 * File system utilities for the converter library.
 * All async. Ported from crucible's utils/fs.js + acplugin's utils/fs.ts.
 */

import fs from 'fs/promises'
import path from 'path'

/** Ensure a directory exists, creating it recursively if needed */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/** Read a file as UTF-8, returning null if it doesn't exist */
export async function readFileOr(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    // File exists but is corrupted or unreadable — caller must know
    console.error(`[converter/fs] readFileOr failed for ${filePath}:`, error?.message)
    throw error
  }
}

/** List directory entries (files and dirs), returning empty array if dir doesn't exist */
export async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    console.error(`[converter/fs] listDir failed for ${dirPath}:`, error?.message)
    throw error
  }
}

/** List only subdirectories in a directory */
export async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    console.error(`[converter/fs] listDirs failed for ${dirPath}:`, error?.message)
    throw error
  }
}

/** List only files in a directory */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isFile()).map(e => e.name)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    console.error(`[converter/fs] listFiles failed for ${dirPath}:`, error?.message)
    throw error
  }
}

/**
 * Recursively list all files in a directory tree.
 * Returns paths relative to the given root directory.
 * Excludes hidden files/dirs (starting with .).
 */
export async function listFilesRecursive(dirPath: string, relativeTo?: string): Promise<string[]> {
  const root = relativeTo || dirPath
  const results: string[] = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, root)
        results.push(...subFiles)
      } else {
        results.push(path.relative(root, fullPath))
      }
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.error(`[converter/fs] listFilesRecursive failed for ${dirPath}:`, error?.message)
      throw error
    }
  }

  return results
}

/** Check if a file exists */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/** Write a file, creating parent directories as needed */
export async function writeFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, content, 'utf-8')
}

/** Recursively copy a directory tree.
 *  Throws on unexpected errors; returns silently when src does not exist (ENOENT)
 *  so callers that copy optional directories don't need to pre-check. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest)

  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(src, { withFileTypes: true })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    // Source directory missing — nothing to copy
    if (code === 'ENOENT') return
    // Permission denied — surface a clear message
    if (code === 'EACCES') {
      throw new Error(`copyDir: permission denied reading source directory: ${src}`)
    }
    throw err
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      try {
        await fs.copyFile(srcPath, destPath)
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        // File removed between readdir and copyFile — skip it
        if (code === 'ENOENT') continue
        // Permission denied — surface a clear message
        if (code === 'EACCES') {
          throw new Error(`copyDir: permission denied copying ${srcPath} → ${destPath}`)
        }
        throw err
      }
    }
  }
}
