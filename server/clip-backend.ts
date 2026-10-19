// Runs CLIP on this machine with transformers.js (ONNX, quantised). Server only.
// First use downloads the model (about 90 MB, from the public Hugging Face Hub, no token needed)
// into the cache folder; after that it works offline. Needs roughly 400 MB of memory.
//
// The library is loaded with a dynamic import, so a server that never turns CLIP on (the default)
// does not load it or its native runtime at all.

import { CLIP_MODEL, type ClipBackend } from '../src/classifier/clip'

export interface ClipRuntime extends ClipBackend {
  /** Starts loading the model now; resolves when it is ready. */
  warmUp(): Promise<void>
}

type Library = typeof import('@huggingface/transformers')
type Pipeline = Awaited<ReturnType<Library['pipeline']>>

export function createClipRuntime(cacheDir: string): ClipRuntime {
  let loading: Promise<{ lib: Library; classifier: Pipeline }> | null = null

  const load = async () => {
    const lib = await import('@huggingface/transformers')
    lib.env.cacheDir = cacheDir
    const classifier = await lib.pipeline('zero-shot-image-classification', CLIP_MODEL, { dtype: 'q8' })
    return { lib, classifier }
  }
  const model = () => {
    loading ??= load().catch((error: unknown) => {
      loading = null // try again on the next photo
      throw error
    })
    return loading
  }

  return {
    async warmUp() {
      await model()
    },
    async scoreImage(image, mimeType, labels) {
      const { lib, classifier } = await model()
      const photo = await lib.RawImage.fromBlob(new Blob([image as Uint8Array<ArrayBuffer>], { type: mimeType }))
      const output = await (classifier as unknown as (i: unknown, l: string[]) => Promise<{ label: string; score: number }[]>)(photo, labels)
      return output.map((o) => ({ label: o.label, score: o.score }))
    },
  }
}
