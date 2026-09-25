import { Injectable, Logger } from '@nestjs/common';
import { isValidBookRequestIsbn13, MetadataProviderKey } from '@bookorbit/types';

import { symmetricTitleSimilarity } from '../../common/text-match/title-match';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ProviderRegistry } from '../metadata-fetch/provider-registry';

/** A lookup that does not answer in this time is dropped: a request is never held up by it. */
const LOOKUP_TIMEOUT_MS = 4000;
/**
 * How closely the looked-up edition's title must agree with the request's before its subtitle is
 * taken. The ISBN read from a cover URL is a guess, and a subtitle from the wrong book would send
 * the search after the wrong work.
 */
const MIN_TITLE_AGREEMENT = 0.8;

export interface RequestIdentifiers {
  title: string;
  subtitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  coverUrl: string | null;
}

export interface EnrichedIdentifiers {
  subtitle: string | null;
  isbn13: string | null;
}

/**
 * Fills in what the provider a request was made from left out. Measured on "Off-campus - Tome 02":
 * iTunes gives neither an ISBN nor a subtitle, yet the ISBN is in its cover URL, and Google Books
 * knows that ISBN with the subtitle "The mistake", which is the title the files circulate under.
 *
 * Never throws and never replaces a value the requester's provider supplied.
 */
@Injectable()
export class RequestIdentifierEnrichmentService {
  private readonly logger = new Logger(RequestIdentifierEnrichmentService.name);

  constructor(private readonly providers: ProviderRegistry) {}

  async enrich(request: RequestIdentifiers): Promise<EnrichedIdentifiers> {
    const isbn13 = request.isbn13 ?? (request.isbn10 ? null : isbnFromCoverUrl(request.coverUrl));
    const subtitle = request.subtitle?.trim() || (isbn13 ? await this.subtitleFor(isbn13, request.title) : null);
    return { isbn13, subtitle: subtitle || null };
  }

  private async subtitleFor(isbn13: string, title: string): Promise<string | null> {
    const google = this.providers.find(MetadataProviderKey.GOOGLE);
    if (!google) return null;
    const startedAt = Date.now();
    try {
      const candidates = await google.search({ isbn: isbn13, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      const edition = candidates.find(
        (candidate) => candidate.subtitle?.trim() && symmetricTitleSimilarity(title, candidate.title ?? '') >= MIN_TITLE_AGREEMENT,
      );
      this.logger.log(
        `[book_request.enrich] [end] isbn=${isbn13} candidates=${candidates.length} subtitle=${edition ? `"${sanitizeLogValue(edition.subtitle!)}"` : 'none'} durationMs=${Date.now() - startedAt}`,
      );
      return edition?.subtitle?.trim() ?? null;
    } catch (error) {
      this.logger.warn(
        `[book_request.enrich] [fail] isbn=${isbn13} durationMs=${Date.now() - startedAt} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - request kept without a subtitle`,
      );
      return null;
    }
  }
}

/**
 * The ISBN an Apple Books cover is filed under, e.g. `.../9782755626933-001-x.jpeg/...`. Only a
 * thirteen-digit run whose check digit holds, so an asset id that merely starts with 978 is left.
 */
export function isbnFromCoverUrl(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  let path: string;
  try {
    path = new URL(coverUrl).pathname;
  } catch {
    return null;
  }
  for (const match of path.matchAll(/(?<!\d)97[89]\d{10}(?!\d)/g)) {
    if (isValidBookRequestIsbn13(match[0])) return match[0];
  }
  return null;
}
