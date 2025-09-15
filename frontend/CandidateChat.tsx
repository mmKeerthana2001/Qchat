import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { toast } from "@/components/ui/sonner"
import { Mic, StopCircle, Send, Loader2, User, Bot, Sparkles, MapPin, Star } from "lucide-react"

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location"
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[]
  map_url?: string
  static_map_url?: string
  coordinates?: { lat: number; lng: number; label: string; color?: string }[]
}

interface Message {
  id: string
  role: "user" | "assistant" | "system" | "hr" | "candidate"
  content: string
  timestamp: Date
  audio_base64?: string
  map_data?: MapData
}

function CandidateChat() {
  const [searchParams] = useSearchParams()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState("")
  const [isVoiceMode, setIsVoiceMode] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
  const [processor, setProcessor] = useState<ScriptProcessorNode | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)

  const suggestedQuestions = [
    "What is the salary range for this position?",
    "What are the next steps in the interview process?",
    "Can you tell me more about the team I'll be working with?",
    "What benefits does the company offer?",
    "What is the expected start date?",
    "What is the address of Quadrant Technologies?",
    "Restaurants near Quadrant Technologies",
    "Directions to Quadrant Technologies from New York",
    "Where are all the Quadrant Technologies offices located?"
  ]

  // Load Google Maps API script dynamically
  useEffect(() => {
    const loadGoogleMapsScript = () => {
      if (window.google?.maps) return // Script already loaded

      const script = document.createElement("script")
      script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyBfdwifhc_fFYHempQVUOqR7AW8C8ynsI4&libraries=places`
      script.async = true
      script.defer = true
      script.onload = () => console.log("Google Maps API loaded")
      script.onerror = () => toast.error("Failed to load Google Maps API", { duration: 10000 })
      document.head.appendChild(script)
    }
    loadGoogleMapsScript()
  }, [])

  // Initialize map for nearby queries
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.map_data?.type === "nearby" && lastMessage.map_data.coordinates && mapRef.current && window.google?.maps) {
      const coordinates = lastMessage.map_data.coordinates
      const centerLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0) / coordinates.length
      const centerLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0) / coordinates.length

      const map = new window.google.maps.Map(mapRef.current, {
        zoom: 13,
        center: { lat: centerLat, lng: centerLng },
      })

      coordinates.forEach((coord, index) => {
        new window.google.maps.Marker({
          position: { lat: coord.lat, lng: coord.lng },
          map,
          title: coord.label,
          icon: {
            url: `http://maps.google.com/mapfiles/ms/icons/${coord.color || 'red'}-dot.png`
          }
        })
      })
    }
  }, [messages])

  useEffect(() => {
    const token = searchParams.get("token")
    if (token) {
      fetch(`http://localhost:8000/validate-token/?token=${token}`)
        .then(response => {
          if (!response.ok) throw new Error("Invalid token")
          return response.json()
        })
        .then(data => setSessionId(data.session_id))
        .catch(error => {
          console.error("Token validation error:", error)
          toast.error("Invalid or expired link", { duration: 10000 })
        })
    }
  }, [searchParams])

  useEffect(() => {
    if (sessionId) {
      fetch(`http://localhost:8000/messages/${sessionId}`)
        .then(res => res.json())
        .then(data => {
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
              static_map_url: msg.map_data.static_map_url,
              coordinates: msg.map_data.coordinates
            } : undefined
          }))
          setMessages(fetchedMessages)
        })
        .catch(error => {
          console.error("Error fetching messages:", error)
          toast.error("Failed to load messages", { duration: 10000 })
        })

      const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`)
      setWebsocket(ws)

      ws.onopen = () => {
        console.log("WebSocket connected for candidate session:", sessionId)
        ws.send(JSON.stringify({ type: "ping" }))
      }

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "pong") {
            console.log("Received pong, WebSocket alive")
            return
          }
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
              static_map_url: data.map_data.static_map_url,
              coordinates: data.map_data.coordinates
            } : undefined
          }
          setMessages(prev => {
            const isDuplicate = prev.some(
              msg =>
                msg.role === newMessage.role &&
                msg.content === newMessage.content &&
                Math.abs(msg.timestamp.getTime() - newMessage.timestamp.getTime()) < 500
            )
            if (isDuplicate) {
              console.log("Duplicate WebSocket message ignored:", data)
              return prev
            }
            return [...prev, newMessage]
          })
          toast.info(`${data.role.toUpperCase()} sent a new message`, { duration: 5000 })
        } catch (error) {
          console.error("Error parsing WebSocket message:", error)
          toast.error("Failed to process incoming message", { duration: 5000 })
        }
      }

      ws.onclose = () => {
        console.log("WebSocket closed for session:", sessionId)
        toast.warning("WebSocket connection closed", { duration: 10000 })
      }

      ws.onerror = (error) => {
        console.error("WebSocket error:", error)
        toast.error("WebSocket connection error", { duration: 10000 })
      }

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
  }, [sessionId])

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector(".scrollarea-viewport")
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [messages, isRecording])

  useEffect(() => {
    return () => {
      if (websocket) websocket.close()
      if (processor) processor.disconnect()
      if (audioContext) audioContext.close()
      if (stream) stream.getTracks().forEach(track => track.stop())
    }
  }, [websocket, processor, audioContext, stream])

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (isVoiceMode && lastMessage?.role === "assistant" && lastMessage.audio_base64) {
      const audio = new Audio(`data:audio/mp3;base64,${lastMessage.audio_base64}`)
      audio.play().catch(() => toast.error("Audio playback failed.", { duration: 10000 }))
    }
  }, [messages, isVoiceMode])

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
        console.log("Transcription WebSocket connected")
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
        console.error("Transcription WebSocket error:", error)
        toast.error("WebSocket connection failed", { duration: 10000 })
        setIsRecording(false)
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "WebSocket error")
        }
      }

      ws.onclose = (event) => {
        console.log(`Transcription WebSocket closed: code=${event.code}, reason=${event.reason || 'No reason provided'}`)
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

  const handleSubmit = async (e: React.FormEvent, overrideMessage?: string) => {
    e.preventDefault()
    if (isLoading || !sessionId) return

    setIsLoading(true)
    const finalMessage = overrideMessage || message.trim()

    try {
      if (finalMessage) {
        const response = await fetch(`http://localhost:8000/chat/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: finalMessage, voice_mode: isVoiceMode, role: "candidate" })
        })

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
      toast.error(`Failed to process request: ${error instanceof Error ? err.message : String(error)}`, { duration: 10000 })
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

  const handleSuggestedQuestionClick = (question: string) => {
    setMessage(question)
    handleSubmit(new Event('submit') as any, question)
  }

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date)
  }

  const renderMapData = (mapData: MapData) => {
    const getCityFromAddress = (address: string): string => {
      const parts = address.split(",")
      return parts.length > 2 ? parts[parts.length - 2].trim() : "Location"
    }

    const renderStars = (rating: number | string | undefined) => {
      if (!rating || rating === 'N/A') return null
      const ratingNum = typeof rating === 'string' ? parseFloat(rating) : rating
      if (isNaN(ratingNum)) return null

      const fullStars = Math.floor(ratingNum)
      const hasHalfStar = ratingNum % 1 >= 0.3
      const stars = []

      for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
          stars.push(<Star key={i} className="h-4 w-4 text-yellow-500" fill="currentColor" />)
        } else if (i === fullStars && hasHalfStar) {
          stars.push(
            <Star key={i} className="h-4 w-4 text-yellow-500" style={{ clipPath: 'inset(0 50% 0 0)' }} fill="currentColor" />
          )
        } else {
          stars.push(<Star key={i} className="h-4 w-4 text-gray-300" />)
        }
      }
      return stars
    }

    const formatPriceLevel = (priceLevel: string | undefined) => {
      if (!priceLevel || priceLevel === 'N/A') return null
      const priceMap: { [key: string]: string } = {
        'Free': 'Free',
        'Inexpensive': '$',
        'Moderate': '$$',
        'Expensive': '$$$',
        'Very Expensive': '$$$$',
        '$': '$',
        '$$': '$$',
        '$$$': '$$$',
        '$$$$': '$$$$'
      }
      return priceMap[priceLevel] || priceLevel
    }

    switch (mapData.type) {
      case "address":
        return (
          <div className="mt-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Address</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Location Map"
                    className="rounded-lg w-[150px] h-auto"
                  />
                </a>
              )}
              <div className="flex-grow">
                <p className="text-sm font-medium mb-1">
                  {mapData.city || getCityFromAddress(mapData.data as string)}
                </p>
                <p className="text-sm">{mapData.data as string}</p>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                    View on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        )
      case "nearby":
        return (
          <div className="mt-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Nearby Places</span>
            </div>
            <div className="mb-4">
              <div
                ref={mapRef}
                className="w-full h-[300px] rounded-lg"
                style={{ display: mapData.coordinates ? 'block' : 'none' }}
              ></div>
              {mapData.map_url && (
                <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline mt-2 block">
                  View on Google Maps
                </a>
              )}
            </div>
            <ul className="space-y-4">
              {(mapData.data as { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[]).map(
                (place, index) => (
                  <li key={index} className="flex flex-row items-start gap-4">
                    {place.static_map_url && (
                      <a href={place.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img
                          src={place.static_map_url}
                          alt={`${place.name} Map`}
                          className="rounded-lg w-[150px] h-auto"
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-sm mb-1">{place.name}</span>
                      <p className="text-sm mb-1">{place.address}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {renderStars(place.rating)}
                        {place.rating && place.rating !== 'N/A' && (
                          <span>{typeof place.rating === 'number' ? place.rating.toFixed(1) : place.rating} ({place.total_reviews || 0} reviews)</span>
                        )}
                        {place.type && place.type !== 'N/A' && (
                          <span className="before:content-['•'] before:mx-2 capitalize">{place.type}</span>
                        )}
                        {formatPriceLevel(place.price_level) && (
                          <span className="before:content-['•'] before:mx-2">{formatPriceLevel(place.price_level)}</span>
                        )}
                      </div>
                      {place.map_url && (
                        <a href={place.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                          View on Google Maps
                        </a>
                      )}
                    </div>
                  </li>
                )
              )}
            </ul>
          </div>
        )
      case "directions":
        return (
          <div className="mt-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Directions</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Directions Map"
                    className="rounded-lg w-[150px] h-auto"
                  />
                </a>
              )}
              <div className="flex-grow">
                <ol className="list-decimal pl-5 text-sm space-y-2">
                  {(mapData.data as string[]).map((step, index) => (
                    <li key={index} dangerouslySetInnerHTML={{ __html: step }} className="text-sm" />
                  ))}
                </ol>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                    View Directions on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        )
      case "multi_location":
        return (
          <div className="mt-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Office Locations</span>
            </div>
            <ul className="space-y-4">
              {(mapData.data as { city: string; address: string; map_url?: string; static_map_url?: string }[]).map(
                (loc, index) => (
                  <li key={index} className="flex flex-row items-start gap-4">
                    {loc.static_map_url && (
                      <a href={loc.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img
                          src={loc.static_map_url}
                          alt={`${loc.city} Map`}
                          className="rounded-lg w-[150px] h-auto"
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-sm mb-1">{loc.city}</span>
                      <p className="text-sm">{loc.address}</p>
                      {loc.map_url && (
                        <a href={loc.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                          View on Google Maps
                        </a>
                      )}
                    </div>
                  </li>
                )
              )}
            </ul>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-xl p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold">Candidate Chat</h1>
          <Button
            variant={isVoiceMode ? "default" : "ghost"}
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className="flex items-center gap-2"
          >
            <Mic className="h-4 w-4" />
            <span className="hidden sm:inline">Voice</span>
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1 p-6" ref={scrollAreaRef}>
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-96 text-center">
              <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Welcome to QChat</h3>
              <p className="text-muted-foreground">Ask about your application or location details</p>
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium">Suggested Questions:</h4>
                {suggestedQuestions.map((q, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className="block w-full text-left"
                    onClick={() => handleSuggestedQuestionClick(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="animate-fade-in">
                {(message.role === "hr" || message.role === "candidate") ? (
                  <div className={`flex ${message.role === "candidate" ? "justify-end" : "justify-start"} gap-3 mb-6`}>
                    <div className="flex flex-col items-end max-w-[70%]">
                      <div className={`chat-bubble-${message.role} rounded-2xl ${message.role === "candidate" ? "rounded-tr-md" : "rounded-tl-md"} px-4 py-3 mb-2`}>
                        <span className="text-xs font-semibold text-muted-foreground">{message.role.toUpperCase()}</span>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                    <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                      <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  </div>
                ) : message.role === "assistant" ? (
                  <div className="flex gap-3 mb-6">
                    <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                      <AvatarFallback className="bg-card border">
                        <Bot className="h-4 w-4 text-primary" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                      <div className="chat-bubble-ai rounded-2xl rounded-tl-md px-4 py-3">
                        <div className="prose prose-sm max-w-none">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap m-0">
                            {message.content}
                          </p>
                          {message.audio_base64 && (
                            <audio controls src={`data:audio/mp3;base64,${message.audio_base64}`} className="mt-2" />
                          )}
                          {message.map_data && renderMapData(message.map_data)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          )}
          {isRecording && (
            <div className="flex justify-end gap-3 mb-6">
              <div className="flex flex-col items-end max-w-[70%]">
                <div className="chat-bubble-candidate rounded-2xl rounded-tr-md px-4 py-3 mb-2 bg-muted/50 animate-pulse">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {liveTranscript || "Listening..."}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mic className="h-3 w-3 animate-pulse" /> Recording...
                </span>
              </div>
              <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/50 backdrop-blur-xl p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={liveTranscript || message}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={isRecording ? "Transcribing..." : "Type your message..."}
                className="min-h-[40px] max-h-[200px] resize-none"
                disabled={isRecording || isLoading}
              />
            </div>
            {isVoiceMode && (
              <Button
                type="button"
                variant={isRecording ? "destructive" : "default"}
                size="icon"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
              >
                {isRecording ? (
                  <StopCircle className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || isRecording || (!message.trim() && !liveTranscript.trim())}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default CandidateChat