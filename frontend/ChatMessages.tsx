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
  MapPin,
  Star
} from "lucide-react"
import { toast } from "@/components/ui/sonner"
import { useEffect } from "react"

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location"
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[]
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

    // Helper function to render star rating
    const renderStars = (rating: number | string | undefined) => {
      if (!rating || rating === 'N/A') return null;
      const ratingNum = typeof rating === 'string' ? parseFloat(rating) : rating;
      if (isNaN(ratingNum)) return null;

      const fullStars = Math.floor(ratingNum);
      const hasHalfStar = ratingNum % 1 >= 0.3;
      const stars = [];

      for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
          stars.push(<Star key={i} className="h-4 w-4 text-yellow-500" fill="currentColor" />);
        } else if (i === fullStars && hasHalfStar) {
          stars.push(
            <Star key={i} className="h-4 w-4 text-yellow-500" style={{ clipPath: 'inset(0 50% 0 0)' }} fill="currentColor" />
          );
        } else {
          stars.push(<Star key={i} className="h-4 w-4 text-gray-300" />);
        }
      }
      return stars;
    };

    // Helper function to format price level
    const formatPriceLevel = (priceLevel: string | undefined) => {
      if (!priceLevel || priceLevel === 'N/A') return null;
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
      };
      return priceMap[priceLevel] || priceLevel;
    };

    switch (mapData.type) {
      case "address":
        return (
          <div className="mt-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Address</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && mapData.map_url && (
                <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
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
            <ul className="space-y-4">
              {(mapData.data as { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[]).map(
                (place, index) => (
                  <li key={index} className="flex flex-row items-start gap-4">
                    {place.static_map_url && place.map_url && (
                      <a href={place.map_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
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
              {mapData.static_map_url && mapData.map_url && (
                <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
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
                    {loc.static_map_url && loc.map_url && (
                      <a href={loc.map_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
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