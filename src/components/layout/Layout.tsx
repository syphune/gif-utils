import { Github } from "lucide-react";

interface LayoutProps {
    children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary selection:text-primary-foreground">
            <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
                <div className="container mx-auto px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
                        <span className="bg-gradient-to-tr from-primary to-primary/70 bg-clip-text text-transparent decoration-clone">
                            GIF Utils
                        </span>
                    </div>
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Github className="h-5 w-5" />
                    </a>
                </div>
            </header>

            <main className="flex-1 container mx-auto px-4 py-8">
                {children}
            </main>

            <footer className="border-t border-border/40 py-6 md:py-0">
                <div className="container mx-auto px-4 h-14 flex items-center justify-between text-sm text-muted-foreground">
                    <p>Built with privacy in mind. No data leaves your browser.</p>
                </div>
            </footer>
        </div>
    );
}
