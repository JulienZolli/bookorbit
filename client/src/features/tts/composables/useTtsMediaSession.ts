import type { TtsCurrentBook } from '../lib/tts-state'

export function useTtsMediaSession() {
  function setMetadata(book: TtsCurrentBook) {
    if (!('mediaSession' in navigator)) return
    const artwork: MediaImage[] = book.coverUrl ? [{ src: book.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
    navigator.mediaSession.metadata = new MediaMetadata({
      title: book.title,
      artist: book.author ?? '',
      album: 'BookOrbit',
      artwork,
    })
  }

  function setPlaybackState(state: 'playing' | 'paused' | 'none') {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = state
  }

  function registerHandlers(handlers: { play: () => void; pause: () => void; previoustrack: () => void; nexttrack: () => void; stop: () => void }) {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', handlers.play)
    navigator.mediaSession.setActionHandler('pause', handlers.pause)
    navigator.mediaSession.setActionHandler('previoustrack', handlers.previoustrack)
    navigator.mediaSession.setActionHandler('nexttrack', handlers.nexttrack)
    navigator.mediaSession.setActionHandler('stop', handlers.stop)
  }

  function clearHandlers() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('previoustrack', null)
    navigator.mediaSession.setActionHandler('nexttrack', null)
    navigator.mediaSession.setActionHandler('stop', null)
  }

  return {
    setMetadata,
    setPlaybackState,
    registerHandlers,
    clearHandlers,
  }
}
