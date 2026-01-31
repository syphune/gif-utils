import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import GIF from 'gif.js';

// Types
export interface GifData {
    frames: ParsedFrame[];
    width: number;
    height: number;
    canvas: HTMLCanvasElement; // Represents the first frame or preview
}

/**
 * Fetches and parses a GIF file
 */
export async function parseGifFile(file: File): Promise<GifData> {
    const arrayBuffer = await file.arrayBuffer();
    const gif = parseGIF(arrayBuffer);
    const frames = decompressFrames(gif, true);

    if (!frames || frames.length === 0) {
        throw new Error("Could not parse GIF frames.");
    }

    // Draw first frame to canvas for preview/initial dimensions
    const canvas = document.createElement('canvas');
    const frame0 = frames[0];
    canvas.width = frame0.dims.width;
    canvas.height = frame0.dims.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get canvas context");

    // Basic rendering of first frame
    const imageData = new ImageData(
        new Uint8ClampedArray(frame0.patch),
        frame0.dims.width,
        frame0.dims.height
    );
    ctx.putImageData(imageData, frame0.dims.left, frame0.dims.top);

    return {
        frames,
        width: frame0.dims.width,
        height: frame0.dims.height,
        canvas
    };
}

export async function cropGif(
    originalFrames: ParsedFrame[],
    cropX: number,
    cropY: number,
    cropWidth: number,
    cropHeight: number,
    onProgress?: (progress: number) => void
): Promise<Blob> {

    return new Promise((resolve, reject) => {
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: cropWidth,
            height: cropHeight,
            workerScript: '/gif.worker.js',
            transparent: 0x000000 // Enable transparency (black key)
        });

        // Temp canvas for full frame reconstruction
        const tempCanvas = document.createElement('canvas');
        if (originalFrames.length > 0) {
            tempCanvas.width = originalFrames[0].dims.width;
            tempCanvas.height = originalFrames[0].dims.height;
        }
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

        // Crop canvas for the final frame
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

        if (!tempCtx || !cropCtx) {
            reject(new Error("Canvas context init failed"));
            return;
        }

        let previousFrameData: ImageData | null = null;

        const processFrames = async () => {
            for (let i = 0; i < originalFrames.length; i++) {
                const frame = originalFrames[i];

                // DATA PREPARATION:
                const patchData = new ImageData(
                    new Uint8ClampedArray(frame.patch),
                    frame.dims.width,
                    frame.dims.height
                );

                // DISPOSAL HANDLING (Pre-Drawing):
                if (i > 0) {
                    const prevFrame = originalFrames[i - 1];
                    if (prevFrame.disposalType === 2) {
                        // Restore to background
                        tempCtx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
                    } else if (prevFrame.disposalType === 3 && previousFrameData) {
                        // Restore to previous
                        tempCtx.putImageData(previousFrameData, 0, 0);
                    }
                }

                // SAVE STATE (For Next Frame's Restoration):
                if (frame.disposalType === 3) {
                    previousFrameData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                }

                // DRAWING (Compositing):
                // Create a bitmap from the patch data to allow drawImage with proper alpha blending
                const imageBitmap = await createImageBitmap(patchData);
                tempCtx.drawImage(imageBitmap, frame.dims.left, frame.dims.top);

                // CROP:
                cropCtx.clearRect(0, 0, cropWidth, cropHeight);
                cropCtx.drawImage(
                    tempCanvas,
                    cropX, cropY, cropWidth, cropHeight,
                    0, 0, cropWidth, cropHeight
                );

                // ADD FRAME:
                gif.addFrame(cropCtx, {
                    copy: true,
                    delay: frame.delay
                });
            }
        };

        processFrames().then(() => {
            gif.on('progress', (p: number) => {
                if (onProgress) onProgress(p);
            });

            gif.on('finished', (blob: Blob) => {
                resolve(blob);
            });

            gif.render();
        }).catch(reject);
    });
}

/**
 * Pre-renders all frames to full ImageBitmaps for smooth playback/scrubbing.
 * Handles disposal and transparency correctly.
 */
export async function generateCompositedFrames(gifData: GifData): Promise<ImageBitmap[]> {
    const { frames, width, height } = gifData;

    const compositedFrames: ImageBitmap[] = [];
    let previousFrameData: ImageData | null = null;

    // Temp canvas for frame construction
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) throw new Error("Temp Canvas init failed");

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // 1. DISPOSAL handling of PREVIOUS frame
        if (i > 0) {
            const prevFrame = frames[i - 1];
            if (prevFrame.disposalType === 2) {
                // Restore to background (clear)
                tempCtx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
            } else if (prevFrame.disposalType === 3 && previousFrameData) {
                // Restore to previous
                tempCtx.putImageData(previousFrameData, 0, 0);
            }
        }

        // 2. Save state calculation for NEXT frame's disposal 3
        if (frame.disposalType === 3) {
            previousFrameData = tempCtx.getImageData(0, 0, width, height);
        }

        // 3. Draw CURRENT frame patch
        const patchData = new ImageData(
            new Uint8ClampedArray(frame.patch),
            frame.dims.width,
            frame.dims.height
        );
        const patchBitmap = await createImageBitmap(patchData);
        tempCtx.drawImage(patchBitmap, frame.dims.left, frame.dims.top);

        // 4. Export THIS state as the frame image
        const frameBitmap = await createImageBitmap(tempCanvas);
        compositedFrames.push(frameBitmap);
    }

    return compositedFrames;
}

/**
 * Generates low-res thumbnails for the timeline to save memory.
 */
export async function generateThumbnails(gifData: GifData, height: number = 60): Promise<ImageBitmap[]> {
    const { frames, width: originalWidth, height: originalHeight } = gifData;
    const scale = height / originalHeight;
    const width = Math.floor(originalWidth * scale);

    const thumbnails: ImageBitmap[] = [];
    let previousFrameData: ImageData | null = null;

    // Full size temp canvas for accurate composition before scaling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    // Scaled canvas for output
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = width;
    thumbCanvas.height = height;
    const thumbCtx = thumbCanvas.getContext('2d');

    if (!tempCtx || !thumbCtx) throw new Error("Canvas init failed");

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // 1. DISPOSAL (Same as compositing)
        if (i > 0) {
            const prevFrame = frames[i - 1];
            if (prevFrame.disposalType === 2) {
                tempCtx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
            } else if (prevFrame.disposalType === 3 && previousFrameData) {
                tempCtx.putImageData(previousFrameData, 0, 0);
            }
        }

        // 2. Save state
        if (frame.disposalType === 3) {
            previousFrameData = tempCtx.getImageData(0, 0, originalWidth, originalHeight);
        }

        // 3. Draw
        const patchData = new ImageData(
            new Uint8ClampedArray(frame.patch),
            frame.dims.width,
            frame.dims.height
        );
        const patchBitmap = await createImageBitmap(patchData);
        tempCtx.drawImage(patchBitmap, frame.dims.left, frame.dims.top);

        // 4. Scale down to thumbnail
        thumbCtx.clearRect(0, 0, width, height);
        thumbCtx.drawImage(tempCanvas, 0, 0, width, height);

        const thumbBitmap = await createImageBitmap(thumbCanvas);
        thumbnails.push(thumbBitmap);
    }

    return thumbnails;
}
