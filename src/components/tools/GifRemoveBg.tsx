import { useState, useEffect } from 'react';
import { FileUpload } from '@/components/ui/FileUpload';
import { Loader2, Download, RefreshCcw, Sparkles } from 'lucide-react';
import { parseGifFile, type GifData } from '@/lib/gif-processor';
import { removeBackground } from "@imgly/background-removal";
import GIF from 'gif.js';

// Reuse ButtonSimple
const ButtonSimple = ({ className, children, disabled, variant = "primary", onClick }: any) => {
    const base = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2";
    const variants: any = {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
    };
    return (
        <button className={`${base} ${variants[variant]} ${className}`} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    )
}

export function GifRemoveBg() {
    const [file, setFile] = useState<File | null>(null);
    const [gifData, setGifData] = useState<GifData | null>(null);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [currentFrameDisplay, setCurrentFrameDisplay] = useState<string | null>(null);
    const [originalUrl, setOriginalUrl] = useState<string | null>(null);

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setLoading(true);
        try {
            const data = await parseGifFile(selectedFile);
            setGifData(data);
        } catch (error) {
            console.error(error);
            alert("Failed to parse GIF");
        } finally {
            setLoading(false);
        }
    };

    const processRemoveBg = async () => {
        if (!gifData) return;
        setProcessing(true);
        setProgress(0);

        try {
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: gifData.width,
                height: gifData.height,
                workerScript: '/gif.worker.js',
                transparent: 0x000000 // Ensure transparency is preserved
            });

            // We need to process each frame
            // 1. Extract frame as PNG blob (to handle opacity correctly for imgly)
            // 2. Pass to imgly
            // 3. Draw result to canvas
            // 4. Add to gif.js

            // To save memory, we'll try to do this sequentially or in small batches

            // Helper canvas for frame extraction
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = gifData.width;
            tempCanvas.height = gifData.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

            if (!tempCtx) throw new Error("Canvas init failed");

            // We need to reconstruct frames similar to crop logic to ensure we feed a "full image" to the AI
            // otherwise it might cut off parts if it only sees a patch.
            // AND we need to handle disposal.

            let previousFrameData: ImageData | null = null;

            for (let i = 0; i < gifData.frames.length; i++) {
                const frame = gifData.frames[i];

                // --- RECONSTRUCT FRAME START (Same logic as crop) ---
                const patchData = new ImageData(
                    new Uint8ClampedArray(frame.patch),
                    frame.dims.width,
                    frame.dims.height
                );

                if (i > 0) {
                    const prevFrame = gifData.frames[i - 1];
                    if (prevFrame.disposalType === 2) {
                        tempCtx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
                    } else if (prevFrame.disposalType === 3 && previousFrameData) {
                        tempCtx.putImageData(previousFrameData, 0, 0);
                    }
                }

                if (frame.disposalType === 3) {
                    previousFrameData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                }

                const imageBitmap = await createImageBitmap(patchData);
                tempCtx.drawImage(imageBitmap, frame.dims.left, frame.dims.top);
                // --- RECONSTRUCT FRAME END ---

                // Now tempCanvas has the full frame image. 
                // Convert to Blob for imgly
                const frameBlob = await new Promise<Blob | null>(r => tempCanvas.toBlob(r, 'image/png'));

                if (frameBlob) {
                    // Update preview
                    const previewUrl = URL.createObjectURL(frameBlob);
                    setCurrentFrameDisplay(previewUrl);

                    // AI Processing
                    // Note: removeBackground can take a Blob
                    // Optimization: Use 'isnet_quint8' (quantized) model for lower memory and faster speed
                    const config = {
                        model: 'isnet_quint8' as const,
                        // debug: true, // Optional for debugging
                    };

                    const removedBgBlob = await removeBackground(frameBlob, {
                        ...config,
                        progress: (_p: string) => {
                            // This is internal model download progress usually
                            // We ignore it to calculate overall frame progress
                        }
                    });

                    // Draw the result to a clean canvas to add to GIF
                    const cleanCanvas = document.createElement('canvas');
                    cleanCanvas.width = gifData.width;
                    cleanCanvas.height = gifData.height;
                    const cleanCtx = cleanCanvas.getContext('2d');

                    const imgBitmap = await createImageBitmap(removedBgBlob);
                    cleanCtx?.drawImage(imgBitmap, 0, 0);

                    gif.addFrame(cleanCanvas, {
                        copy: true,
                        delay: frame.delay
                    });

                    // Clean up
                    URL.revokeObjectURL(previewUrl);
                }

                // Update progress
                setProgress(Math.round(((i + 1) / gifData.frames.length) * 100));
            }

            gif.on('finished', (blob: Blob) => {
                setResultUrl(URL.createObjectURL(blob));
                setProcessing(false);
            });

            gif.render();

        } catch (e) {
            console.error(e);
            alert("Error removing background");
            setProcessing(false);
        }
    };

    const reset = () => {
        setFile(null);
        setGifData(null);
        setResultUrl(null);
        setCurrentFrameDisplay(null);
        setOriginalUrl(null);
    }

    useEffect(() => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        setOriginalUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    if (!file) {
        return (
            <div className="w-full py-12">
                <FileUpload onFileSelect={handleFileSelect} accept="image/gif" />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-muted-foreground animate-pulse">Parsing GIF...</p>
            </div>
        );
    }

    if (resultUrl) {
        return (
            <div className="flex flex-col items-center space-y-8 py-8 animate-in fade-in duration-500">
                <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold">Background Removed!</h3>
                    <p className="text-muted-foreground">Transparency applied successfully</p>
                </div>

                <div className="p-4 border rounded-xl bg-card shadow-sm border-dashed border-border/60 bg-checkered-pattern">
                    <img src={resultUrl} alt="Result GIF" className="max-w-full h-auto rounded-lg shadow-md" />
                </div>

                <div className="flex gap-4">
                    <ButtonSimple variant="outline" onClick={reset}>
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Start Over
                    </ButtonSimple>

                    <a href={resultUrl} download={`nobg-${file.name}`}>
                        <ButtonSimple>
                            <Download className="mr-2 h-4 w-4" />
                            Download GIF
                        </ButtonSimple>
                    </a>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-8 py-6 max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row gap-8 items-start">
                <div className="flex-1 w-full bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <span className="font-semibold text-sm">Original</span>
                    </div>
                    <div className="p-6 flex justify-center min-h-[300px] items-center">
                        {/* Show original gif if not processing, or current frame if processing */}
                        {processing && currentFrameDisplay ? (
                            <div className="relative">
                                <img src={currentFrameDisplay} alt="Processing Frame" className="max-w-full rounded shadow opacity-50" />
                                <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-foreground">
                                    Processing...
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center">
                                {/* We can't easily show the GIF playing here without re-rendering it or using an <img> tag with blob, 
                                     but 'file' is available. */}
                                {originalUrl && (
                                    <img src={originalUrl} alt="Original" className="max-w-full rounded shadow" />
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="w-full md:w-64 flex-shrink-0 space-y-6">
                    <div className="bg-card rounded-xl border border-border p-5 shadow-sm space-y-4">
                        <h3 className="font-semibold border-b border-border pb-2">Actions</h3>

                        <div className="space-y-4">
                            <div className="flex flex-col p-3 bg-muted/50 rounded-md text-sm">
                                <span className="text-muted-foreground text-xs uppercase mb-1">Total Frames</span>
                                <span className="font-mono font-medium">{gifData?.frames.length}</span>
                            </div>

                            <ButtonSimple
                                className="w-full"
                                disabled={processing}
                                onClick={processRemoveBg}
                            >
                                {processing ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {progress}%
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="mr-2 h-4 w-4" />
                                        Remove Background
                                    </>
                                )}
                            </ButtonSimple>

                            <ButtonSimple variant="outline" className="w-full" onClick={reset} disabled={processing}>
                                Cancel
                            </ButtonSimple>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
