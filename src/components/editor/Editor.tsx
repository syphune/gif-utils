
import { useState, useEffect, useRef } from 'react';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { FileUpload } from '@/components/ui/FileUpload';
import { ArrowLeft, Download, Play, Pause, Loader2, ZoomIn, ZoomOut, RotateCcw, Undo2, Redo2, Github } from 'lucide-react';
import { type GifData, parseGifFile, generateThumbnails, cropGif } from '@/lib/gif-processor';
import { type Crop, type PixelCrop } from 'react-image-crop';

export function Editor() {
    const [file, setFile] = useState<File | null>(null);
    const [gifData, setGifData] = useState<GifData | null>(null);
    const [thumbnails, setThumbnails] = useState<ImageBitmap[]>([]);
    const [loading, setLoading] = useState(false);

    // Playback State
    const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const currentFrameIdxRef = useRef(0);

    // Trim State [start, end]
    const [trimRange, setTrimRange] = useState<[number, number]>([0, 0]);

    // Tool State
    const [activeTool, setActiveTool] = useState<string | null>(null);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const [exporting, setExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [appliedCrop, setAppliedCrop] = useState<PixelCrop | null>(null);
    const [, setHistoryVersion] = useState(0);

    // View State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });

    type EditorSnapshot = {
        trimRange: [number, number];
        appliedCrop: PixelCrop | null;
    };

    // Rendering State
    // We maintain a "composition canvas" that holds the current visual state of the GIF
    const compositionCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const compositionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const lastRenderedFrameRef = useRef<number>(-1);

    // Keyframe Snapshots for fast seeking (O(1) lookup + O(10) render)
    const snapshotsRef = useRef<Map<number, ImageBitmap>>(new Map());

    // The image to show on Stage (snapshot of composition)
    const [stageImage, setStageImage] = useState<ImageBitmap | undefined>(undefined);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const stageRootRef = useRef<HTMLDivElement>(null);
    const thumbnailsRef = useRef<ImageBitmap[]>([]);
    const stageImageRef = useRef<ImageBitmap | undefined>(undefined);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const pointerStartRef = useRef({ x: 0, y: 0 });
    const historyRef = useRef<{ past: EditorSnapshot[]; future: EditorSnapshot[] }>({ past: [], future: [] });
    const lastCommittedTrimRef = useRef<[number, number] | null>(null);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input (if we add any later)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
                e.preventDefault();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                handleRedo();
                return;
            }

            if (e.key === 'Enter' && activeTool === 'crop') {
                if (completedCrop && completedCrop.width && completedCrop.height) {
                    pushHistory(getSnapshot());
                    setAppliedCrop({ ...completedCrop });
                    setCrop({
                        unit: 'px',
                        x: completedCrop.x,
                        y: completedCrop.y,
                        width: completedCrop.width,
                        height: completedCrop.height
                    });
                    setCompletedCrop({ ...completedCrop });
                    autoFit();
                }
                return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    break;
                case '[':
                    setTrimStart();
                    break;
                case ']':
                    setTrimEnd();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    handleSeek(Math.max(0, currentFrameIdx - 1));
                    break;
                case 'ArrowRight':
                    if (gifData) {
                        e.preventDefault();
                        handleSeek(Math.min(gifData.frames.length - 1, currentFrameIdx + 1));
                    }
                    break;
            }
        };

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('wheel', handleWheel);
        };
    }, [currentFrameIdx, gifData, isPlaying, activeTool, completedCrop, appliedCrop, trimRange]); // Dependencies needed for handlers

    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            const container = editorContainerRef.current;
            if (!container) return;

            const target = e.target as Node | null;
            if (target && !container.contains(target)) return;

            e.preventDefault();
            const stageRoot = stageRootRef.current;
            const rect = (stageRoot ?? container).getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const shouldZoom = !e.shiftKey;
            if (shouldZoom) {
                setZoom(prevZoom => {
                    const delta = -e.deltaY * 0.01;
                    const newZoom = Math.min(Math.max(0.1, prevZoom + delta), 20);

                    setPan(prevPan => {
                        const worldX = (mouseX - prevPan.x) / prevZoom;
                        const worldY = (mouseY - prevPan.y) / prevZoom;
                        return {
                            x: mouseX - worldX * newZoom,
                            y: mouseY - worldY * newZoom
                        };
                    });

                    return newZoom;
                });
            } else {
                setPan(prev => ({
                    x: prev.x - e.deltaX,
                    y: prev.y - e.deltaY
                }));
            }
        };

        window.addEventListener('wheel', onWheel, { passive: false, capture: true });
        return () => window.removeEventListener('wheel', onWheel, { capture: true } as AddEventListenerOptions);
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button === 1 || (e.button === 0 && activeTool !== 'crop')) {
            e.preventDefault();
            isPanningRef.current = true;
            pointerStartRef.current = { x: e.clientX, y: e.clientY };
            panStartRef.current = { x: pan.x, y: pan.y };
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isPanningRef.current) return;
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        setPan({
            x: panStartRef.current.x + dx,
            y: panStartRef.current.y + dy
        });
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    };

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setLoading(true);
        try {
            const data = await parseGifFile(selectedFile);
            setGifData(data);

            // Generate Thumbnails (Low RAM)
            const thumbs = await generateThumbnails(data);
            thumbnailsRef.current.forEach(bmp => bmp.close());
            setThumbnails(thumbs);
            thumbnailsRef.current = thumbs;

            // Initialize Composition Canvas
            const cvs = document.createElement('canvas');
            cvs.width = data.width;
            cvs.height = data.height;
            compositionCanvasRef.current = cvs;
            compositionCtxRef.current = cvs.getContext('2d', { willReadFrequently: true });

            // Reset State
            setCurrentFrameIdx(0);
            lastRenderedFrameRef.current = -1;
            setTrimRange([0, data.frames.length - 1]);
            setAppliedCrop(null);
            historyRef.current = { past: [], future: [] };
            lastCommittedTrimRef.current = [0, data.frames.length - 1];

            // Clear Snapshots
            snapshotsRef.current.forEach(bmp => bmp.close());
            snapshotsRef.current.clear();

            // Initial Render
            await renderToFrame(0, data, cvs, compositionCtxRef.current!);

        } catch (error) {
            console.error(error);
            alert("Failed to parse GIF");
            setFile(null);
        } finally {
            setLoading(false);
        }
    };

    const autoFit = () => {
        if (!gifData || !editorContainerRef.current) return;
        const container = editorContainerRef.current;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0) return;

        const vW = rect.width;
        const vH = rect.height;
        const p = 80; // Total padding (40px per side)

        const availableW = vW - p;
        const availableH = vH - p;

        const contentW = appliedCrop ? appliedCrop.width : gifData.width;
        const contentH = appliedCrop ? appliedCrop.height : gifData.height;
        const scaleW = availableW / contentW;
        const scaleH = availableH / contentH;
        // Fit to viewport, but don't upscale small GIFs past 200% on initial load for clarity
        const newZoom = Math.min(scaleW, scaleH, 2);

        setZoom(newZoom);
        setPan({
            x: (vW - contentW * newZoom) / 2,
            y: (vH - contentH * newZoom) / 2
        });
    };

    // Auto-fit on load and resize
    useEffect(() => {
        if (!gifData) return;

        // Initial fit
        const timer = setTimeout(autoFit, 50);

        // Resize listener
        const handleResize = () => autoFit();
        window.addEventListener('resize', handleResize);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', handleResize);
        };
    }, [gifData, appliedCrop]);

    useEffect(() => {
        return () => {
            thumbnailsRef.current.forEach(bmp => bmp.close());
            thumbnailsRef.current = [];
            snapshotsRef.current.forEach(bmp => bmp.close());
            snapshotsRef.current.clear();
            if (stageImageRef.current) stageImageRef.current.close();
        };
    }, []);

    useEffect(() => {
        currentFrameIdxRef.current = currentFrameIdx;
    }, [currentFrameIdx]);

    const getSnapshot = (): EditorSnapshot => ({
        trimRange,
        appliedCrop: appliedCrop ? { ...appliedCrop } : null
    });

    const pushHistory = (snapshot: EditorSnapshot) => {
        historyRef.current.past.push(snapshot);
        historyRef.current.future = [];
        setHistoryVersion(v => v + 1);
    };

    const handleUndo = () => {
        const current = getSnapshot();
        const past = historyRef.current.past;
        if (past.length === 0) return;
        const previous = past.pop()!;
        historyRef.current.future.push(current);
        setTrimRange(previous.trimRange);
        setAppliedCrop(previous.appliedCrop);
        if (previous.appliedCrop) {
            setCrop({
                unit: 'px',
                x: previous.appliedCrop.x,
                y: previous.appliedCrop.y,
                width: previous.appliedCrop.width,
                height: previous.appliedCrop.height
            });
            setCompletedCrop({ ...previous.appliedCrop });
        } else {
            setCrop(undefined);
            setCompletedCrop(undefined);
        }
        lastCommittedTrimRef.current = previous.trimRange;
        setHistoryVersion(v => v + 1);
    };

    const handleRedo = () => {
        const future = historyRef.current.future;
        if (future.length === 0) return;
        const current = getSnapshot();
        const next = future.pop()!;
        historyRef.current.past.push(current);
        setTrimRange(next.trimRange);
        setAppliedCrop(next.appliedCrop);
        if (next.appliedCrop) {
            setCrop({
                unit: 'px',
                x: next.appliedCrop.x,
                y: next.appliedCrop.y,
                width: next.appliedCrop.width,
                height: next.appliedCrop.height
            });
            setCompletedCrop({ ...next.appliedCrop });
        } else {
            setCrop(undefined);
            setCompletedCrop(undefined);
        }
        lastCommittedTrimRef.current = next.trimRange;
        setHistoryVersion(v => v + 1);
    };

    /**
     * Core Rendering Logic (On-The-Fly)
     * Renders from lastRenderedFrame -> targetFrame
     */
    /**
     * Core Rendering Logic (On-The-Fly)
     * Renders from lastRenderedFrame -> targetFrame
     */
    const renderToFrame = async (
        targetFrame: number,
        data: GifData,
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D
    ) => {
        let startFrame = 0;
        let restoreSnapshot: ImageBitmap | null = null;
        let previousFrameData: ImageData | null = null;

        // 1. Determine optimal start point
        // Check if we can continue from last render efficiently
        if (lastRenderedFrameRef.current !== -1 && targetFrame >= lastRenderedFrameRef.current) {
            startFrame = lastRenderedFrameRef.current + 1;
        } else {
            // Backwards seek or jump: Find closest snapshot
            let closestFrame = -1;
            snapshotsRef.current.forEach((_, frameIdx) => {
                if (frameIdx <= targetFrame && frameIdx > closestFrame) {
                    closestFrame = frameIdx;
                }
            });

            if (closestFrame !== -1) {
                startFrame = closestFrame + 1; // Start rendering AFTER the snapshot
                restoreSnapshot = snapshotsRef.current.get(closestFrame)!;
            }
        }

        // 2. Restore State if needed
        if (startFrame === 0) {
            ctx.clearRect(0, 0, data.width, data.height);
        } else if (restoreSnapshot) {
            ctx.clearRect(0, 0, data.width, data.height);
            ctx.drawImage(restoreSnapshot, 0, 0);
        }

        // 3. Render Loop
        for (let i = startFrame; i <= targetFrame; i++) {
            const frame = data.frames[i];

            // Disposal Handling (Simple Overrwrite/Clear for now)
            if (i > 0) {
                const prevFrame = data.frames[i - 1];
                if (prevFrame.disposalType === 2) {
                    ctx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
                } else if (prevFrame.disposalType === 3 && previousFrameData) {
                    ctx.putImageData(previousFrameData, 0, 0);
                }
            }

            if (frame.disposalType === 3) {
                previousFrameData = ctx.getImageData(0, 0, data.width, data.height);
            }

            // Draw Patch
            const patchData = new ImageData(
                new Uint8ClampedArray(frame.patch),
                frame.dims.width,
                frame.dims.height
            );
            const patchBitmap = await createImageBitmap(patchData);
            ctx.drawImage(patchBitmap, frame.dims.left, frame.dims.top);
            patchBitmap.close();

            // 4. Save Snapshot (Every 10 frames)
            if (i % 10 === 0 && !snapshotsRef.current.has(i)) {
                const snapshot = await createImageBitmap(canvas);
                snapshotsRef.current.set(i, snapshot);
            }
        }

        lastRenderedFrameRef.current = targetFrame;

        // Update Stage
        const snapshot = await createImageBitmap(canvas);
        setStageImage(prev => {
            if (prev) prev.close();
            return snapshot;
        });
        stageImageRef.current = snapshot;
    };

    // Playback Loop (RAF)
    useEffect(() => {
        let animationFrameId: number;
        let lastTime = performance.now();
        let accumulator = 0;

        const loop = (currentTime: number) => {
            if (!isPlaying || !gifData) return;

            const frameForDelay = gifData.frames[currentFrameIdxRef.current];
            const updateInterval = frameForDelay?.delay || 100;
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;
            accumulator += deltaTime;

            if (accumulator >= updateInterval) {
                setCurrentFrameIdx(prev => {
                    const next = prev + 1;
                    const [start, end] = trimRange;
                    let target = next;

                    if (target > end) target = start; // Loop

                    // Trigger Render
                    if (compositionCanvasRef.current && compositionCtxRef.current) {
                        renderToFrame(target, gifData, compositionCanvasRef.current, compositionCtxRef.current);
                    }

                    return target;
                });
                accumulator -= updateInterval;
                if (accumulator > updateInterval * 5) accumulator = 0;
            }

            animationFrameId = requestAnimationFrame(loop);
        };

        if (isPlaying) {
            lastTime = performance.now();
            accumulator = 0;
            animationFrameId = requestAnimationFrame(loop);
        }

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isPlaying, gifData, trimRange]);

    // Safe Seek Logic (Throttled)
    const isRenderingRef = useRef(false);
    const nextSeekFrameRef = useRef<number | null>(null);

    const processSeekQueue = async () => {
        if (isRenderingRef.current) return;

        // If there's a next frame waiting
        if (nextSeekFrameRef.current !== null) {
            const target = nextSeekFrameRef.current;
            nextSeekFrameRef.current = null; // Clear queue
            await performRender(target);
            // Check again after finishing
            processSeekQueue();
        }
    };

    const performRender = async (index: number) => {
        isRenderingRef.current = true;
        try {
            if (gifData && compositionCanvasRef.current && compositionCtxRef.current) {
                await renderToFrame(index, gifData, compositionCanvasRef.current, compositionCtxRef.current);
            }
        } finally {
            isRenderingRef.current = false;
        }
    };

    // Manual Seek
    const handleSeek = (index: number) => {
        setCurrentFrameIdx(index);
        setIsPlaying(false);

        // Queue this frame
        nextSeekFrameRef.current = index;
        processSeekQueue();
    };

    // Trim Actions
    const setTrimStart = () => {
        if (currentFrameIdx >= trimRange[1]) return; // Cannot start after end
        pushHistory(getSnapshot());
        setTrimRange([currentFrameIdx, trimRange[1]]);
        lastCommittedTrimRef.current = [currentFrameIdx, trimRange[1]];
    };

    const setTrimEnd = () => {
        if (currentFrameIdx <= trimRange[0]) return; // Cannot end before start
        pushHistory(getSnapshot());
        setTrimRange([trimRange[0], currentFrameIdx]);
        lastCommittedTrimRef.current = [trimRange[0], currentFrameIdx];
    };

    const handleExport = async () => {
        if (!gifData || exporting) return;

        setExporting(true);
        setExportProgress(0);

        try {
            // Trim the frames first
            const trimmedFrames = gifData.frames.slice(trimRange[0], trimRange[1] + 1);

            let blob: Blob;
            const exportCrop = appliedCrop ?? completedCrop;
            if (exportCrop && exportCrop.width && exportCrop.height) {
                // Apply Crop (completedCrop is in original GIF pixels)
                const clamp = (value: number, min: number, max: number) =>
                    Math.min(Math.max(value, min), max);

                const cropX = clamp(Math.round(exportCrop.x), 0, gifData.width - 1);
                const cropY = clamp(Math.round(exportCrop.y), 0, gifData.height - 1);
                const cropWidth = clamp(
                    Math.round(exportCrop.width),
                    1,
                    gifData.width - cropX
                );
                const cropHeight = clamp(
                    Math.round(exportCrop.height),
                    1,
                    gifData.height - cropY
                );

                blob = await cropGif(
                    trimmedFrames,
                    cropX,
                    cropY,
                    cropWidth,
                    cropHeight,
                    (p) => setExportProgress(Math.round(p * 100))
                );
            } else {
                // No crop, just re-encode trimmed (or just full if no trim, but here we always have trim range)
                blob = await cropGif(
                    trimmedFrames,
                    0, 0, gifData.width, gifData.height,
                    (p) => setExportProgress(Math.round(p * 100))
                );
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `edited-${file?.name || 'video.gif'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export failed:", error);
            alert("Export failed. Check console for details.");
        } finally {
            setExporting(false);
        }
    };

    if (!file || !gifData || loading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-8">
                {loading ? (
                    <div className="flex flex-col items-center space-y-4">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-muted-foreground">Processing GIF...</p>
                    </div>
                ) : (
                    <div className="max-w-xl w-full space-y-8 text-center">
                        <h1 className="text-4xl font-bold tracking-tight">GIF Editor</h1>
                        <p className="text-muted-foreground">Upload a GIF to start editing locally.</p>
                        <a
                            href="https://github.com/syphune/gif-utils"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                        >
                            <Github className="h-4 w-4" />
                            github.com/syphune/gif-utils
                        </a>
                        <div className="border-2 border-dashed border-border rounded-xl p-12 hover:bg-accent/50 transition-colors">
                            <FileUpload onFileSelect={handleFileSelect} accept="image/gif" />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
            <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card shrink-0 z-50">
                <div className="flex items-center gap-4">
                    <button onClick={() => { setFile(null); setGifData(null); }} className="p-2 hover:bg-accent rounded-full">
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <span className="font-medium truncate max-w-[200px]">{file.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <a
                        href="https://github.com/syphune/gif-utils"
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 text-sm font-medium border border-border rounded-full hover:bg-accent inline-flex items-center gap-2"
                        title="GitHub"
                    >
                        <Github className="h-4 w-4" />
                        GitHub
                    </a>
                    <div className="flex items-center bg-secondary rounded-lg border border-border mr-2">
                        <button
                            onClick={handleUndo}
                            className="p-1.5 hover:bg-accent rounded-l-lg disabled:opacity-50"
                            title="Undo"
                            disabled={historyRef.current.past.length === 0}
                        >
                            <Undo2 className="h-4 w-4" />
                        </button>
                        <button
                            onClick={handleRedo}
                            className="p-1.5 hover:bg-accent rounded-r-lg disabled:opacity-50"
                            title="Redo"
                            disabled={historyRef.current.future.length === 0}
                        >
                            <Redo2 className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="flex items-center bg-secondary rounded-lg border border-border mr-2">
                        <button
                            onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}
                            className="p-1.5 hover:bg-accent rounded-l-lg"
                            title="Zoom Out"
                        >
                            <ZoomOut className="h-4 w-4" />
                        </button>
                        <span className="text-xs font-mono w-12 text-center border-x border-border/50">
                            {Math.round(zoom * 100)}%
                        </span>
                        <button
                            onClick={() => setZoom(z => Math.min(5, z + 0.1))}
                            className="p-1.5 hover:bg-accent rounded-r-lg"
                            title="Zoom In"
                        >
                            <ZoomIn className="h-4 w-4" />
                        </button>
                        <button
                            onClick={autoFit}
                            className="p-1.5 hover:bg-accent ml-1 rounded-lg"
                            title="Reset Zoom & Center"
                        >
                            <RotateCcw className="h-3 w-3" />
                        </button>
                    </div>

                    <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="bg-primary text-primary-foreground px-4 py-1.5 rounded-full text-sm font-medium hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50"
                    >
                        {exporting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Exporting {exportProgress}%
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4" />
                                Export
                            </>
                        )}
                    </button>
                </div>
            </header>

            <div className="flex-1 flex flex-col relative min-h-0">
                <div
                    ref={editorContainerRef}
                    className="flex-1 bg-neutral-900/50 relative flex items-center justify-center p-8 overflow-hidden"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <Stage
                        width={appliedCrop ? appliedCrop.width : gifData.width}
                        height={appliedCrop ? appliedCrop.height : gifData.height}
                        currentFrameImage={stageImage}
                        appliedCrop={appliedCrop}
                        isCropping={activeTool === 'crop'}
                        crop={crop}
                        onCropChange={setCrop}
                        onCropComplete={setCompletedCrop}
                        scale={zoom}
                        x={pan.x}
                        y={pan.y}
                        rootRef={stageRootRef}
                    />
                </div>

                <div className="h-72 bg-card border-t border-border flex flex-col shrink-0 z-40">
                    <div className="h-12 border-b border-border flex items-center px-4 gap-4 justify-between">
                        <Toolbar
                            activeTool={activeTool}
                            onToolSelect={(toolId) => {
                                setActiveTool(toolId);
                                if (toolId === 'crop') {
                                    const base = appliedCrop ?? {
                                        unit: 'px' as const,
                                        x: 0,
                                        y: 0,
                                        width: gifData.width,
                                        height: gifData.height
                                    };
                                    setCrop({
                                        unit: 'px',
                                        x: base.x,
                                        y: base.y,
                                        width: base.width,
                                        height: base.height
                                    });
                                    setCompletedCrop({
                                        unit: 'px',
                                        x: base.x,
                                        y: base.y,
                                        width: base.width,
                                        height: base.height
                                    });
                                }
                            }}
                        />

                        {/* Trim Controls for MVP */}
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Cut:</span>
                            <button onClick={setTrimStart} className="px-2 py-1 bg-secondary rounded hover:bg-secondary/80 border border-border">Set Start ([)</button>
                            <button onClick={setTrimEnd} className="px-2 py-1 bg-secondary rounded hover:bg-secondary/80 border border-border">Set End (])</button>
                        </div>
                    </div>

                    <div className="h-10 border-b border-border/50 flex items-center justify-between px-4 bg-muted/20">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsPlaying(!isPlaying)}
                                className="p-1 hover:bg-accent rounded"
                            >
                                {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                            </button>
                            <span className="text-xs font-mono text-muted-foreground">
                                {currentFrameIdx + 1} / {thumbnails.length}
                                <span className="ml-2 text-yellow-500">
                                    (Trim: {trimRange[0] + 1}-{trimRange[1] + 1})
                                </span>
                            </span>
                        </div>
                    </div>

                    <div className="flex-1 overflow-x-auto p-4 custom-scrollbar">
                        <Timeline
                            thumbnails={thumbnails}
                            currentFrame={currentFrameIdx}
                            onSeek={handleSeek}
                            trimRange={trimRange}
                            onTrimChange={(newRange) => {
                                const [newStart, newEnd] = newRange;
                                const [oldStart, oldEnd] = trimRange;

                                setTrimRange(newRange);

                                // Live Preview: Seek to the handle being dragged
                                if (newStart !== oldStart) {
                                    handleSeek(newStart);
                                } else if (newEnd !== oldEnd) {
                                    handleSeek(newEnd);
                                }
                            }}
                            onTrimCommit={(range) => {
                                const last = lastCommittedTrimRef.current;
                                if (!last || last[0] !== range[0] || last[1] !== range[1]) {
                                    pushHistory({
                                        trimRange: last ?? trimRange,
                                        appliedCrop
                                    });
                                    lastCommittedTrimRef.current = range;
                                    setTrimRange(range);
                                }
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
