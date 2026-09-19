import { Injectable } from '@nestjs/common';

import { chapterIndexFromSpineStep, findElementById, parseCfi } from './cfi.utils';
import { EpubDomService } from './epub-dom.service';
import {
  CfiToXPointerResult,
  ChapterDocument,
  ConversionResult,
  CONVERTER_VERSION,
  cfiPointToCollapsedCp,
  cfiRangeToXPointer,
  collapsedPointToCfi,
  collapsedPointToXPointer,
  xpointerPointToCollapsed,
  xpointerRangeToCfi,
} from './position-converter.core';
import { parseXPointer } from './xpointer.utils';

export interface XPointerToCfiParams {
  bookFileId: number;
  pos0: string;
  pos1: string | null;
  text: string | null;
}

export interface CfiToXPointerParams {
  bookFileId: number;
  cfi: string;
  text: string | null;
}

export interface XPointerToCfiOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  cfi?: string;
  chapterIndex?: number;
  reason?: string;
}

export interface CfiToXPointerOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  pos0?: string;
  pos1?: string;
  chapterIndex?: number;
  reason?: string;
}

export interface FragmentToPositionsOutcome extends Record<string, unknown> {
  status: 'exact' | 'failed';
  cfi?: string;
  koreaderProgress?: string | null;
  chapterIndex?: number;
  reason?: string;
}

export interface NearestFragmentOutcome extends Record<string, unknown> {
  status: 'exact' | 'failed';
  fragment?: string;
  chapterIndex?: number;
  reason?: string;
}

@Injectable()
export class PositionConverterService {
  readonly version = CONVERTER_VERSION;

  constructor(private readonly epubDom: EpubDomService) {}

  async xpointerToCfi(params: XPointerToCfiParams): Promise<XPointerToCfiOutcome> {
    const parsed = parseXPointer(params.pos0);
    if (!parsed) return { status: 'failed', reason: 'unparsable_pos0' };
    const chapterIndex = parsed.docFragmentIndex - 1;
    if (chapterIndex < 0) return { status: 'failed', reason: 'invalid_fragment' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const result: ConversionResult = xpointerRangeToCfi(doc, chapterIndex, params.pos0, params.pos1, params.text);
    if (result.status === 'failed') return { status: 'failed', reason: result.reason, chapterIndex };
    return { status: result.status, cfi: result.pos0, chapterIndex };
  }

  /** Converts a single reading-position xpointer (point, not range) to a point CFI. */
  async xpointerPointToCfi(params: { bookFileId: number; pos: string }): Promise<XPointerToCfiOutcome> {
    const parsed = parseXPointer(params.pos);
    if (!parsed) return { status: 'failed', reason: 'unparsable_pos0' };
    const chapterIndex = parsed.docFragmentIndex - 1;
    if (chapterIndex < 0) return { status: 'failed', reason: 'invalid_fragment' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const cp = xpointerPointToCollapsed(doc, params.pos);
    if (cp == null) return { status: 'failed', reason: 'unresolvable_structure', chapterIndex };
    const cfi = collapsedPointToCfi(doc, chapterIndex, cp);
    if (!cfi) return { status: 'failed', reason: 'cfi_generation_failed', chapterIndex };
    return { status: 'exact', cfi, chapterIndex };
  }

  /**
   * Converts a collapsed point CFI to a single xpointer. Dogears have no highlighted
   * text to repair against, so this is structural only: it resolves or it fails.
   */
  async cfiPointToXpointer(params: { bookFileId: number; cfi: string }): Promise<CfiToXPointerOutcome> {
    const parsed = parseCfi(params.cfi);
    if (!parsed) return { status: 'failed', reason: 'unparsable_cfi' };
    const chapterIndex = chapterIndexFromSpineStep(parsed.spineStep);
    if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const cp = cfiPointToCollapsedCp(doc, params.cfi);
    if (cp == null) return { status: 'failed', reason: 'unresolvable_structure', chapterIndex };
    const pos = collapsedPointToXPointer(doc, chapterIndex, cp);
    if (!pos) return { status: 'failed', reason: 'xpointer_generation_failed', chapterIndex };
    return { status: 'exact', pos0: pos, chapterIndex };
  }

  async cfiToXpointer(params: CfiToXPointerParams): Promise<CfiToXPointerOutcome> {
    const parsed = parseCfi(params.cfi);
    if (!parsed) return { status: 'failed', reason: 'unparsable_cfi' };
    const chapterIndex = chapterIndexFromSpineStep(parsed.spineStep);
    if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step' };

    const doc = await this.epubDom.getChapter(params.bookFileId, chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };

    const result: CfiToXPointerResult = cfiRangeToXPointer(doc, chapterIndex, params.cfi, params.text);
    if (result.status === 'failed') return { status: 'failed', reason: result.reason, chapterIndex };
    return { status: result.status, pos0: result.pos0, pos1: result.pos1, chapterIndex };
  }

  async fragmentToPositions(params: { bookFileId: number; chapterIndex: number; fragment: string }): Promise<FragmentToPositionsOutcome> {
    const fragment = params.fragment.replace(/^#/, '').trim();
    if (!fragment) return { status: 'failed', reason: 'missing_fragment' };
    if (params.chapterIndex < 0) return { status: 'failed', reason: 'invalid_chapter_index' };

    const doc = await this.epubDom.getChapter(params.bookFileId, params.chapterIndex);
    if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex: params.chapterIndex };

    const element = findElementById(doc.root, fragment);
    if (!element) return { status: 'failed', reason: 'fragment_not_found', chapterIndex: params.chapterIndex };

    const run = doc.index.firstRunWithin(element);
    if (!run || run.collapsedLength <= 0) return { status: 'failed', reason: 'fragment_has_no_text', chapterIndex: params.chapterIndex };

    const cfi = collapsedPointToCfi(doc, params.chapterIndex, run.collapsedStart);
    if (!cfi) return { status: 'failed', reason: 'cfi_generation_failed', chapterIndex: params.chapterIndex };

    return {
      status: 'exact',
      cfi,
      koreaderProgress: collapsedPointToXPointer(doc, params.chapterIndex, run.collapsedStart),
      chapterIndex: params.chapterIndex,
    };
  }

  async nearestFragmentForPosition(params: {
    bookFileId: number;
    cfi?: string | null;
    xpointer?: string | null;
    candidates: Array<{ chapterIndex: number; fragment: string }>;
  }): Promise<NearestFragmentOutcome> {
    const resolved = await this.resolvePositionCp(params.bookFileId, params.cfi ?? null, params.xpointer ?? null);
    if (resolved.status === 'failed') return resolved;

    const candidates = params.candidates.filter((candidate) => candidate.chapterIndex === resolved.chapterIndex);
    if (candidates.length === 0) return { status: 'failed', reason: 'no_candidate_fragments', chapterIndex: resolved.chapterIndex };

    let bestBefore: { fragment: string; distance: number } | null = null;
    let bestAfter: { fragment: string; distance: number } | null = null;
    for (const candidate of candidates) {
      const element = findElementById(resolved.doc.root, candidate.fragment);
      if (!element) continue;
      const run = resolved.doc.index.firstRunWithin(element);
      if (!run || run.collapsedLength <= 0) continue;
      const distance = resolved.cp - run.collapsedStart;
      if (distance >= 0) {
        if (!bestBefore || distance < bestBefore.distance) bestBefore = { fragment: candidate.fragment, distance };
      } else {
        const afterDistance = Math.abs(distance);
        if (!bestAfter || afterDistance < bestAfter.distance) bestAfter = { fragment: candidate.fragment, distance: afterDistance };
      }
    }

    const best = bestBefore ?? bestAfter;
    if (!best) return { status: 'failed', reason: 'candidate_fragment_not_found', chapterIndex: resolved.chapterIndex };
    return { status: 'exact', fragment: best.fragment, chapterIndex: resolved.chapterIndex };
  }

  private async resolvePositionCp(
    bookFileId: number,
    cfi: string | null,
    xpointer: string | null,
  ): Promise<
    { status: 'exact'; chapterIndex: number; cp: number; doc: ChapterDocument } | { status: 'failed'; reason: string; chapterIndex?: number }
  > {
    if (xpointer) {
      const parsed = parseXPointer(xpointer);
      if (!parsed) return { status: 'failed', reason: 'unparsable_xpointer' };
      const chapterIndex = parsed.docFragmentIndex - 1;
      if (chapterIndex < 0) return { status: 'failed', reason: 'invalid_fragment' };
      const doc = await this.epubDom.getChapter(bookFileId, chapterIndex);
      if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };
      const cp = xpointerPointToCollapsed(doc, xpointer);
      if (cp == null) return { status: 'failed', reason: 'unresolvable_structure', chapterIndex };
      return { status: 'exact', chapterIndex, cp, doc };
    }

    if (cfi) {
      const parsed = parseCfi(cfi);
      if (!parsed) return { status: 'failed', reason: 'unparsable_cfi' };
      const chapterIndex = chapterIndexFromSpineStep(parsed.spineStep);
      if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step' };
      const doc = await this.epubDom.getChapter(bookFileId, chapterIndex);
      if (!doc) return { status: 'failed', reason: 'chapter_unavailable', chapterIndex };
      const cp = cfiPointToCollapsedCp(doc, cfi);
      if (cp == null) return { status: 'failed', reason: 'unresolvable_structure', chapterIndex };
      return { status: 'exact', chapterIndex, cp, doc };
    }

    return { status: 'failed', reason: 'missing_position' };
  }
}
