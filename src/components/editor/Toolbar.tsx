import { Crop } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolbarProps {
    activeTool: string | null;
    onToolSelect: (toolId: string | null) => void;
}

export function Toolbar({ activeTool, onToolSelect }: ToolbarProps) {
    const tools = [
        { id: 'crop', icon: Crop, label: 'Crop' },
        // { id: 'trim', icon: Scissors, label: 'Trim' },
        // { id: 'text', icon: Type, label: 'Text' },
        // { id: 'magic', icon: Wand2, label: 'Magic' },
    ];

    return (
        <div className="flex items-center gap-2">
            {tools.map((tool) => {
                const isActive = activeTool === tool.id;
                return (
                    <button
                        key={tool.id}
                        onClick={() => onToolSelect(isActive ? null : tool.id)}
                        className={cn(
                            "flex flex-col items-center justify-center w-12 h-full transition-colors gap-1 group rounded-md",
                            isActive ? "bg-primary/10 text-primary" : "hover:text-primary"
                        )}
                        title={tool.label}
                    >
                        <tool.icon className="h-5 w-5" />
                        <span className={cn(
                            "text-[10px] font-medium group-hover:text-primary",
                            isActive ? "text-primary" : "text-muted-foreground"
                        )}>
                            {tool.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
