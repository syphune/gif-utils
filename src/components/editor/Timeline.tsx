import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, memo } from 'react';

interface TimelineProps {
    thumbnails: ImageBitmap[];
    currentFrame: number;
    onSeek: (frame: number) => void;
    trimRange: [number, number];
    onTrimChange: (range: [number, number]) => void;
    onTrimCommit?: (range: [number, number]) => void;
}

// 1. Extract Thumbnail to be stable
const Thumbnail = memo(({ frame }: { frame: ImageBitmap }) => {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (ref.current && frame) {
            const ctx = ref.current.getContext('2d');
            ref.current.width = frame.width;
            ref.current.height = frame.height;
            ctx?.drawImage(frame, 0, 0);
        }
    }, [frame]);

    return <canvas ref={ref} className="w-full h-full object-cover" />;
});
Thumbnail.displayName = 'Thumbnail';

export function Timeline({ thumbnails, currentFrame, onSeek, trimRange, onTrimChange, onTrimCommit }: TimelineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'range' | null>(null);
    const mousePosRef = useRef({ x: 0 });
    const scrollIntervalRef = useRef<number | null>(null);
    const dragStartIndexRef = useRef(0);
    const dragStartXRef = useRef(0);
    const [zoom, setZoom] = useState(1);
    const [hoverFrame, setHoverFrame] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState(0);
    const playheadDraggingRef = useRef(false);
    const playheadOffsetRef = useRef(0);

    // Assuming fixed width per frame for easier calculation for now. 
    const BASE_FRAME_WIDTH = 48; // px (w-12)
    const GAP = 4; // px (gap-1)
    const FRAME_WIDTH = Math.max(24, Math.min(120, Math.round(BASE_FRAME_WIDTH * zoom)));
    const ITEM_FULL_WIDTH = FRAME_WIDTH + GAP;

    const handleMouseDown = (e: React.MouseEvent, type: 'start' | 'end' | 'range') => {
        e.stopPropagation();
        setIsDragging(type);
        mousePosRef.current = { x: e.clientX };
        if (type === 'range') {
            dragStartIndexRef.current = trimRange[0];
            dragStartXRef.current = e.clientX;
        }
    };

    const getFrameIndexFromMouse = (mouseX: number) => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        const relativeX = mouseX - rect.left + containerRef.current.scrollLeft;
        let index = Math.floor(relativeX / ITEM_FULL_WIDTH);
        index = Math.max(0, Math.min(index, thumbnails.length - 1));
        return index;
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
            e.preventDefault();
            const delta = -e.deltaY * 0.01;
            setZoom((prev) => Math.min(3, Math.max(0.5, prev + delta)));
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, []);

    useEffect(() => {
        const handleMouseUp = () => {
            setIsDragging(null);
            if (scrollIntervalRef.current) {
                cancelAnimationFrame(scrollIntervalRef.current);
                scrollIntervalRef.current = null;
            }
            if (onTrimCommit) onTrimCommit(trimRange);
        };

        const updateTrim = (mouseX: number) => {
            if (!isDragging || !containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const relativeX = mouseX - rect.left + containerRef.current.scrollLeft;
            let index = Math.floor(relativeX / ITEM_FULL_WIDTH);

            index = Math.max(0, Math.min(index, thumbnails.length - 1));

            if (isDragging === 'start') {
                if (index < trimRange[1]) {
                    onTrimChange([index, trimRange[1]]);
                }
            } else if (isDragging === 'end') {
                if (index > trimRange[0]) {
                    onTrimChange([trimRange[0], index]);
                }
            } else if (isDragging === 'range') {
                const length = trimRange[1] - trimRange[0];
                const deltaFrames = Math.round((mouseX - dragStartXRef.current) / ITEM_FULL_WIDTH);
                let newStart = dragStartIndexRef.current + deltaFrames;
                newStart = Math.max(0, Math.min(newStart, thumbnails.length - 1 - length));
                const newEnd = newStart + length;
                onTrimChange([newStart, newEnd]);
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            mousePosRef.current = { x: e.clientX };
            updateTrim(e.clientX);
        };

        const autoScroll = () => {
            if (!isDragging || !containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const mouseX = mousePosRef.current.x;
            const threshold = 10; // Edge Sensitivity
            const maxSpeed = 50; // Warp Speed

            let scrollDelta = 0;
            if (mouseX > rect.right - threshold) {
                const distance = mouseX - (rect.right - threshold);
                scrollDelta = Math.min(maxSpeed, distance * 40);
            } else if (mouseX < rect.left + threshold) {
                const distance = (rect.left + threshold) - mouseX;
                scrollDelta = -Math.min(maxSpeed, distance * 40);
            }

            if (scrollDelta !== 0) {
                containerRef.current.scrollLeft += scrollDelta;
                updateTrim(mouseX);
            }

            scrollIntervalRef.current = requestAnimationFrame(autoScroll);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            scrollIntervalRef.current = requestAnimationFrame(autoScroll);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            if (scrollIntervalRef.current) cancelAnimationFrame(scrollIntervalRef.current);
        };
    }, [isDragging, trimRange, thumbnails.length, onTrimChange, onTrimCommit]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!playheadDraggingRef.current) return;
            const target = getFrameIndexFromMouse(e.clientX - playheadOffsetRef.current);
            onSeek(target);
        };

        const handleMouseUp = () => {
            playheadDraggingRef.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [thumbnails.length, onSeek]);

    return (
        <div className="relative h-24 overflow-hidden select-none">
            {/* Scrollable Container */}
            <div
                ref={containerRef}
                className="absolute inset-0 overflow-x-auto flex items-center px-4 custom-scrollbar"
                onMouseMove={(e) => {
                    if (!containerRef.current) return;
                    const rect = containerRef.current.getBoundingClientRect();
                    const relativeX = e.clientX - rect.left + containerRef.current.scrollLeft;
                    const idx = Math.floor(relativeX / ITEM_FULL_WIDTH);
                    if (idx >= 0 && idx < thumbnails.length) {
                        setHoverFrame(idx);
                        setHoverX(relativeX);
                    } else {
                        setHoverFrame(null);
                    }
                }}
                onMouseLeave={() => setHoverFrame(null)}
            >
                <div className="flex gap-1 relative">
                    {hoverFrame !== null && (
                        <div
                            className="absolute -top-6 z-50 px-2 py-1 rounded-md text-[10px] font-mono bg-black/80 text-white pointer-events-none"
                            style={{ left: hoverX - 12 }}
                        >
                            Frame {hoverFrame + 1}
                        </div>
                    )}
                    {thumbnails.map((thumb, index) => (
                        <div
                            key={index}
                            onClick={() => onSeek(index)}
                            className={cn(
                                "h-16 shrink-0 rounded-sm cursor-pointer relative overflow-hidden bg-muted transition-shadow",
                                currentFrame === index && "ring-2 ring-blue-500 z-10 shadow-lg shadow-blue-500/20"
                            )}
                            style={{ width: FRAME_WIDTH }}
                        >
                            <Thumbnail frame={thumb} />

                            {/* Frame Number */}
                            {index % 5 === 0 && (
                                <div className="absolute top-1 left-1 text-[8px] text-white font-bold drop-shadow-md opacity-70">
                                    {index + 1}
                                </div>
                            )}

                            {/* Dimmed if trimmed out */}
                            {(index < trimRange[0] || index > trimRange[1]) && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
                            )}
                        </div>
                    ))}

                    {/* PLAYHEAD */}
                    {thumbnails.length > 0 && (
                        <div
                            style={{ left: currentFrame * ITEM_FULL_WIDTH + FRAME_WIDTH / 2 }}
                            className="absolute top-0 bottom-0 w-0 z-40"
                        >
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-500 shadow-md cursor-ew-resize"
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    playheadDraggingRef.current = true;
                                    playheadOffsetRef.current = e.clientX - (e.currentTarget as HTMLDivElement).getBoundingClientRect().left;
                                }}
                            />
                            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-blue-500/80 pointer-events-none" />
                        </div>
                    )}

                    {/* TRIM OVERLAY & HANDLES */}
                    {thumbnails.length > 0 && (
                        <>
                            {/* Start Handle */}
                            <div
                                style={{ left: trimRange[0] * ITEM_FULL_WIDTH }}
                                className="absolute top-0 bottom-0 w-8 -ml-4 z-30 cursor-ew-resize group flex flex-col justify-center items-center"
                                onMouseDown={(e) => handleMouseDown(e, 'start')}
                            >
                                <div className="h-full w-1.5 bg-yellow-400 group-hover:bg-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.6)] transition-colors rounded-full" />
                                <div className="absolute top-0 w-4 h-4 bg-yellow-400 rounded-full border-2 border-background shadow-md group-active:scale-125 transition-transform" />
                            </div>

                            {/* End Handle */}
                            <div
                                style={{ left: (trimRange[1] + 1) * ITEM_FULL_WIDTH - GAP }}
                                className="absolute top-0 bottom-0 w-8 -ml-4 z-30 cursor-ew-resize group flex flex-col justify-center items-center"
                                onMouseDown={(e) => handleMouseDown(e, 'end')}
                            >
                                <div className="h-full w-1.5 bg-yellow-400 group-hover:bg-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.6)] transition-colors rounded-full" />
                                <div className="absolute bottom-0 w-4 h-4 bg-yellow-400 rounded-full border-2 border-background shadow-md group-active:scale-125 transition-transform" />
                            </div>

                            {/* Active Region Border */}
                            <div
                                style={{
                                    left: trimRange[0] * ITEM_FULL_WIDTH,
                                    width: (trimRange[1] - trimRange[0] + 1) * ITEM_FULL_WIDTH - GAP
                                }}
                                className="absolute top-0 bottom-0 border-t-2 border-b-2 border-yellow-400/30 bg-yellow-400/5 cursor-grab active:cursor-grabbing"
                                onMouseDown={(e) => handleMouseDown(e, 'range')}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
