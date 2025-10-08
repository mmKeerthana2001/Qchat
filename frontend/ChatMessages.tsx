import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Copy, RefreshCw, Share, ThumbsUp, ThumbsDown, Bot, User, Sparkles, Mic as MicIcon, MapPin, Star } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useEffect, useRef } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location" | "distance";
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[] | { origin: string; destination: string; distance: string; duration: string };
  map_url?: string;
  static_map_url?: string;
  coordinates?: { lat: number; lng: number; label: string; color?: string }[];
  llm_response?: string;
  encoded_polyline?: string; // Added for distance route map
}

interface MediaData {
  type: "video" | "image";
  url: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "hr" | "candidate";
  content: string;
  timestamp: Date;
  audio_base64?: string;
  map_data?: MapData;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  audio_base64?: string;
  map_data?: MapData;
  media_data?: MediaData;
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
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.map_data && mapRef.current && window.google?.maps) {
      if (lastMessage.map_data.type === "nearby" && lastMessage.map_data.coordinates) {
        const coordinates = lastMessage.map_data.coordinates;
        const centerLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0) / coordinates.length;
        const centerLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0) / coordinates.length;

        const map = new window.google.maps.Map(mapRef.current, {
          zoom: 13,
          center: { lat: centerLat, lng: centerLng },
        });

        coordinates.forEach((coord) => {
          new window.google.maps.Marker({
            position: { lat: coord.lat, lng: coord.lng },
            map,
            title: coord.label,
            icon: {
              url: `http://maps.google.com/mapfiles/ms/icons/${coord.color || 'red'}-dot.png`,
            },
          });
        });
      } else if (lastMessage.map_data.type === "distance" && lastMessage.map_data.coordinates && lastMessage.map_data.encoded_polyline) {
        const coordinates = lastMessage.map_data.coordinates;
        const bounds = new window.google.maps.LatLngBounds();
        coordinates.forEach(coord => bounds.extend({ lat: coord.lat, lng: coord.lng }));

        const map = new window.google.maps.Map(mapRef.current, {
          zoom: 13,
          center: bounds.getCenter(),
          mapTypeId: window.google.maps.MapTypeId.ROADMAP
        });

        coordinates.forEach((coord) => {
          new window.google.maps.Marker({
            position: { lat: coord.lat, lng: coord.lng },
            map,
            title: coord.label,
            icon: {
              url: `http://maps.google.com/mapfiles/ms/icons/${coord.color || 'red'}-dot.png`,
            },
          });
        });

        const polyline = new window.google.maps.Polyline({
          path: window.google.maps.geometry.encoding.decodePath(lastMessage.map_data.encoded_polyline),
          geodesic: true,
          strokeColor: '#FF0000',
          strokeOpacity: 1.0,
          strokeWeight: 2
        });
        polyline.setMap(map);

        map.fitBounds(bounds);
      }
    }
  }, [messages]);

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const suggestedQuestions = [
    "What is the salary range for this position?",
    "What are the next steps in the interview process?",
    "Can you tell me more about the team I'll be working with?",
    "What benefits does the company offer?",
    "What is the expected start date?",
  ];

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      toast.success("Response copied to clipboard!");
    }).catch(() => {
      toast.error("Failed to copy response.");
    });
  };

  const handleRegenerate = (messageId: string) => {
    toast.info("Regeneration feature coming soon!");
  };

  const handleShare = (content: string) => {
    toast.info("Sharing feature coming soon!");
  };

  const handleFeedback = (messageId: string, isPositive: boolean) => {
    toast.info(`Thank you for your ${isPositive ? 'positive' : 'negative'} feedback!`);
  };

  const renderMapData = (mapData: MapData) => {
    const getCityFromAddress = (address: string): string => {
      const parts = address.split(",");
      return parts.length > 2 ? parts[parts.length - 2].trim() : "Location";
    };

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

    const formatPriceLevel = (priceLevel: string | undefined) => {
      if (!priceLevel || priceLevel === 'N/A') return null;
      const priceMap: { [key: string]: string } = {
        Free: 'Free',
        Inexpensive: '$',
        Moderate: '$$',
        Expensive: '$$$',
        'Very Expensive': '$$$$',
        '$': '$',
        '$$': '$$',
        '$$$': '$$$',
        '$$$$': '$$$$',
      };
      return priceMap[priceLevel] || priceLevel;
    };

    switch (mapData.type) {
      case "address":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Address</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Location Map"
                    className="rounded-lg w-[150px] h-auto object-cover"
                    onError={() => console.error("Failed to load map image:", mapData.static_map_url)}
                  />
                </a>
              )}
              <div className="flex-grow">
                <p className="text-sm font-medium mb-1 text-foreground">
                  {mapData.city || getCityFromAddress(mapData.data as string)}
                </p>
                <p className="text-sm text-muted-foreground">{mapData.data as string}</p>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors">
                    View on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "nearby":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Nearby Places</span>
            </div>
            <div className="mb-4">
              <div
                ref={mapRef}
                className="w-full h-[300px] rounded-lg"
                style={{ display: mapData.coordinates ? 'block' : 'none' }}
              ></div>
              {mapData.map_url && (
                <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors mt-2 block">
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
                          className="rounded-lg w-[150px] h-auto object-cover"
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-sm mb-1 text-foreground">{place.name}</span>
                      <p className="text-sm text-muted-foreground mb-1">{place.address}</p>
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
                        <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors">
                          View on Google Maps
                        </a>
                      )}
                    </div>
                  </li>
                )
              )}
            </ul>
          </div>
        );
      case "directions":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Directions</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Directions Map"
                    className="rounded-lg w-[150px] h-auto object-cover"
                    onError={() => console.error("Failed to load map image:", mapData.static_map_url)}
                  />
                </a>
              )}
              <div className="flex-grow">
                <ol className="list-decimal pl-5 text-sm space-y-2 text-muted-foreground">
                  {(mapData.data as string[]).map((step, index) => (
                    <li key={index} dangerouslySetInnerHTML={{ __html: step }} className="text-sm" />
                  ))}
                </ol>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors">
                    View Directions on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "distance":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Distance Information</span>
            </div>
            <div className="flex-grow">
              {mapData.llm_response && (
                <p className="text-sm text-foreground mb-3">{mapData.llm_response}</p>
              )}
              <div className="text-sm text-muted-foreground space-y-1">
                <p><span className="font-medium text-foreground">From:</span> {(mapData.data as { origin: string }).origin}</p>
                <p><span className="font-medium text-foreground">To:</span> {(mapData.data as { destination: string }).destination}</p>
                <p><span className="font-medium text-foreground">Distance:</span> {(mapData.data as { distance: string }).distance}</p>
                <p><span className="font-medium text-foreground">Estimated Travel Time:</span> {(mapData.data as { duration: string }).duration}</p>
              </div>
              <div className="mb-4 mt-4">
                <div
                  ref={mapRef}
                  className="w-full h-[300px] rounded-lg"
                  style={{ display: mapData.coordinates && mapData.encoded_polyline ? 'block' : 'none' }}
                ></div>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors mt-2 block">
                    View Route on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "multi_location":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Office Locations</span>
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
                          className="rounded-lg w-[150px] h-auto object-cover"
                          onError={() => console.error("Failed to load map image:", loc.static_map_url)}
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-sm mb-1 text-foreground">{loc.city}</span>
                      <p className="text-sm text-muted-foreground">{loc.address}</p>
                      {loc.map_url && (
                        <a href={loc.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors">
                          View on Google Maps
                        </a>
                      )}
                    </div>
                  </li>
                )
              )}
            </ul>
          </div>
        );
      default:
        return null;
    }
  };

  // Helper function to preprocess content for job descriptions and remove markdown symbols
  const preprocessJobDescription = (content: string): string => {
    // Handle "no documents" case
    if (content === "No documents available to answer your query. Please upload relevant documents or ask a location-based question.") {
      return "I don't have the documents needed to answer your question right now. Could you upload any relevant files or try asking a location-based question? I'm here to help!";
    }

    // Detect if the content is a job description list
    if (content.includes("**") && content.includes("1.")) {
      // Add a friendly introduction
      const intro = "Here's a clear overview of the available job roles:\n\n";
      // Remove ** used for bold and convert to plain text or wrap in * for markdown bold
      let formattedContent = content.replace(/\*\*(.*?)\*\*/g, '**$1**'); // Ensure bold syntax is preserved for ReactMarkdown
      // Add spacing before numbered items
      formattedContent = formattedContent.replace(/(\d+\.\s+)/g, '\n$1');
      // Clean up any stray ** that might not be properly paired
      formattedContent = formattedContent.replace(/\*\*/g, '');
      // Split into lines and ensure proper list formatting
      const lines = formattedContent.split('\n').map(line => {
        if (line.match(/^\d+\.\s+/)) {
          // Ensure job titles are bold and followed by a colon
          return line.replace(/(\d+\.\s+)(.*?):/, '$1**$2**:');
        }
        return line;
      });
      return intro + lines.join('\n');
    }

    // Clean up any stray ** in non-job-description content
    return content.replace(/\*\*/g, '');
  };

  return (
    <ScrollArea className="h-full px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4 animate-pulse">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">Welcome to QChat</h3>
            <p className="text-sm text-muted-foreground">{role === "candidate" ? "Ask about job opportunities, interview details, or even office locations!" : "Start a conversation or upload a document to get started."}</p>
            {role === "candidate" && (
              <div className="mt-6 space-y-2 w-full max-w-md">
                <h4 className="text-sm font-medium text-foreground">Try These Questions:</h4>
                {suggestedQuestions.map((q, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className="block w-full text-left hover:bg-accent transition-colors text-sm"
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
                <div className={`flex ${message.role === role ? "justify-end" : "justify-start"} gap-3 mb-6`}>
                  <div className="flex flex-col items-end max-w-[70%]">
                    <div className={`chat-bubble-${message.role} rounded-2xl ${message.role === role ? "rounded-tr-md" : "rounded-tl-md"} px-4 py-3 mb-2 bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground shadow-sm transition-all duration-300 hover:shadow-md`}>
                      <span className="text-xs font-semibold text-primary-foreground/80">{message.role.toUpperCase()}</span>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                    <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground">
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
                    <div className="chat-bubble-ai rounded-2xl rounded-tl-md px-4 py-3 bg-card shadow-sm border border-border transition-all duration-300 hover:shadow-md">
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          className="text-sm leading-relaxed whitespace-pre-wrap text-foreground"
                          components={{
                            h1: ({ node, ...props }) => <h1 className="text-lg font-bold mt-4 mb-2 text-foreground" {...props} />,
                            h2: ({ node, ...props }) => <h2 className="text-base font-semibold mt-3 mb-2 text-foreground" {...props} />,
                            h3: ({ node, ...props }) => <h3 className="text-sm font-medium mt-2 mb-1 text-foreground" {...props} />,
                            p: ({ node, ...props }) => <p className="text-sm mb-3 text-foreground" {...props} />,
                            ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 text-sm text-foreground" {...props} />,
                            ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 text-sm text-foreground" {...props} />,
                            li: ({ node, ...props }) => <li className="mb-2 text-foreground" {...props} />,
                            strong: ({ node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
                            em: ({ node, ...props }) => <em className="italic text-foreground" {...props} />,
                            a: ({ node, ...props }) => <a className="text-primary underline hover:text-primary/80 transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
                            code: ({ node, ...props }) => <code className="bg-muted px-1 py-0.5 rounded text-sm text-foreground" {...props} />,
                            pre: ({ node, ...props }) => <pre className="bg-muted p-3 rounded-lg overflow-x-auto text-sm text-foreground" {...props} />,
                          }}
                        >
                          {preprocessJobDescription(message.content)}
                        </ReactMarkdown>
                        {message.audio_base64 && (
                          <audio controls src={`data:audio/mp3;base64,${message.audio_base64}`} className="mt-3 w-full rounded-md" />
                        )}
                        {message.map_data && renderMapData(message.map_data)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.timestamp)}
                        {thinkDeepMode && <span className="ml-2 text-xs text-primary">Deep Think</span>}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-accent transition-colors"
                          onClick={() => handleCopy(message.content)}
                          title="Copy response"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-accent transition-colors"
                          onClick={() => handleRegenerate(message.id)}
                          title="Regenerate response"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-accent transition-colors"
                          onClick={() => handleShare(message.content)}
                          title="Share response"
                        >
                          <Share className="h-3 w-3" />
                        </Button>
                        <div className="w-px h-4 bg-border mx-1" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-accent transition-colors"
                          onClick={() => handleFeedback(message.id, true)}
                          title="Like response"
                        >
                          <ThumbsUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-accent transition-colors"
                          onClick={() => handleFeedback(message.id, false)}
                          title="Dislike response"
                        >
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
              <div className="chat-bubble-candidate rounded-2xl rounded-tr-md px-4 py-3 mb-2 bg-muted/50 animate-pulse">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {liveTranscript || "Listening..."}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MicIcon className="h-3 w-3 animate-pulse" /> Recording...
              </span>
            </div>
            <Avatar className="h-8 w-8 ring-2 ring-primary/20">
              <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground">
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}