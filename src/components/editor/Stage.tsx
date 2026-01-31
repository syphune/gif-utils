import { useEffect, useRef, type Ref } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface StageProps {
    width: number;
    height: number;
    currentFrameImage?: ImageBitmap;
    appliedCrop?: PixelCrop | null;
    // Crop Props
    isCropping: boolean;
    crop?: Crop;
    onCropChange?: (crop: Crop) => void;
    onCropComplete?: (crop: PixelCrop) => void;
    scale?: number;
    x?: number;
    y?: number;
    rootRef?: Ref<HTMLDivElement>;
}

export function Stage({
    width,
    height,
    currentFrameImage,
    appliedCrop,
    isCropping,
    crop,
    onCropChange,
    onCropComplete,
    scale = 1,
    x = 0,
    y = 0,
    rootRef
}: StageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Effect to render the current frame
    useEffect(() => {
        if (!canvasRef.current || !currentFrameImage) return;

        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        // Set canvas dimensions to native size
        if (canvasRef.current.width !== width) canvasRef.current.width = width;
        if (canvasRef.current.height !== height) canvasRef.current.height = height;

        // Clear and Draw
        ctx.clearRect(0, 0, width, height);
        if (appliedCrop && appliedCrop.width > 0 && appliedCrop.height > 0) {
            ctx.drawImage(
                currentFrameImage,
                appliedCrop.x,
                appliedCrop.y,
                appliedCrop.width,
                appliedCrop.height,
                0,
                0,
                width,
                height
            );
        } else {
            ctx.drawImage(currentFrameImage, 0, 0);
        }

    }, [currentFrameImage, width, height, appliedCrop]);

    const scaleCropToDisplay = (c?: Crop) => {
        if (!c) return c;
        const s = scale || 1;
        const baseX = appliedCrop ? appliedCrop.x : 0;
        const baseY = appliedCrop ? appliedCrop.y : 0;
        return {
            ...c,
            unit: 'px',
            x: (c.x - baseX) * s,
            y: (c.y - baseY) * s,
            width: c.width * s,
            height: c.height * s
        } as Crop;
    };

    const normalizeCropFromDisplay = (c: Crop) => {
        const s = scale || 1;
        if (s === 0) return c;
        const baseX = appliedCrop ? appliedCrop.x : 0;
        const baseY = appliedCrop ? appliedCrop.y : 0;
        return {
            ...c,
            unit: 'px',
            x: c.x / s + baseX,
            y: c.y / s + baseY,
            width: c.width / s,
            height: c.height / s
        } as Crop;
    };

    const displayCrop = isCropping ? scaleCropToDisplay(crop) : undefined;

    return (
        <div ref={rootRef} className="relative w-full h-full overflow-hidden bg-neutral-900/50">
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transform: `translate(${x}px, ${y}px)`,
                    transformOrigin: '0 0',
                    display: 'inline-block'
                }}
            >
                <ReactCrop
                    crop={displayCrop}
                    onChange={(c) => onCropChange?.(normalizeCropFromDisplay(c))}
                    onComplete={(c) => onCropComplete?.(normalizeCropFromDisplay(c) as PixelCrop)}
                    disabled={!isCropping}
                >
                    <canvas
                        ref={canvasRef}
                        className="bg-[url('/checkered-pattern.svg')] bg-white shadow-xl block"
                        style={{
                            width: width * scale,
                            height: height * scale
                        }}
                    />
                </ReactCrop>
            </div>
        </div>
    );
}
