import { useState, useRef, useEffect } from 'react';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { FileUpload } from '@/components/ui/FileUpload';

import { Loader2, Download, ArrowRight, RefreshCcw } from 'lucide-react';
import { parseGifFile, cropGif, type GifData } from '@/lib/gif-processor';

// Simple Button Component inline for speed
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

export function GifCropper() {
    const [file, setFile] = useState<File | null>(null);
    const [gifData, setGifData] = useState<GifData | null>(null);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState(0);

    // Crop state
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();

    const [aspect, setAspect] = useState<number | undefined>(undefined);

    // Preview Canvas Ref
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!resultUrl) return;
        return () => URL.revokeObjectURL(resultUrl);
    }, [resultUrl]);

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setLoading(true);
        try {
            const data = await parseGifFile(selectedFile);
            setGifData(data);

            setGifData(data);

            // Set initial crop to full size
            const width = data.width;
            const height = data.height;
            setCrop({
                unit: '%',
                x: 0,
                y: 0,
                width: 100,
                height: 100
            });
            // We also need to set completedCrop to pixel values for the immediate state
            setCompletedCrop({
                unit: 'px',
                x: 0,
                y: 0,
                width: width,
                height: height
            });
        } catch (error) {
            console.error(error);
            alert("Failed to parse GIF");
        } finally {
            setLoading(false);
        }
    };

    // Draw the preview image (first frame) to canvas
    useEffect(() => {
        if (gifData && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) return;

            // Clear
            canvasRef.current.width = gifData.width;
            canvasRef.current.height = gifData.height;

            ctx.drawImage(gifData.canvas, 0, 0);
        }
    }, [gifData]);

    function onAspectChange(value: number | undefined) {
        setAspect(value);

        if (!gifData) return;

        if (value) {
            // Calculate the new crop based on the aspect ratio
            // We want to center it and make it as large as possible
            const width = gifData.width;
            const height = gifData.height;

            const newCrop = centerCrop(
                makeAspectCrop(
                    {
                        unit: '%',
                        width: 90,
                    },
                    value,
                    width,
                    height,
                ),
                width,
                height,
            );

            setCrop(newCrop);
            // We don't manually set completedCrop here, ReactCrop will trigger onChange -> onComplete
        } else {
            // If switching to Free, maybe just leave the current crop as is? 
            // Or reset to full? Let's leave it as is but unlock aspect.
        }
    }

    const handleCrop = async () => {
        if (!gifData || !completedCrop || !completedCrop.width || !completedCrop.height) {
            return;
        }

        setProcessing(true);
        setProgress(0);

        try {
            const blob = await cropGif(
                gifData.frames,
                completedCrop.x,
                completedCrop.y,
                completedCrop.width,
                completedCrop.height,
                (p) => setProgress(Math.round(p * 100))
            );

            const url = URL.createObjectURL(blob);
            setResultUrl(url);
        } catch (e) {
            console.error(e);
            alert("Error cropping GIF");
        } finally {
            setProcessing(false);
        }
    };

    const reset = () => {
        setFile(null);
        setGifData(null);
        setResultUrl(null);
        setCrop(undefined);
        setCompletedCrop(undefined);
    }

    if (!file) {
        return (
            <div className="w-full py-12">
                <FileUpload onFileSelect={handleFileSelect} />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-muted-foreground animate-pulse">Parsing GIF frames...</p>
            </div>
        );
    }

    if (resultUrl) {
        return (
            <div className="flex flex-col items-center space-y-8 py-8 animate-in fade-in duration-500">
                <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold">Your Cropped GIF</h3>
                    <p className="text-muted-foreground">Ready to download</p>
                </div>

                <div className="p-4 border rounded-xl bg-card shadow-sm border-dashed border-border/60">
                    <img src={resultUrl} alt="Cropped GIF" className="max-w-full h-auto rounded-lg shadow-md" />
                </div>

                <div className="flex gap-4">
                    <ButtonSimple variant="outline" onClick={reset}>
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Start Over
                    </ButtonSimple>

                    <a href={resultUrl} download={`cropped-${file.name}`}>
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
        <div className="flex flex-col lg:flex-row gap-8 py-6 items-start">
            <div className="flex-1 w-full min-w-0 bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center">
                    <span className="font-semibold text-sm">Editor</span>
                    <span className="text-xs text-muted-foreground">{gifData?.width} x {gifData?.height}px</span>
                </div>

                <div className="p-6 flex justify-center bg-checkered-pattern min-h-[400px] items-center overflow-auto">
                    {gifData && (
                        <ReactCrop
                            crop={crop}
                            onChange={(c) => setCrop(c)}
                            onComplete={(c) => setCompletedCrop(c)}
                            aspect={aspect}
                            className="shadow-2xl"
                        >
                            <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
                        </ReactCrop>
                    )}
                </div>
            </div>

            <div className="w-full lg:w-80 flex-shrink-0 space-y-6 sticky top-24">
                <div className="bg-card rounded-xl border border-border p-5 shadow-sm space-y-4">
                    <h3 className="font-semibold border-b border-border pb-2">Actions</h3>

                    <div className="space-y-4">
                        <div>
                            <span className="text-xs font-medium text-muted-foreground uppercase mb-2 block">Aspect Ratio</span>
                            <div className="grid grid-cols-3 gap-2">
                                <ButtonSimple
                                    variant={aspect === undefined ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(undefined)}
                                >
                                    Free
                                </ButtonSimple>
                                <ButtonSimple
                                    variant={aspect === 1 ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(1)}
                                >
                                    Square
                                </ButtonSimple>
                                <ButtonSimple
                                    variant={aspect === 16 / 9 ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(16 / 9)}
                                >
                                    16:9
                                </ButtonSimple>
                                <ButtonSimple
                                    variant={aspect === 4 / 3 ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(4 / 3)}
                                >
                                    4:3
                                </ButtonSimple>
                                <ButtonSimple
                                    variant={aspect === 9 / 16 ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(9 / 16)}
                                >
                                    9:16
                                </ButtonSimple>
                                <ButtonSimple
                                    variant={aspect === 3 / 2 ? "primary" : "outline"}
                                    className="text-xs h-8"
                                    onClick={() => onAspectChange(3 / 2)}
                                >
                                    3:2
                                </ButtonSimple>

                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex flex-col p-2 bg-muted/50 rounded-md">
                                <span className="text-muted-foreground text-xs uppercase">Original</span>
                                <span className="font-mono">{gifData?.width} x {gifData?.height}</span>
                            </div>
                            <div className="flex flex-col p-2 bg-muted/50 rounded-md">
                                <span className="text-muted-foreground text-xs uppercase">Cropped</span>
                                <span className="font-mono">
                                    {completedCrop?.width ? Math.round(completedCrop.width) : '-'} x {completedCrop?.height ? Math.round(completedCrop.height) : '-'}
                                </span>
                            </div>
                        </div>

                        <ButtonSimple
                            className="w-full"
                            disabled={!completedCrop?.width || processing}
                            onClick={handleCrop}
                        >
                            {processing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Processing {progress}%
                                </>
                            ) : (
                                <>
                                    Crop & Export <ArrowRight className="ml-2 h-4 w-4" />
                                </>
                            )}
                        </ButtonSimple>

                        <ButtonSimple variant="outline" className="w-full" onClick={reset} disabled={processing}>
                            Cancel
                        </ButtonSimple>
                    </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm text-blue-500">
                    <p>Tip: Draw a rectangle on the image to select the crop area.</p>
                </div>
            </div>
        </div >
    );
}

// Add checksum CSS for transparency background
const styles = `
.bg-checkered-pattern {
  background-color: #f0f0f0;
  background-image:
    linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%, #ddd),
    linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%, #ddd);
  background-size: 20px 20px;
  background-position: 0 0, 10px 10px;
}
`;
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);
