import { Button } from "@/components/ui/button"
import { 
  PanelLeft, 
  FileText, 
  Sun, 
  Moon, 
  Mic, 
  Sparkles 
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/ThemeProvider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ChatHeaderProps {
  onToggleSidebar: () => void
  sidebarOpen: boolean
  thinkDeepMode: boolean
  onToggleThinkDeep: () => void
  onToggleFileSidebar: () => void
  fileSidebarOpen: boolean
  isVoiceMode: boolean // Add voice mode prop
  onToggleVoiceMode: () => void
}

export function ChatHeader({
  onToggleSidebar,
  sidebarOpen,
  thinkDeepMode,
  onToggleThinkDeep,
  onToggleFileSidebar,
  fileSidebarOpen,
  isVoiceMode,
  onToggleVoiceMode
}: ChatHeaderProps) {
  const { setTheme, theme } = useTheme()

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-xl p-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-9 w-9"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
          <Button
            variant={thinkDeepMode ? "default" : "ghost"}
            onClick={onToggleThinkDeep}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Think Deep</span>
          </Button>
          <Button
            variant={fileSidebarOpen ? "default" : "ghost"}
            onClick={onToggleFileSidebar}
            className="flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Files</span>
          </Button>
          <Button
            variant={isVoiceMode ? "default" : "ghost"}
            onClick={onToggleVoiceMode}
            className="flex items-center gap-2"
          >
            <Mic className="h-4 w-4" />
            <span className="hidden sm:inline">Voice</span>
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-9 w-9"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="h-9 w-9 cursor-pointer ring-2 ring-primary/20">
                <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                  U
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuItem>Sign Out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}