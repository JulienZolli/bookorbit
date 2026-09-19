import { selectPrimaryFile } from './primary-file-selection.utils';

describe('selectPrimaryFile', () => {
  const plainEpub = { id: 1, format: 'epub', sizeBytes: 100, mediaOverlayAvailable: false };
  const readAlongEpub = { id: 2, format: 'epub', sizeBytes: 200, mediaOverlayAvailable: true };
  const audiobook = { id: 3, format: 'm4b', sizeBytes: 300, mediaOverlayAvailable: false };

  it('prefers a read-aloud EPUB over a plain EPUB of the same preferred format', () => {
    expect(selectPrimaryFile([plainEpub, readAlongEpub, audiobook], ['epub', 'm4b'])).toBe(readAlongEpub);
  });

  it('still honors format priority before read-aloud capability', () => {
    expect(selectPrimaryFile([plainEpub, readAlongEpub, audiobook], ['m4b', 'epub'])).toBe(audiobook);
  });

  it('rejects zero-byte candidates unless fallback is explicitly enabled', () => {
    const empty = { ...readAlongEpub, sizeBytes: 0 };
    expect(selectPrimaryFile([empty], ['epub'])).toBeNull();
    expect(selectPrimaryFile([empty], ['epub'], { allowZeroByteFallback: true })).toBe(empty);
  });
});
