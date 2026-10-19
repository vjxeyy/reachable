// Browser-side photo handling: shrink a photo to a small JPEG before it is classified and saved.

export interface PreparedPhoto {
  dataUrl: string
  bytes: Uint8Array
  mimeType: 'image/jpeg'
  fileName: string
  width: number
  height: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('This file could not be opened as an image.'))
    img.src = url
  })
}

/** Resizes to at most `maxSize` px on the long side and re-encodes as JPEG. */
export async function preparePhoto(file: Blob, fileName: string, maxSize = 720): Promise<PreparedPhoto> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const w = img.naturalWidth || 640
    const h = img.naturalHeight || 480
    const scale = Math.min(1, maxSize / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser cannot process images.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
    const jpegName = fileName.replace(/\.[a-z0-9]+$/i, '') + '.jpg'
    return { dataUrl, bytes, mimeType: 'image/jpeg', fileName: jpegName, width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const SAMPLE_PHOTOS = [
  { id: 'blocked-ramp', label: 'Sample drawing: blocked ramp' },
  { id: 'parked-vehicle', label: 'Sample drawing: parked vehicle' },
  { id: 'flooding', label: 'Sample drawing: flooding' },
] as const

/** True for a photo that came from one of the bundled sample drawings. */
export function isSample(photo: Pick<PreparedPhoto, 'fileName'>): boolean {
  return photo.fileName.startsWith('sample-')
}

/** Loads one of the bundled sample illustrations as if it were a photo. */
export async function loadSamplePhoto(id: string): Promise<PreparedPhoto> {
  const response = await fetch(`/samples/${id}.svg`)
  if (!response.ok) throw new Error('Sample drawing not found.')
  return preparePhoto(await response.blob(), `sample-${id}.jpg`)
}
