
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { 
  Copy, 
  RefreshCw, 
  Edit3, 
  Share, 
  ThumbsUp, 
  ThumbsDown,
  Bot,
  User,
  Sparkles,
  Mic as MicIcon,
  MapPin
} from "lucide-react"
import { toast } from "@/components/ui/sonner"
import { useEffect } from "react"

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location"
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[]
  map_url?: string
  static_map_url?: string
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "hr" | "candidate";
  content: string;
  timestamp: Date;
  audio_base64?: string;
  map_data?: MapData;
}

interface ChatMessagesProps {
  thinkDeepMode: boolean;
  messages: Message[];
  isVoiceMode: boolean;
  isRecording: boolean;
  liveTranscript: string;
  role: "hr" | "candidate";
  onSuggestedQuestionClick?: (question: string) => void;
}

export function ChatMessages({ thinkDeepMode, messages, isVoiceMode, isRecording, liveTranscript, role, onSuggestedQuestionClick }: ChatMessagesProps) {
  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date)
  }

  const suggestedQuestions = [
    "What is the salary range for this position?",
    "What are the next steps in the interview process?",
    "Can you tell me more about the team I'll be working with?",
    "What benefits does the company offer?",
    "What is the expected start date?"
  ]

  const renderMapData = (mapData: MapData) => {
  // Helper function to extract city from address if mapData.city is undefined
  const getCityFromAddress = (address: string): string => {
    const parts = address.split(",");
    return parts.length > 2 ? parts[parts.length - 2].trim() : "Location";
  };

  switch (mapData.type) {
    case "address":
      return (
        <div className="mt-2 p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Address</span>
          </div>
          <p className="text-sm font-medium mb-1">
            {mapData.city || getCityFromAddress(mapData.data as string)}
          </p>
          <p className="text-sm mb-1">{mapData.data as string}</p>
          {mapData.static_map_url && mapData.map_url && (
            <a href={mapData.map_url} target="_blank" rel="noopener noreferrer">
              <img
                src={mapData.static_map_url}
                alt="Location Map"
                className="mt-2 rounded-lg w-full max-w-[150px]"
              />
            </a>
          )}
        </div>
      )
    case "nearby":
      return (
        <div className="mt-2 p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Nearby Places</span>
          </div>
          <ul className="list-disc pl-5 text-sm">
            {(mapData.data as { name: string; address: string; map_url?: string; static_map_url?: string }[]).map(
              (place, index) => (
                <li key={index} className="mb-3">
                  <span className="font-medium block mb-1">{place.name}</span>
                  <p className="text-sm mb-1">{place.address}</p>
                  {place.static_map_url && place.map_url && (
                    <a href={place.map_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={place.static_map_url}
                        alt={`${place.name} Map`}
                        className="mt-1 rounded-lg w-full max-w-[150px]"
                      />
                    </a>
                  )}
                </li>
              )
            )}
          </ul>
        </div>
      )
    case "directions":
      return (
        <div className="mt-2 p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Directions</span>
          </div>
          <ol className="list-decimal pl-5 text-sm">
            {(mapData.data as string[]).map((step, index) => (
              <li key={index} dangerouslySetInnerHTML={{ __html: step }} />
            ))}
          </ol>
          {mapData.static_map_url && mapData.map_url && (
            <a href={mapData.map_url} target="_blank" rel="noopener noreferrer">
              <img
                src={mapData.static_map_url}
                alt="Directions Map"
                className="mt-2 rounded-lg w-full max-w-[150px]"
              />
            </a>
          )}
        </div>
      )
    case "multi_location":
      return (
        <div className="mt-2 p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Office Locations</span>
          </div>
          <ul className="list-disc pl-5 text-sm">
            {(mapData.data as { city: string; address: string; map_url?: string; static_map_url?: string }[]).map(
              (loc, index) => (
                <li key={index} className="mb-3">
                  <span className="font-medium block mb-1">{loc.city}</span>
                  <p className="text-sm mb-1">{loc.address}</p>
                  {loc.static_map_url && loc.map_url && (
                    <a href={loc.map_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={loc.static_map_url}
                        alt={`${loc.city} Map`}
                        className="mt-1 rounded-lg w-full max-w-[150px]"
                      />
                    </a>
                  )}
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

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (isVoiceMode && lastMessage?.role === "assistant" && lastMessage.audio_base64) {
      const audio = new Audio(`data:audio/mp3;base64,${lastMessage.audio_base64}`)
      audio.play().catch(() => toast.error("Audio playback failed.", { duration: 10000 }))
    }
  }, [messages, isVoiceMode])

  return (
    <ScrollArea className="h-full px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Welcome to QChat</h3>
            <p className="text-muted-foreground">{role === "candidate" ? "Ask about your application" : "Start a conversation or upload a document to begin"}</p>
            {role === "candidate" && (
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium">Suggested Questions:</h4>
                {suggestedQuestions.map((q, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className="block w-full text-left"
                    onClick={() => onSuggestedQuestionClick?.(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="animate-fade-in">
              {(message.role === "hr" || message.role === "candidate") ? (
                <div className={`flex ${message.role === "hr" ? "justify-end" : "justify-start"} gap-3 mb-6`}>
                  <div className="flex flex-col items-end max-w-[70%]">
                    <div className={`chat-bubble-${message.role} rounded-2xl ${message.role === "hr" ? "rounded-tr-md" : "rounded-tl-md"} px-4 py-3 mb-2`}>
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
                      {message.role === "hr" ? <User className="h-4 w-4" /> : <User className="h-4 w-4" />}
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
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Share className="h-3 w-3" />
                        </Button>
                        <div className="w-px h-4 bg-border mx-1" />
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <ThumbsUp className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <ThumbsDown className="h-3 w-3" />
                        </Button>
                      </div>
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
              <div className="chat-bubble-user rounded-2xl rounded-tr-md px-4 py-3 mb-2 bg-muted/50 animate-pulse">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {liveTranscript || "Listening..."}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MicIcon className="h-3 w-3 animate-pulse" /> Recording...
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
  )
}
