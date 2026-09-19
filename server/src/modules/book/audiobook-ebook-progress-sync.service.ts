import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';

import type { EpubMediaOverlayPlaylist, EpubMediaOverlayPlaylistItem } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { buildEpubMediaOverlayPlaylistFromFile } from '../reader/epub/epub-media-overlay';
import { BookRepository } from './book.repository';

const EVENT = 'book.audio_ebook_progress_sync';
const REVERSE_EVENT = 'book.ebook_audio_progress_sync';
const PLAYLIST_CACHE_MAX = 12;
const MAX_DURATION_DIFF_RATIO = 0.05;
const MAX_DURATION_DIFF_SECONDS = 300;

type SyncFilesResult = NonNullable<Awaited<ReturnType<BookRepository['findAudioEbookProgressSyncFiles']>>>;
type SyncFile = SyncFilesResult['files'][number];

type PlaylistCacheEntry = {
  absolutePath: string;
  mtimeMs: number;
  playlist: EpubMediaOverlayPlaylist;
  lastAccessed: number;
};

type SyncResolution = {
  targetFile: SyncFile;
  cfi: string;
  koreaderProgress: string | null;
  percentage: number;
  positionSeconds: number;
  mediaOverlayFragment: string;
  mediaOverlaySectionIndex: number;
};

type AudioProgressResolution = {
  currentFileId: number;
  positionSeconds: number;
  percentage: number;
};

@Injectable()
export class AudiobookEbookProgressSyncService {
  private readonly logger = new Logger(AudiobookEbookProgressSyncService.name);
  private readonly playlistCache = new Map<number, PlaylistCacheEntry>();

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly positionConverter: PositionConverterService,
  ) {}

  async syncFromAudioProgress(params: {
    userId: number;
    bookId: number;
    currentFileId: number;
    positionSeconds: number;
    percentage: number;
    syncKobo: boolean;
  }): Promise<boolean> {
    const startedAt = Date.now();
    try {
      if ((await this.bookRepo.findReadAloudSyncMode(params.userId, params.bookId)) === 'disabled') return false;

      const resolution = await this.resolveProgress(params);
      if (!resolution) return false;

      await this.bookRepo.upsertProgress(
        params.userId,
        resolution.targetFile.id,
        resolution.cfi,
        null,
        resolution.percentage,
        resolution.positionSeconds,
        resolution.mediaOverlayFragment,
        resolution.mediaOverlaySectionIndex,
        null,
        null,
        null,
        null,
        resolution.koreaderProgress,
      );

      if (params.syncKobo) {
        await this.bookRepo.syncKoboReadingStateFromProgress(params.userId, resolution.targetFile.id, resolution.percentage, null, null, null, null);
      }

      return true;
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} currentFileId=${params.currentFileId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - audiobook to ebook progress sync failed`,
      );
      return false;
    }
  }

  async syncFromEbookProgress(params: {
    userId: number;
    bookId: number;
    bookFileId: number;
    percentage: number;
    cfi?: string | null;
    koreaderProgress?: string | null;
    positionSeconds?: number | null;
    mediaOverlayFragment?: string | null;
    mediaOverlaySectionIndex?: number | null;
  }): Promise<boolean> {
    const startedAt = Date.now();
    try {
      if ((await this.bookRepo.findReadAloudSyncMode(params.userId, params.bookId)) === 'disabled') return false;

      const resolution = await this.resolveAudioProgress(params);
      if (!resolution) return false;

      await this.bookRepo.upsertAudioProgress(
        params.userId,
        params.bookId,
        resolution.currentFileId,
        resolution.positionSeconds,
        resolution.percentage,
      );
      return true;
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${REVERSE_EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} bookFileId=${params.bookFileId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - ebook to audiobook progress sync failed`,
      );
      return false;
    }
  }

  private async resolveProgress(params: {
    bookId: number;
    currentFileId: number;
    positionSeconds: number;
    percentage: number;
  }): Promise<SyncResolution | null> {
    const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
    if (!syncFiles) return null;

    const audioFiles = syncFiles.files.filter((file) => typeof file.format === 'string' && isAudioFormat(file.format));
    const currentAudioIndex = audioFiles.findIndex((file) => file.id === params.currentFileId);
    if (currentAudioIndex < 0) return null;

    const overlaySourceFile = this.selectOverlaySourceFile(syncFiles.files, syncFiles.primaryFileId);
    if (!overlaySourceFile) return null;

    const targetFile = this.selectTargetFile(syncFiles.files, syncFiles.primaryFileId, overlaySourceFile);
    const audioAbsoluteSeconds = this.computeAudioAbsoluteSeconds(audioFiles, currentAudioIndex, params.positionSeconds);
    const audioTotalSeconds = this.computeAudioTotalSeconds(audioFiles);
    if (audioAbsoluteSeconds === null || audioTotalSeconds === null) return null;

    const playlist = await this.getPlaylist(overlaySourceFile, params.bookId);
    if (playlist.items.length === 0 || playlist.durationSeconds == null || playlist.durationSeconds <= 0) return null;

    const overlaySeconds = this.mapAudioSecondsToOverlaySeconds(audioAbsoluteSeconds, audioTotalSeconds, playlist.durationSeconds);
    if (overlaySeconds === null) return null;

    const item = this.findItemBySeconds(playlist, overlaySeconds);
    if (!item?.textFragment) return null;

    const targetPositions = await this.resolveFragmentPositions(targetFile, item);
    const resolved =
      targetPositions ?? (targetFile.id !== overlaySourceFile.id ? await this.resolveFragmentPositions(overlaySourceFile, item) : null);
    if (!resolved) return null;

    return {
      targetFile: resolved.targetFile,
      cfi: resolved.cfi,
      koreaderProgress: resolved.koreaderProgress,
      percentage: this.clampPercentage((overlaySeconds / playlist.durationSeconds) * 100),
      positionSeconds: overlaySeconds,
      mediaOverlayFragment: this.itemFragment(item),
      mediaOverlaySectionIndex: item.sectionIndex,
    };
  }

  private async resolveAudioProgress(params: {
    bookId: number;
    bookFileId: number;
    cfi?: string | null;
    koreaderProgress?: string | null;
    positionSeconds?: number | null;
    mediaOverlayFragment?: string | null;
    mediaOverlaySectionIndex?: number | null;
  }): Promise<AudioProgressResolution | null> {
    const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
    if (!syncFiles) return null;

    const ebookFile = syncFiles.files.find((file) => file.id === params.bookFileId && file.format?.toLowerCase() === 'epub');
    if (!ebookFile) return null;

    const overlaySourceFile = this.selectOverlaySourceFile(syncFiles.files, syncFiles.primaryFileId);
    if (!overlaySourceFile) return null;

    const audioFiles = syncFiles.files.filter((file) => typeof file.format === 'string' && isAudioFormat(file.format));
    const audioTotalSeconds = this.computeAudioTotalSeconds(audioFiles);
    if (audioFiles.length === 0 || audioTotalSeconds === null) return null;

    const playlist = await this.getPlaylist(overlaySourceFile, params.bookId);
    if (playlist.items.length === 0 || playlist.durationSeconds == null || playlist.durationSeconds <= 0) return null;

    const overlaySeconds = await this.resolveOverlaySecondsFromEbookPosition(ebookFile, playlist, params);
    if (overlaySeconds === null) return null;

    const audioSeconds = this.mapOverlaySecondsToAudioSeconds(overlaySeconds, playlist.durationSeconds, audioTotalSeconds);
    if (audioSeconds === null) return null;

    const filePosition = this.audioFilePositionForSeconds(audioFiles, audioSeconds);
    if (!filePosition) return null;

    return {
      currentFileId: filePosition.file.id,
      positionSeconds: filePosition.positionSeconds,
      percentage: this.clampPercentage((audioSeconds / audioTotalSeconds) * 100),
    };
  }

  private selectOverlaySourceFile(files: SyncFile[], primaryFileId: number | null): SyncFile | null {
    const overlayFiles = files.filter((file) => file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable);
    return overlayFiles.find((file) => file.id === primaryFileId) ?? overlayFiles[0] ?? null;
  }

  private selectTargetFile(files: SyncFile[], primaryFileId: number | null, overlaySourceFile: SyncFile): SyncFile {
    const primaryFile = files.find((file) => file.id === primaryFileId && file.format?.toLowerCase() === 'epub');
    return primaryFile ?? overlaySourceFile;
  }

  private computeAudioAbsoluteSeconds(audioFiles: SyncFile[], currentAudioIndex: number, positionSeconds: number): number | null {
    let offset = 0;
    for (let i = 0; i < currentAudioIndex; i += 1) {
      const duration = audioFiles[i]?.durationSeconds;
      if (!this.isPositiveFinite(duration)) return null;
      offset += duration;
    }

    const currentDuration = audioFiles[currentAudioIndex]?.durationSeconds;
    const clampedPosition = this.isPositiveFinite(currentDuration) ? Math.min(positionSeconds, currentDuration) : positionSeconds;
    return offset + Math.max(0, clampedPosition);
  }

  private computeAudioTotalSeconds(audioFiles: SyncFile[]): number | null {
    let total = 0;
    for (const file of audioFiles) {
      if (!this.isPositiveFinite(file.durationSeconds)) return null;
      total += file.durationSeconds;
    }
    return total > 0 ? total : null;
  }

  private mapAudioSecondsToOverlaySeconds(audioSeconds: number, audioTotalSeconds: number, overlayTotalSeconds: number): number | null {
    const diff = Math.abs(audioTotalSeconds - overlayTotalSeconds);
    const tolerance = Math.min(MAX_DURATION_DIFF_SECONDS, overlayTotalSeconds * MAX_DURATION_DIFF_RATIO);
    if (diff > tolerance) return null;

    return Math.max(0, Math.min(overlayTotalSeconds, audioSeconds * (overlayTotalSeconds / audioTotalSeconds)));
  }

  private mapOverlaySecondsToAudioSeconds(overlaySeconds: number, overlayTotalSeconds: number, audioTotalSeconds: number): number | null {
    const diff = Math.abs(audioTotalSeconds - overlayTotalSeconds);
    const tolerance = Math.min(MAX_DURATION_DIFF_SECONDS, overlayTotalSeconds * MAX_DURATION_DIFF_RATIO);
    if (diff > tolerance) return null;

    return Math.max(0, Math.min(audioTotalSeconds, overlaySeconds * (audioTotalSeconds / overlayTotalSeconds)));
  }

  private async resolveOverlaySecondsFromEbookPosition(
    ebookFile: SyncFile,
    playlist: EpubMediaOverlayPlaylist,
    params: {
      cfi?: string | null;
      koreaderProgress?: string | null;
      positionSeconds?: number | null;
      mediaOverlayFragment?: string | null;
      mediaOverlaySectionIndex?: number | null;
    },
  ): Promise<number | null> {
    if (
      this.isNonNegativeFinite(params.positionSeconds) &&
      (params.mediaOverlayFragment || params.mediaOverlaySectionIndex != null) &&
      playlist.durationSeconds != null
    ) {
      return Math.max(0, Math.min(playlist.durationSeconds, params.positionSeconds));
    }

    if (params.mediaOverlayFragment) {
      const match = this.findItemStartByFragment(playlist, params.mediaOverlayFragment, params.mediaOverlaySectionIndex ?? null);
      if (match) return match.startSeconds;
    }

    if (params.cfi || params.koreaderProgress) {
      const candidates = playlist.items
        .filter((item): item is EpubMediaOverlayPlaylistItem & { textFragment: string } => !!item.textFragment)
        .map((item) => ({ chapterIndex: item.sectionIndex, fragment: item.textFragment }));
      const nearest = await this.positionConverter.nearestFragmentForPosition({
        bookFileId: ebookFile.id,
        cfi: params.cfi ?? null,
        xpointer: params.koreaderProgress ?? null,
        candidates,
      });
      if (nearest.status === 'exact' && nearest.fragment) {
        const match = this.findItemStartByFragmentId(playlist, nearest.fragment, nearest.chapterIndex ?? null);
        if (match) return match.startSeconds;
      }
    }

    return null;
  }

  private findItemBySeconds(playlist: EpubMediaOverlayPlaylist, positionSeconds: number): EpubMediaOverlayPlaylistItem | null {
    let elapsed = 0;
    let lastKnown: EpubMediaOverlayPlaylistItem | null = null;

    for (const item of playlist.items) {
      const duration = item.durationSeconds;
      const start = elapsed;
      const end = this.isPositiveFinite(duration) ? start + duration : null;

      if (positionSeconds <= start) return item;
      if (end == null || positionSeconds < end) return item;

      lastKnown = item;
      elapsed = end;
    }

    return lastKnown;
  }

  private findItemStartByFragment(
    playlist: EpubMediaOverlayPlaylist,
    fragment: string,
    sectionIndex: number | null,
  ): { item: EpubMediaOverlayPlaylistItem; startSeconds: number } | null {
    let elapsed = 0;
    for (const item of playlist.items) {
      const startSeconds = elapsed;
      if (this.itemMatchesFragment(item, fragment, sectionIndex)) return { item, startSeconds };
      if (this.isPositiveFinite(item.durationSeconds)) elapsed += item.durationSeconds;
    }
    return null;
  }

  private findItemStartByFragmentId(
    playlist: EpubMediaOverlayPlaylist,
    fragment: string,
    sectionIndex: number | null,
  ): { item: EpubMediaOverlayPlaylistItem; startSeconds: number } | null {
    let elapsed = 0;
    for (const item of playlist.items) {
      const startSeconds = elapsed;
      if (item.textFragment === fragment && (sectionIndex == null || item.sectionIndex === sectionIndex)) return { item, startSeconds };
      if (this.isPositiveFinite(item.durationSeconds)) elapsed += item.durationSeconds;
    }
    return null;
  }

  private audioFilePositionForSeconds(audioFiles: SyncFile[], audioSeconds: number): { file: SyncFile; positionSeconds: number } | null {
    let elapsed = 0;
    for (let index = 0; index < audioFiles.length; index += 1) {
      const file = audioFiles[index];
      if (!file || !this.isPositiveFinite(file.durationSeconds)) return null;
      const isLast = index === audioFiles.length - 1;
      if (isLast || elapsed + file.durationSeconds > audioSeconds) {
        return {
          file,
          positionSeconds: Math.max(0, Math.min(file.durationSeconds, audioSeconds - elapsed)),
        };
      }
      elapsed += file.durationSeconds;
    }
    return null;
  }

  private async resolveFragmentPositions(
    targetFile: SyncFile,
    item: EpubMediaOverlayPlaylistItem,
  ): Promise<{ targetFile: SyncFile; cfi: string; koreaderProgress: string | null } | null> {
    if (!item.textFragment) return null;
    const outcome = await this.positionConverter.fragmentToPositions({
      bookFileId: targetFile.id,
      chapterIndex: item.sectionIndex,
      fragment: item.textFragment,
    });
    if (outcome.status === 'failed' || !outcome.cfi) return null;
    return { targetFile, cfi: outcome.cfi, koreaderProgress: outcome.koreaderProgress ?? null };
  }

  private async getPlaylist(file: SyncFile, bookId: number): Promise<EpubMediaOverlayPlaylist> {
    const { mtimeMs } = await stat(file.absolutePath);
    const cached = this.playlistCache.get(file.id);
    if (cached && cached.absolutePath === file.absolutePath && cached.mtimeMs === mtimeMs) {
      cached.lastAccessed = Date.now();
      return cached.playlist;
    }

    const playlist = await buildEpubMediaOverlayPlaylistFromFile(file.absolutePath, bookId, file.id);
    this.playlistCache.set(file.id, { absolutePath: file.absolutePath, mtimeMs, playlist, lastAccessed: Date.now() });
    this.evictPlaylistCache();
    return playlist;
  }

  private evictPlaylistCache(): void {
    if (this.playlistCache.size <= PLAYLIST_CACHE_MAX) return;
    const oldest = [...this.playlistCache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0];
    if (oldest) this.playlistCache.delete(oldest[0]);
  }

  private itemFragment(item: EpubMediaOverlayPlaylistItem): string {
    return item.textFragment ? `${item.textHref}#${item.textFragment}` : item.textHref;
  }

  private itemMatchesFragment(item: EpubMediaOverlayPlaylistItem, rawFragment: string, sectionIndex: number | null): boolean {
    if (sectionIndex != null && item.sectionIndex !== sectionIndex) return false;
    if (this.itemFragment(item) === rawFragment) return true;

    const [, splitFragment] = rawFragment.split('#');
    const fragment = splitFragment ?? rawFragment;
    return !!fragment && item.textFragment === fragment;
  }

  private isPositiveFinite(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isNonNegativeFinite(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  private clampPercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }
}
