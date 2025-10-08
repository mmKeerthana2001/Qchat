import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Upload, Loader2, Send, Mic, StopCircle, Mail } from "lucide-react"
import { toast } from "@/components/ui/sonner"

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "hr" | "candidate";
  content: string;
  timestamp: Date;
  audio_base64?: string;
}

interface ChatInputProps {
  sessionId: string | null;
  addMessage: (sessionId: string, message: Message) => void;
  role: "hr" | "candidate";
  isInitialMessageSent: boolean;
  setInitialMessageSent: (sent: boolean) => void;
  hrEmail: string | null;
  candidateName: string;
  candidateEmail: string;
}

export function ChatInput({ sessionId, addMessage, role, isInitialMessageSent, setInitialMessageSent, hrEmail, candidateName, candidateEmail }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isVoiceMode, setIsVoiceMode] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
  const [processor, setProcessor] = useState<ScriptProcessorNode | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getSessionHeaders = () => {
    const sessionId = localStorage.getItem("session_id")
    return sessionId ? { "Authorization": `Bearer ${sessionId}` } : {}
  }

  useEffect(() => {
    return () => {
      if (websocket) websocket.close()
      if (processor) processor.disconnect()
      if (audioContext) audioContext.close()
      if (stream) stream.getTracks().forEach(track => track.stop())
    }
  }, [websocket, processor, audioContext, stream])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0 && sessionId) {
      const newFiles = Array.from(files)
      setSelectedFiles(prev => [...prev, ...newFiles])
      
      const formData = new FormData()
      newFiles.forEach(file => formData.append("files", file))
      
      try {
        const response = await fetch(`http://localhost:8000/extract-text/${sessionId}`, {
          method: "POST",
          headers: getSessionHeaders(),
          body: formData
        })
        
        if (response.status === 401) {
          toast.error("Session expired. Please log in again.", { duration: 10000 })
          localStorage.removeItem("session_id")
          window.location.href = "/"
          return
        }
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || "File upload failed")
        }
        
        setSelectedFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ""
        toast.success("Files uploaded successfully", { duration: 10000 })
      } catch (error) {
        console.error("Error uploading files:", error)
        toast.error(`Failed to upload files: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
      }
    }
  }

  const handleInitiateEmail = async () => {
    if (isLoading || !sessionId || role !== "hr" || !hrEmail || !candidateName || !candidateEmail) {
      toast.error("Cannot initiate email: Invalid session, role, or missing details", { duration: 10000 })
      return
    }

    setIsLoading(true)
    const initialMessage = message.trim() || "QChat is here to assist you with your queries along the way."

    try {
      // Send initial message if not already sent
      if (!isInitialMessageSent) {
        const initResponse = await fetch(`http://localhost:8000/send-initial-message/${sessionId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders()
          },
          body: JSON.stringify({ message: initialMessage })
        })

        if (initResponse.status === 401) {
          toast.error("Session expired. Please log in again.", { duration: 10000 })
          localStorage.removeItem("session_id")
          window.location.href = "/"
          return
        }
        if (!initResponse.ok) {
          const errorData = await initResponse.json()
          throw new Error(errorData.detail || "Failed to send initial message")
        }

        addMessage(sessionId, {
          id: crypto.randomUUID(),
          role: "hr",
          content: initialMessage,
          timestamp: new Date()
        })
        setInitialMessageSent(true)
      }

      // Generate share link
      const linkResponse = await fetch(`http://localhost:8000/generate-share-link/${sessionId}`, {
        headers: getSessionHeaders()
      })
      if (!linkResponse.ok) {
        const errorData = await linkResponse.json()
        throw new Error(errorData.detail || "Failed to generate share link")
      }
      const linkData = await linkResponse.json()
      const shareLink = linkData.share_link

      // Construct email template
      const subject = "Invitation to QChat"
      const body = `Hi ${candidateName},\n\n${initialMessage}\n\nAccess the chat here: ${shareLink}\n\nBest regards,\n${hrEmail}`

      const mailtoUrl = `mailto:${candidateEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

      // Open email client
      const link = document.createElement('a')
      link.href = mailtoUrl
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      setMessage("")
      if (textareaRef.current) textareaRef.current.style.height = "auto"
      toast.success("Email client opened with pre-filled template. You can review and send from there.", { duration: 10000 })
    } catch (error) {
      console.error("Error initiating email:", error)
      toast.error(`Failed to initiate email: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent, overrideMessage?: string) => {
    e.preventDefault()
    if (isLoading || !sessionId) {
      toast.error("Cannot send message: No session selected", { duration: 10000 })
      return
    }

    setIsLoading(true)
    const finalMessage = overrideMessage || message.trim()

    try {
      if (finalMessage) {
        const response = await fetch(`http://localhost:8000/chat/${sessionId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders()
          },
          body: JSON.stringify({ query: finalMessage, voice_mode: isVoiceMode, role })
        })

        if (response.status === 401) {
          toast.error("Session expired. Please log in again.", { duration: 10000 })
          localStorage.removeItem("session_id")
          window.location.href = "/"
          return
        }
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || "Failed to send message")
        }

        setMessage("")
        setLiveTranscript("")
        if (textareaRef.current) textareaRef.current.style.height = "auto"
      }
    } catch (error) {
      console.error("Error sending message:", error)
      toast.error(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    const textarea = e.target
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }

  const startRecording = async () => {
    if (!isVoiceMode || !sessionId) {
      toast.error("Voice mode is disabled or no session selected", { duration: 10000 })
      return
    }
    setIsRecording(true)
    setLiveTranscript("")
    try {
      const ws = new WebSocket(`ws://localhost:8000/transcribe/${sessionId}`)
      setWebsocket(ws)

      ws.onmessage = (event) => {
        const transcript = event.data
        console.log("Live transcript:", transcript)
        setLiveTranscript(prev => prev + (prev ? " " : "") + transcript)
      }

      ws.onopen = async () => {
        console.log("Connected to WebSocket")
        try {
          const mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              sampleRate: 16000, 
              sampleSize: 16, 
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            } 
          })
          setStream(mediaStream)
          const ctx = new AudioContext({ sampleRate: 16000 })
          setAudioContext(ctx)
          const source = ctx.createMediaStreamSource(mediaStream)
          const proc = ctx.createScriptProcessor(4096, 1, 1)
          setProcessor(proc)

          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          source.connect(analyser)
          analyser.connect(proc)
          proc.connect(ctx.destination)

          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          let silenceCount = 0
          const silenceThreshold = 5

          const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }))
              console.log("Sent ping to keep WebSocket alive")
            } else {
              clearInterval(pingInterval)
              console.log("Ping interval cleared due to WebSocket closure")
            }
          }, 2000)

          proc.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) {
              console.log("WebSocket closed, stopping audio processing")
              clearInterval(pingInterval)
              proc.disconnect()
              if (ctx) ctx.close()
              if (mediaStream) mediaStream.getTracks().forEach(track => track.stop())
              return
            }

            analyser.getByteFrequencyData(dataArray)
            const maxAmplitude = Math.max(...dataArray)
            if (maxAmplitude < 10) {
              silenceCount++
              console.warn(`Low audio amplitude detected (${maxAmplitude}), silence count: ${silenceCount}`)
              if (silenceCount >= silenceThreshold * (16000 / 4096)) {
                console.error("Persistent silence detected, stopping recording")
                ws.close(1000, "No audio input detected")
                return
              }
            } else {
              silenceCount = 0
              console.debug(`Active audio detected, amplitude: ${maxAmplitude}`)
            }

            const inputData = e.inputBuffer.getChannelData(0)
            if (inputData.every(val => val === 0)) {
              console.warn("Empty audio buffer detected")
              return
            }
            const pcm16 = convertFloat32ToInt16(inputData)
            console.debug(`Sending audio chunk of size ${pcm16.byteLength} bytes`)
            try {
              ws.send(pcm16)
            } catch (error) {
              console.error("Error sending audio data:", error)
              ws.close(1000, "Error sending audio data")
            }
          }
          toast.info("Recording started...", { duration: 5000 })
        } catch (err) {
          console.error("Recording setup error:", err)
          toast.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`, { duration: 10000 })
          setIsRecording(false)
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, "Recording setup failed")
          }
        }
      }

      ws.onerror = (error) => {
        console.error("WebSocket error:", error)
        toast.error("WebSocket connection failed", { duration: 10000 })
        setIsRecording(false)
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "WebSocket error")
        }
      }

      ws.onclose = (event) => {
        console.log(`WebSocket closed: code=${event.code}, reason=${event.reason || 'No reason provided'}`)
        setIsRecording(false)
        if (processor) processor.disconnect()
        if (audioContext) audioContext.close()
        if (stream) stream.getTracks().forEach(track => track.stop())
        setWebsocket(null)
        setProcessor(null)
        setAudioContext(null)
        setStream(null)
        if (event.code !== 1000) {
          toast.error(`WebSocket closed unexpectedly: ${event.reason || 'No reason provided'}`, { duration: 10000 })
        } else if (liveTranscript.trim()) {
          console.log("Final transcript:", liveTranscript)
          handleSubmit(new Event('submit') as any, liveTranscript)
        } else {
          toast.warning("No transcript received", { duration: 10000 })
        }
      }
    } catch (err) {
      console.error("WebSocket setup error:", err)
      toast.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`, { duration: 10000 })
      setIsRecording(false)
    }
  }

  const stopRecording = async () => {
    if (websocket && isRecording && websocket.readyState === WebSocket.OPEN) {
      websocket.close(1000, "Recording stopped by user")
      setIsRecording(false)
      toast.info("Recording stopped, processing transcription...", { duration: 5000 })
    }
  }

  const convertFloat32ToInt16 = (buffer: Float32Array): ArrayBuffer => {
    const l = buffer.length
    const result = new Int16Array(l)
    for (let i = 0; i < l; i++) {
      result[i] = buffer[i] * 0x7fff
    }
    return result.buffer
  }

  return (
    <div className="border-t border-border bg-card/50 backdrop-blur-xl p-4">
      <div className="max-w-4xl mx-auto">
        <form className="space-y-3">
          <div className="relative glass-card rounded-2xl p-3">
            <div className="flex items-end gap-3">
              {role === "hr" && (
                <div className="relative">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading || !sessionId}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    className="hidden"
                    accept=".pdf,.txt,.doc,.docx"
                    onChange={handleFileChange}
                  />
                </div>
              )}
              
              <div className="flex-1">
                <Textarea
                  ref={textareaRef}
                  value={isRecording ? liveTranscript : message}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message... (Shift+Enter for new line)"
                  className="min-h-[44px] max-h-[200px] resize-none border-0 focus:ring-0 bg-transparent placeholder:text-muted-foreground/70"
                  rows={1}
                  disabled={isLoading || isRecording}
                />
              </div>
              {role === "hr" && (
                <Button
                  type="button"
                  onClick={handleInitiateEmail}
                  disabled={isLoading || !sessionId}
                  className="h-9 px-4 bg-green-500 hover:bg-green-600"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Initiate Email
                </Button>
              )}
              <Button
                type="submit"
                onClick={handleSubmit}
                disabled={isLoading || (!message.trim() && selectedFiles.length === 0) || !sessionId}
                className="h-9 w-9 p-0 btn-primary"
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>Press Shift+Enter for new line</span>
              {selectedFiles.length > 0 && (
                <span>{selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} selected</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span>{message.length}/4000</span>
              <span>🎙 Voice mode {isVoiceMode ? "ON" : "OFF"}</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}