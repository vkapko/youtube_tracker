import { describe, it, expect } from 'vitest'
import { parseYouTubeVideoId } from '../src/lib/youtubeUrl'

const ID = 'dQw4w9WgXcQ'

describe('parseYouTubeVideoId', () => {
  it('parses standard watch URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('parses watch URL with extra query params', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`)).toBe(ID)
  })

  it('parses short youtu.be URL', () => {
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}`)).toBe(ID)
  })

  it('parses youtu.be URL with query params', () => {
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}?t=30`)).toBe(ID)
  })

  it('parses embed URL', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
  })

  it('returns null for non-YouTube URL', () => {
    expect(parseYouTubeVideoId('https://vimeo.com/123456789')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseYouTubeVideoId('')).toBeNull()
  })

  it('returns null for plain text', () => {
    expect(parseYouTubeVideoId('not a url at all')).toBeNull()
  })

  it('returns null for YouTube channel URL', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/channel/UCxxxxxx')).toBeNull()
  })
})
