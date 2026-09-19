import type { BookFileRef } from '@bookorbit/types'

export const READ_ALONG_FORMAT_TITLE = 'Read-along EPUB'
export const READ_ALONG_FORMAT_COLOR = '#0f766e'

export type ReadAlongFile = Pick<BookFileRef, 'format' | 'mediaOverlay'> | null | undefined

export function hasReadAlong(file: ReadAlongFile): boolean {
  return file?.format?.toLowerCase() === 'epub' && file.mediaOverlay?.available === true
}

export function hasAnyReadAlong(files: readonly ReadAlongFile[] | null | undefined): boolean {
  return files?.some((file) => hasReadAlong(file)) ?? false
}

export function isReadAlongFormat(format: string | null | undefined, available: boolean): boolean {
  return available && format?.toLowerCase() === 'epub'
}
