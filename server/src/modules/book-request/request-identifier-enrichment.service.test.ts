import { MetadataProviderKey } from '@bookorbit/types';

import { isbnFromCoverUrl, RequestIdentifierEnrichmentService } from './request-identifier-enrichment.service';

const ITUNES_COVER =
  'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/a1/28/0a/a1280a85-3532-6786-e0c6-dee96f14e796/9782755626933-001-x.jpeg/10000x10000bb.jpg';

function makeService(search: ReturnType<typeof vi.fn> | null) {
  const registry = { find: vi.fn((key: string) => (key === MetadataProviderKey.GOOGLE && search ? { search } : undefined)) };
  return new RequestIdentifierEnrichmentService(registry as never);
}

const base = { title: 'Off-campus - Tome 02', subtitle: null, isbn10: null, isbn13: null, coverUrl: ITUNES_COVER };

describe('isbnFromCoverUrl', () => {
  it('reads the ISBN an Apple Books cover is filed under', () => {
    expect(isbnFromCoverUrl(ITUNES_COVER)).toBe('9782755626933');
  });

  it('ignores a thirteen-digit run whose check digit does not hold', () => {
    expect(isbnFromCoverUrl('https://example.com/covers/9782755626934-001.jpg')).toBeNull();
  });

  it('ignores digits outside the path and unreadable URLs', () => {
    expect(isbnFromCoverUrl('https://example.com/cover.jpg?id=9782755626933')).toBeNull();
    expect(isbnFromCoverUrl('not a url')).toBeNull();
    expect(isbnFromCoverUrl(null)).toBeNull();
  });
});

describe('RequestIdentifierEnrichmentService', () => {
  it('fills in the ISBN from the cover and the subtitle from Google Books', async () => {
    const search = vi.fn().mockResolvedValue([{ title: 'Off-campus - Tome 02', subtitle: 'The mistake' }]);

    await expect(makeService(search).enrich(base)).resolves.toEqual({ isbn13: '9782755626933', subtitle: 'The mistake' });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ isbn: '9782755626933' }));
  });

  it('refuses a subtitle from an edition whose title does not agree', async () => {
    const search = vi.fn().mockResolvedValue([{ title: 'Campus Drivers - tome 2', subtitle: 'Something' }]);

    await expect(makeService(search).enrich(base)).resolves.toEqual({ isbn13: '9782755626933', subtitle: null });
  });

  it('never replaces what the provider supplied', async () => {
    const search = vi.fn();

    await expect(makeService(search).enrich({ ...base, isbn13: '9791042909338', subtitle: 'Given' })).resolves.toEqual({
      isbn13: '9791042909338',
      subtitle: 'Given',
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps the request whole when Google Books fails or is not configured', async () => {
    await expect(makeService(vi.fn().mockRejectedValue(new Error('boom'))).enrich(base)).resolves.toEqual({
      isbn13: '9782755626933',
      subtitle: null,
    });
    await expect(makeService(null).enrich(base)).resolves.toEqual({ isbn13: '9782755626933', subtitle: null });
  });
});
