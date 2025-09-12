import { useState, useEffect } from "react"
import { ChatSidebar } from "@/components/layout/ChatSidebar"
import { ChatHeader } from "@/components/layout/ChatHeader"
import { ChatInput } from "@/components/layout/ChatInput"
import { ChatMessages } from "@/components/layout/ChatMessages"
import { UploadedFilesPanel } from "@/components/layout/UploadedFilesPanel"
import { toast } from "@/components/ui/sonner"
import { useNavigate, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Mic } from "lucide-react" // Added import for Mic icon

interface Chat {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
  candidate_name: string;
  candidate_email: string;
}

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location";
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[];
  map_url?: string;
  static_map_url?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "hr" | "candidate";
  content: string;
  timestamp: Date;
  audio_base64?: string;
  map_data?: MapData;
}

interface UploadedFile {
  filename: string;
  path: string;
}

export function ChatLayout() {
  const [sessions, setSessions] = useState<Chat[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)
  const [initialMessageSent, setInitialMessageSent] = useState<{ [sessionId: string]: boolean }>({})
  const [hrEmail, setHrEmail] = useState<string | null>(null)
  const [candidateName, setCandidateName] = useState("")
  const [candidateEmail, setCandidateEmail] = useState("")
  const [isVoiceMode, setIsVoiceMode] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const getSessionHeaders = () => {
    const sessionId = localStorage.getItem("session_id")
    return sessionId ? { "Authorization": `Bearer ${sessionId}` } : {}
  }

  const handleLogout = async () => {
    try {
      await fetch("http://localhost:8000/logout", {
        method: "GET",
        headers: getSessionHeaders()
      })
      localStorage.removeItem("session_id")
      navigate("/")
      toast.success("Logged out successfully", { duration: 5000 })
    } catch (error) {
      console.error("Error during logout:", error)
      toast.error(`Logout failed: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    }
  }

  useEffect(() => {
    // Parse session_id from query parameter on page load
    const params = new URLSearchParams(location.search)
    const sessionIdFromUrl = params.get("session_id")
    if (sessionIdFromUrl) {
      console.log("New session ID from URL:", sessionIdFromUrl)
      localStorage.setItem("session_id", sessionIdFromUrl)
      navigate("/chat", { replace: true })
    } else if (!localStorage.getItem("session_id")) {
      toast.error("No session found. Please log in.", { duration: 10000 })
      navigate("/")
      return
    }

    // Fetch sessions
    const fetchSessions = async () => {
      try {
        const response = await fetch("http://localhost:8000/sessions/", {
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders()
          }
        })
        if (response.status === 401) {
          toast.error("Session expired. Please log in again.", { duration: 10000 })
          localStorage.removeItem("session_id")
          navigate("/")
          return
        }
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || "Failed to fetch sessions")
        }
        const data = await response.json()
        const chats: Chat[] = data.sessions.map((session: any) => ({
          id: session.session_id,
          title: session.candidate_name || "Unknown",
          timestamp: new Date(session.created_at * 1000).toLocaleString(),
          preview: session.chat_history?.[0]?.query || "New chat started...",
          candidate_name: session.candidate_name || "Unknown",
          candidate_email: session.candidate_email || "Unknown"
        }))
        setSessions(chats)
      } catch (error) {
        console.error("Error fetching sessions:", error)
        toast.error(`Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
      }
    }

    // Fetch HR email
    const fetchHrEmail = async () => {
      try {
        const response = await fetch("http://localhost:8000/user-info", {
          headers: getSessionHeaders()
        })
        if (response.status === 401) {
          toast.error("Session expired. Please log in again.", { duration: 10000 })
          localStorage.removeItem("session_id")
          navigate("/")
          return
        }
        if (!response.ok) {
          throw new Error("Failed to fetch user info")
        }
        const data = await response.json()
        setHrEmail(data.email)
      } catch (error) {
        console.error("Error fetching HR email:", error)
        toast.error(`Failed to load user info: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
      }
    }

    fetchSessions()
    fetchHrEmail()
  }, [navigate, location.search])

  useEffect(() => {
    if (selectedSession) {
      const chat = sessions.find(s => s.id === selectedSession)
      if (chat) {
        setCandidateName(chat.candidate_name)
        setCandidateEmail(chat.candidate_email)
      }
    }
  }, [selectedSession, sessions])

  useEffect(() => {
    if (selectedSession) {
      // Fetch session data to check initial_message_sent
      fetch(`http://localhost:8000/get-session/${selectedSession}`, {
        headers: getSessionHeaders()
      })
        .then(res => {
          if (res.status === 401) {
            toast.error("Session expired. Please log in again.", { duration: 10000 })
            localStorage.removeItem("session_id")
            navigate("/")
            return null
          }
          if (!res.ok) {
            throw new Error("Failed to fetch session data")
          }
          return res.json()
        })
        .then(data => {
          if (data) {
            setInitialMessageSent(prev => ({ ...prev, [selectedSession]: data.initial_message_sent || false }))
          }
        })
        .catch(error => {
          console.error("Error fetching session data:", error)
          toast.error(`Failed to load session data: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
        })

      // Fetch messages for selected session
      fetch(`http://localhost:8000/messages/${selectedSession}`, {
        headers: getSessionHeaders()
      })
        .then(res => {
          if (res.status === 401) {
            toast.error("Session expired. Please log in again.", { duration: 10000 })
            localStorage.removeItem("session_id")
            navigate("/")
            return null
          }
          if (!res.ok) {
            throw new Error("Failed to fetch messages")
          }
          return res.json()
        })
        .then(data => {
          if (data) {
            const fetchedMessages: Message[] = data.messages.map((msg: any) => ({
              id: crypto.randomUUID(),
              role: msg.role,
              content: msg.query || msg.response,
              timestamp: new Date(msg.timestamp * 1000),
              audio_base64: msg.audio_base64,
              map_data: msg.map_data ? {
                type: msg.map_data.type,
                data: msg.map_data.data,
                map_url: msg.map_data.map_url,
                static_map_url: msg.map_data.static_map_url
              } : undefined
            }))
            setMessages(fetchedMessages)
          }
        })
        .catch(error => {
          console.error("Error fetching messages:", error)
          toast.error(`Failed to load messages: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
        })

      // Fetch uploaded files for selected session
      fetch(`http://localhost:8000/files/${selectedSession}`, {
        headers: getSessionHeaders()
      })
        .then(res => {
          if (res.status === 401) {
            toast.error("Session expired. Please log in again.", { duration: 10000 })
            localStorage.removeItem("session_id")
            navigate("/")
            return null
          }
          if (!res.ok) {
            throw new Error("Failed to fetch files")
          }
          return res.json()
        })
        .then(data => {
          if (data) {
            setUploadedFiles(data.files || [])
          }
        })
        .catch(error => {
          console.error("Error fetching files:", error)
          toast.error(`Failed to load files: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
        })

      // WebSocket connection
      const ws = new WebSocket(`ws://localhost:8000/ws/${selectedSession}`)
      setWebsocket(ws)

      ws.onopen = () => {
        console.log("WebSocket connected for session:", selectedSession)
        ws.send(JSON.stringify({ type: "ping" }))
      }

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "pong") {
            console.log("Received pong, WebSocket alive")
            return
          }
          if (data.type === "file_uploaded") {
            setUploadedFiles(prev => {
              const newFile = { filename: data.filename, path: data.path }
              const isDuplicate = prev.some(file => file.filename === newFile.filename && file.path === newFile.path)
              if (isDuplicate) return prev
              return [...prev, newFile]
            })
            toast.info(`File uploaded: ${data.filename}`, { duration: 5000 })
          } else {
            setMessages(prev => {
              const newMessage: Message = {
                id: crypto.randomUUID(),
                role: data.role,
                content: data.content,
                timestamp: new Date(data.timestamp * 1000),
                audio_base64: data.audio_base64,
                map_data: data.map_data ? {
                  type: data.map_data.type,
                  data: data.map_data.data,
                  map_url: data.map_data.map_url,
                  static_map_url: data.map_data.static_map_url
                } : undefined
              }
              const isDuplicate = prev.some(
                msg =>
                  msg.role === newMessage.role &&
                  msg.content === newMessage.content &&
                  Math.abs(msg.timestamp.getTime() - newMessage.timestamp.getTime()) < 1000
              )
              if (isDuplicate) {
                console.log("Duplicate WebSocket message ignored:", data)
                return prev
              }
              return [...prev, newMessage]
            })
            toast.info(`${data.role.toUpperCase()} sent a new message`, { duration: 5000 })
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error)
          toast.error("Failed to process incoming message", { duration: 5000 })
        }
      }

      ws.onclose = () => {
        console.log("WebSocket closed for session:", selectedSession)
        toast.warning("WebSocket connection closed", { duration: 10000 })
      }

      ws.onerror = (error) => {
        console.error("WebSocket error:", error)
        toast.error("WebSocket connection error", { duration: 10000 })
      }

      // Ping every 30 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }))
          console.log("Sent ping to keep WebSocket alive")
        }
      }, 30000)

      return () => {
        ws.close()
        clearInterval(pingInterval)
        setWebsocket(null)
      }
    }
  }, [selectedSession, navigate])

  useEffect(() => {
    // Auto-play audio for assistant messages in voice mode
    const lastMessage = messages[messages.length - 1]
    if (isVoiceMode && lastMessage?.role === "assistant" && lastMessage.audio_base64) {
      const audio = new Audio(`data:audio/mp3;base64,${lastMessage.audio_base64}`)
      audio.play().catch(() => toast.error("Audio playback failed.", { duration: 10000 }))
    }
  }, [messages, isVoiceMode])

  const addMessage = (sessionId: string, message: Message) => {
    if (sessionId === selectedSession) {
      setMessages(prev => {
        const isDuplicate = prev.some(
          msg =>
            msg.role === message.role &&
            msg.content === message.content &&
            Math.abs(msg.timestamp.getTime() - message.timestamp.getTime()) < 1000
        )
        if (isDuplicate) {
          console.log("Duplicate local message ignored:", message)
          return prev
        }
        return [...prev, message]
      })
    }
  }

  return (
    <div className="flex h-screen w-full">
      <ChatSidebar
        sessions={sessions}
        setSessions={setSessions}
        selectedSession={selectedSession}
        setSelectedSession={setSelectedSession}
        initialMessageSent={initialMessageSent[selectedSession || ''] || false}
      />
      <div className="flex flex-col flex-1">
        <div className="flex justify-between items-center p-4 border-b">
          <ChatHeader />
          <div className="flex items-center gap-2">
            <Button
              variant={isVoiceMode ? "default" : "ghost"}
              onClick={() => setIsVoiceMode(!isVoiceMode)}
              className="flex items-center gap-2"
            >
              <Mic className="h-4 w-4" />
              <span className="hidden sm:inline">Voice</span>
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
        <ChatMessages
          thinkDeepMode={false}
          messages={messages}
          isVoiceMode={isVoiceMode}
          isRecording={false}
          liveTranscript=""
          role="hr"
          onSuggestedQuestionClick={(question) => {
            const message: Message = {
              id: crypto.randomUUID(),
              role: "hr",
              content: question,
              timestamp: new Date()
            }
            addMessage(selectedSession || "", message)
            fetch(`http://localhost:8000/chat/${selectedSession}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...getSessionHeaders()
              },
              body: JSON.stringify({ query: question, role: "hr", voice_mode: isVoiceMode })
            }).catch(error => {
              console.error("Error sending suggested question:", error)
              toast.error(`Failed to send question: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
            })
          }}
        />
        <ChatInput
          sessionId={selectedSession}
          addMessage={addMessage}
          role="hr"
          isInitialMessageSent={initialMessageSent[selectedSession || ''] || false}
          setInitialMessageSent={(sent) => setInitialMessageSent(prev => ({ ...prev, [selectedSession || '']: sent }))}
          hrEmail={hrEmail}
          candidateName={candidateName}
          candidateEmail={candidateEmail}
        />
      </div>
      <UploadedFilesPanel
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        selectedSession={selectedSession}
      />
    </div>
  )
}