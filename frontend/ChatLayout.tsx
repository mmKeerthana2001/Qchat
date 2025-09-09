
import { useState, useEffect } from "react"
import { ChatSidebar } from "@/components/layout/ChatSidebar"
import { ChatHeader } from "@/components/layout/ChatHeader"
import { ChatInput } from "@/components/layout/ChatInput"
import { ChatMessages } from "@/components/layout/ChatMessages"
import { UploadedFilesPanel } from "@/components/layout/UploadedFilesPanel"
import { toast } from "@/components/ui/sonner"
import { useNavigate, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"

interface Chat {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
  candidate_name: string;
  candidate_email: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "hr" | "candidate";
  content: string;
  timestamp: Date;
  audio_base64?: string;
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
      localStorage.setItem("session_id", sessionIdFromUrl) // Update localStorage with new session ID
      navigate("/chat", { replace: true }) // Remove session_id from URL
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
              audio_base64: msg.audio_base64
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

      ws.onopen = () => console.log("WebSocket connected for session:", selectedSession)
      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data)
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
            const newMessage = {
              id: crypto.randomUUID(),
              role: data.role,
              content: data.content,
              timestamp: new Date(data.timestamp * 1000),
              audio_base64: data.audio_base64
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
      }
      ws.onclose = () => console.log("WebSocket closed for session:", selectedSession)
      ws.onerror = () => toast.error("WebSocket error", { duration: 10000 })

      return () => {
        ws.close()
        setWebsocket(null)
      }
    }
  }, [selectedSession, navigate])

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
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>
        <ChatMessages messages={messages} role="hr" />
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