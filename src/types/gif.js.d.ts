declare module 'gif.js' {
    import { EventEmitter } from 'events';

    interface GIFOptions {
        workers?: number;
        quality?: number;
        width?: number;
        height?: number;
        workerScript?: string;
        background?: string;
        transparent?: string | number | null;
        dither?: boolean | string;
        debug?: boolean;
    }

    interface AddFrameOptions {
        delay?: number;
        copy?: boolean;
        dispose?: number;
    }

    class GIF extends EventEmitter {
        constructor(options?: GIFOptions);
        addFrame(image: HTMLCanvasElement | CanvasRenderingContext2D | ImageData | HTMLImageElement, options?: AddFrameOptions): void;
        render(): void;
        on(event: 'finished', listener: (blob: Blob, data: Uint8Array) => void): this;
        on(event: 'progress', listener: (percent: number) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
    }

    export = GIF;
}
