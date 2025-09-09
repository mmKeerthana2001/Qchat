import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import { 
  Plus, 
  Search, 
  MessageSquare, 
  MoreHorizontal, 
  Trash2, 
  Archive, 
  Download,
  Edit3,
  Clock,
  Share2,
  Copy,
  ChevronRight,
  ChevronLeft
} from "lucide-react"
import { toast } from "@/components/ui/sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog"
import { useNavigate } from "react-router-dom"

interface Chat {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
  candidate_name: string;
  candidate_email: string;
}

interface ChatSidebarProps {
  sessions: Chat[];
  setSessions: React.Dispatch<React.SetStateAction<Chat[]>>;
  selectedSession: string | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<string | null>>;
  initialMessageSent: boolean;
}

export function ChatSidebar({ sessions, setSessions, selectedSession, setSelectedSession, initialMessageSent }: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [openNewChatDialog, setOpenNewChatDialog] = useState(false)
  const [openShareDialog, setOpenShareDialog] = useState(false)
  const [shareLink, setShareLink] = useState("")
  const [shareSessionId, setShareSessionId] = useState("")
  const [shareCandidateName, setShareCandidateName] = useState("")
  const [candidateName, setCandidateName] = useState("")
  const [candidateEmail, setCandidateEmail] = useState("")
  const [isCollapsed, setIsCollapsed] = useState(false)
  const navigate = useNavigate()

  const getSessionHeaders = () => {
    const sessionId = localStorage.getItem("session_id")
    return sessionId ? { "Authorization": `Bearer ${sessionId}` } : {}
  }

  const createNewChat = async () => {
    if (!candidateName || !candidateEmail) {
      toast.error("Please provide candidate name and email", { duration: 10000 })
      return
    }
    try {
      const response = await fetch("http://localhost:8000/create-session/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders()
        },
        body: JSON.stringify({ candidate_name: candidateName, candidate_email: candidateEmail })
      })
      
      if (response.status === 401) {
        toast.error("Session expired. Please log in again.", { duration: 10000 })
        localStorage.removeItem("session_id")
        navigate("/")
        return
      }
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to create new session")
      }

      const data = await response.json()
      const newChat: Chat = {
        id: data.session_id,
        title: candidateName,
        timestamp: new Date().toLocaleString(),
        preview: "New chat started...",
        candidate_name: candidateName,
        candidate_email: candidateEmail
      }
      
      setSessions([newChat, ...sessions])
      setSelectedSession(newChat.id)
      setOpenNewChatDialog(false)
      setCandidateName("")
      setCandidateEmail("")
      toast.success(`Session created for ${candidateName}`, { duration: 10000 })
      console.log("New chat created, selectedSession set to:", newChat.id)
    } catch (error) {
      console.error("Error creating new session:", error)
      toast.error(`Failed to create session: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    }
  }

  const handleShareLink = async (sessionId: string, candidateName: string) => {
    try {
      const response = await fetch(`http://localhost:8000/generate-share-link/${sessionId}`, {
        headers: getSessionHeaders()
      })
      if (response.status === 401) {
        toast.error("Session expired. Please log in again.", { duration: 10000 })
        localStorage.removeItem("session_id")
        navigate("/")
        return
      }
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to generate share link")
      }
      const data = await response.json()
      setShareLink(data.share_link)
      setShareSessionId(sessionId)
      setShareCandidateName(candidateName)
      setOpenShareDialog(true)
      await navigator.clipboard.writeText(data.share_link)
      toast.success(`Share link for ${candidateName} copied to clipboard!`, {
        duration: 10000,
        description: `Link: ${data.share_link}`,
        action: {
          label: "Copy Again",
          onClick: () => navigator.clipboard.writeText(data.share_link)
        }
      })
      console.log(`Share link generated for session ${sessionId}: ${data.share_link}`)
    } catch (error) {
      console.error("Error generating share link:", error)
      toast.error(`Failed to generate share link: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    }
  }

  const handleCopyLink = async (sessionId: string, candidateName: string) => {
    try {
      const response = await fetch(`http://localhost:8000/generate-share-link/${sessionId}`, {
        headers: getSessionHeaders()
      })
      if (response.status === 401) {
        toast.error("Session expired. Please log in again.", { duration: 10000 })
        localStorage.removeItem("session_id")
        navigate("/")
        return
      }
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to generate share link")
      }
      const data = await response.json()
      await navigator.clipboard.writeText(data.share_link)
      toast.success(`Link for ${candidateName} copied to clipboard!`, {
        duration: 5000,
        action: {
          label: "Copy Again",
          onClick: () => navigator.clipboard.writeText(data.share_link)
        }
      })
      console.log(`Link copied for session ${sessionId}: ${data.share_link}`)
    } catch (error) {
      console.error("Error copying link:", error)
      toast.error(`Failed to copy link: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    }
  }

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      toast.success("Link copied to clipboard!", { duration: 5000 })
    } catch (error) {
      toast.error(`Failed to copy link: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    }
  }

  useEffect(() => {
    console.log("ChatSidebar - sessions:", sessions.map(s => ({ id: s.id, title: s.title })))
    console.log("ChatSidebar - selectedSession:", selectedSession)
    console.log("ChatSidebar - initialMessageSent:", initialMessageSent)
  }, [sessions, selectedSession, initialMessageSent])

  const filteredChats = sessions.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.candidate_email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className={`h-full bg-sidebar-bg border-r border-border flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-80'}`}>
      <div className="p-4 border-b border-border flex items-center justify-between">
        {!isCollapsed && (
          <Button 
            className="w-full btn-primary rounded-xl"
            size="lg"
            onClick={() => setOpenNewChatDialog(true)}
          >
            <Plus className="h-5 w-5 mr-2" />
            New
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="ml-2"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Button>
      </div>

      {!isCollapsed && (
        <>
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 input-modern"
              />
            </div>
          </div>

          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className={`
                    group relative p-3 rounded-lg cursor-pointer sidebar-item
                    ${selectedSession === chat.id ? 'active bg-primary' : 'hover:bg-accent'}
                  `}
                  onClick={() => setSelectedSession(chat.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <h3 className={`font-medium text-sm truncate ${selectedSession === chat.id ? 'text-white font-bold' : ''}`}>
                          {chat.title} ({chat.candidate_email})
                        </h3>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        <span className={selectedSession === chat.id ? 'text-white font-bold' : 'text-muted-foreground'}>
                          {chat.timestamp}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-blue-500 border-blue-500 hover:bg-blue-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleShareLink(chat.id, chat.title)
                        }}
                        title={`Share link for ${chat.title}`}
                        disabled={selectedSession !== chat.id}
                      >
                        <Share2 className="h-4 w-4 mr-1" />
                        Share
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem 
                            className="flex items-center gap-2" 
                            onClick={() => handleShareLink(chat.id, chat.title)}
                            disabled={selectedSession !== chat.id}
                          >
                            <Share2 className="h-4 w-4" />
                            Share Link
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="flex items-center gap-2" 
                            onClick={() => handleCopyLink(chat.id, chat.title)}
                            disabled={selectedSession !== chat.id}
                          >
                            <Copy className="h-4 w-4" />
                            Copy Link
                          </DropdownMenuItem>
                          <DropdownMenuItem className="flex items-center gap-2">
                            <Edit3 className="h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem className="flex items-center gap-2">
                            <Archive className="h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem className="flex items-center gap-2">
                            <Download className="h-4 w-4" />
                            Export
                          </DropdownMenuItem>
                          <DropdownMenuItem className="flex items-center gap-2 text-destructive">
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              ))}
              {filteredChats.length === 0 && (
                <p className="text-xs text-muted-foreground text-center p-4">
                  No conversations found
                </p>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border">
            <div className="text-xs text-muted-foreground text-center">
              {filteredChats.length} conversation{filteredChats.length !== 1 ? 's' : ''}
            </div>
          </div>
        </>
      )}

      <Dialog open={openNewChatDialog} onOpenChange={setOpenNewChatDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Candidate Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Candidate Name"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
            />
            <Input
              placeholder="Candidate Email"
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNewChatDialog(false)}>Cancel</Button>
            <Button onClick={createNewChat}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openShareDialog} onOpenChange={setOpenShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Link for {shareCandidateName}</DialogTitle>
            <DialogDescription>
              Copy this link and share it with the candidate to allow them to access the chat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                value={shareLink}
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyShareLink}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenShareDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}