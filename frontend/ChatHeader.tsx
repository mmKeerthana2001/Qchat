import { Button } from "@/components/ui/button"
import { 
  PanelLeft, 
  Sun, 
  Moon, 
  Sparkles 
} from "lucide-react"
import { useTheme } from "@/components/ThemeProvider"

interface ChatHeaderProps {
  onToggleSidebar: () => void
  sidebarOpen: boolean
  thinkDeepMode: boolean
  onToggleThinkDeep: () => void
}

export function ChatHeader({
  onToggleSidebar,
  sidebarOpen,
  thinkDeepMode,
  onToggleThinkDeep
}: ChatHeaderProps) {
  const { setTheme, theme } = useTheme()

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-xl p-4">
      <div className="flex items-center justify-between w-full">
        {/* Left side: Sidebar and Think Deep buttons */}
        <div className="flex items-center gap-4">
          
          <Button
            variant={thinkDeepMode ? "default" : "ghost"}
            onClick={onToggleThinkDeep}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Think Deep</span>
          </Button>
        </div>

        
      </div>
    </header>
  )
}