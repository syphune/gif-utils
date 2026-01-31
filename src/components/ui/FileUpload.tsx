import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    accept?: string;
    maxSizeMB?: number; // Optional max size in MB
}

export function FileUpload({ onFileSelect, accept = "image/gif", maxSizeMB = 50 }: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const validateAndSelect = (file: File) => {
        setError(null);

        // Check type
        if (accept && !file.type.match(accept.replace("*", ".*"))) {
            setError("Invalid file type. Please upload a GIF.");
            return;
        }

        // Check size
        if (file.size > maxSizeMB * 1024 * 1024) {
            setError(`File is too large. Max size is ${maxSizeMB}MB.`);
            return;
        }

        onFileSelect(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            validateAndSelect(e.dataTransfer.files[0]);
        }
    };

    const handleClick = () => {
        inputRef.current?.click();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            validateAndSelect(e.target.files[0]);
        }
    };

    return (
        <div className="w-full max-w-xl mx-auto">
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "relative flex flex-col items-center justify-center w-full h-64 rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer ease-out",
                    isDragging
                        ? "border-primary bg-primary/5 scale-[1.02]"
                        : "border-border bg-card/50 hover:bg-card/80 hover:border-primary/50",
                    error ? "border-destructive/50" : ""
                )}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={handleInputChange}
                />

                <div className="flex flex-col items-center justify-center p-6 text-center space-y-4">
                    <div className={cn(
                        "p-4 rounded-full bg-background ring-1 transition-colors",
                        isDragging ? "ring-primary" : "ring-border"
                    )}>
                        <Upload className={cn("h-8 w-8 transition-colors", isDragging ? "text-primary" : "text-muted-foreground")} />
                    </div>

                    <div className="space-y-1">
                        <p className="text-lg font-medium">
                            Click to upload or drag and drop
                        </p>
                        <p className="text-sm text-muted-foreground">
                            GIF files up to {maxSizeMB}MB
                        </p>
                    </div>

                    {error && (
                        <p className="text-sm font-medium text-destructive animate-in fade-in slide-in-from-top-1">
                            {error}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
