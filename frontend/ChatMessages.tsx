import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Copy, RefreshCw, Share, ThumbsUp, ThumbsDown, Bot, User, Sparkles, Mic as MicIcon, MapPin, Star } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface MapData {
  type: "address" | "nearby" | "directions" | "multi_location" | "distance";
  data: string | { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[] | string[] | { city: string; address: string; map_url?: string; static_map_url?: string }[] | { origin: string; destination: string; distance: string; duration: string };
  map_url?: string;
  static_map_url?: string;
  coordinates?: { lat: number; lng: number; label: string; color?: string }[];
  llm_response?: string;
  encoded_polyline?: string;
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
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
              scaledSize: new window.google.maps.Size(32, 32),
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
          mapTypeId: window.google.maps.MapTypeId.ROADMAP,
          disableDefaultUI: false,
          zoomControl: true,
        });

        coordinates.forEach((coord, index) => {
          new window.google.maps.Marker({
            position: { lat: coord.lat, lng: coord.lng },
            map,
            title: coord.label,
            icon: {
              url: index === 0 ? '/assets/quadrant-marker.svg' : 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
              scaledSize: new window.google.maps.Size(32, 32),
            },
          });
        });

        const polyline = new window.google.maps.Polyline({
          path: window.google.maps.geometry.encoding.decodePath(lastMessage.map_data.encoded_polyline),
          geodesic: true,
          strokeColor: '#1A73E8',
          strokeOpacity: 0.9,
          strokeWeight: 5,
          icons: [{
            icon: {
              path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2,
              strokeColor: '#1A73E8',
              strokeOpacity: 0.9,
            },
            offset: '100%',
            repeat: '80px',
          }],
        });
        polyline.setMap(map);

        class RouteInfoOverlay extends window.google.maps.OverlayView {
          position: google.maps.LatLng;
          content: string;
          div: HTMLDivElement | null;

          constructor(position: google.maps.LatLng, content: string) {
            super();
            this.position = position;
            this.content = content;
            this.div = null;
          }

          onAdd() {
            this.div = document.createElement('div');
            this.div.style.position = 'absolute';
            this.div.style.backgroundColor = '#fff';
            this.div.style.border = '1px solid #dadce0';
            this.div.style.borderRadius = '4px';
            this.div.style.padding = '4px 6px';
            this.div.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
            this.div.style.fontFamily = 'Roboto, Arial, sans-serif';
            this.div.style.fontSize = '10px';
            this.div.style.color = '#202124';
            this.div.innerHTML = this.content;

            const panes = this.getPanes();
            panes.floatPane.appendChild(this.div);
          }

          draw() {
            const projection = this.getProjection();
            const pixel = projection.fromLatLngToDivPixel(this.position);
            this.div!.style.left = `${pixel.x + 6}px`;
            this.div!.style.top = `${pixel.y + 6}px`;
          }

          onRemove() {
            if (this.div) {
              this.div.parentNode!.removeChild(this.div);
              this.div = null;
            }
          }
        }

        const topLeftPosition = bounds.getNorthEast();
        const routeInfoContent = `
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="font-weight: 500;">${(lastMessage.map_data.data as { distance: string }).distance}</div>
            <div style="color: #5f6368; font-size: 8px;">•</div>
            <div style="font-weight: 500;">${(lastMessage.map_data.data as { duration: string }).duration}</div>
          </div>
        `;
        const routeInfoOverlay = new RouteInfoOverlay(topLeftPosition, routeInfoContent);
        routeInfoOverlay.setMap(map);

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

  const handleImageClick = (src: string, alt: string) => {
    setSelectedImage({ src, alt });
    setIsDialogOpen(true);
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
          stars.push(<Star key={i} className="h-3 w-3 text-yellow-500" fill="currentColor" />);
        } else if (i === fullStars && hasHalfStar) {
          stars.push(
            <Star key={i} className="h-3 w-3 text-yellow-500" style={{ clipPath: 'inset(0 50% 0 0)' }} fill="currentColor" />
          );
        } else {
          stars.push(<Star key={i} className="h-3 w-3 text-gray-300" />);
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
          <div className="mt-2 p-2 bg-muted rounded-sm shadow-sm border border-border">
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-base text-foreground">Address</span>
            </div>
            <div className="flex flex-row items-start gap-2">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Location Map"
                    className="rounded-sm w-[120px] h-auto object-cover"
                    onError={() => console.error("Failed to load map image:", mapData.static_map_url)}
                  />
                </a>
              )}
              <div className="flex-grow">
                <p className="text-base font-medium mb-0.5 text-foreground">
                  {mapData.city || getCityFromAddress(mapData.data as string)}
                </p>
                <p className="text-sm text-muted-foreground">{mapData.data as string}</p>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150">
                    View on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "nearby":
        return (
          <div className="mt-2 p-2 bg-muted rounded-sm shadow-sm border border-border">
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-base text-foreground">Nearby Places</span>
            </div>
            <div className="mb-1">
              <div
                ref={mapRef}
                className="w-full h-[200px] rounded-sm"
                style={{ display: mapData.coordinates ? 'block' : 'none' }}
              ></div>
              {mapData.map_url && (
                <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150 mt-0.5 block">
                  View on Google Maps
                </a>
              )}
            </div>
            <ul className="space-y-1">
              {(mapData.data as { name: string; address: string; map_url?: string; static_map_url?: string; rating?: number | string; total_reviews?: number; type?: string; price_level?: string }[]).map(
                (place, index) => (
                  <li key={index} className="flex flex-row items-start gap-2">
                    {place.static_map_url && (
                      <a href={place.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img
                          src={place.static_map_url}
                          alt={`${place.name} Map`}
                          className="rounded-sm w-[120px] h-auto object-cover"
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-base mb-0.5 text-foreground">{place.name}</span>
                      <p className="text-sm text-muted-foreground mb-0.5">{place.address}</p>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        {renderStars(place.rating)}
                        {place.rating && place.rating !== 'N/A' && (
                          <span>{typeof place.rating === 'number' ? place.rating.toFixed(1) : place.rating} ({place.total_reviews || 0} reviews)</span>
                        )}
                        {place.type && place.type !== 'N/A' && (
                          <span className="before:content-['•'] before:mx-1 capitalize">{place.type}</span>
                        )}
                        {formatPriceLevel(place.price_level) && (
                          <span className="before:content-['•'] before:mx-1">{formatPriceLevel(place.price_level)}</span>
                        )}
                      </div>
                      {place.map_url && (
                        <a href={place.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150">
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
          <div className="mt-2 p-2 bg-muted rounded-sm shadow-sm border border-border">
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-base text-foreground">Directions</span>
            </div>
            <div className="flex flex-row items-start gap-2">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Directions Map"
                    className="rounded-sm w-[120px] h-auto object-cover"
                    onError={() => console.error("Failed to load map image:", mapData.static_map_url)}
                  />
                </a>
              )}
              <div className="flex-grow">
                <ol className="list-decimal pl-4 text-sm space-y-1 text-muted-foreground">
                  {(mapData.data as string[]).map((step, index) => (
                    <li key={index} dangerouslySetInnerHTML={{ __html: step }} className="text-sm" />
                  ))}
                </ol>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150">
                    View Directions on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "distance":
        return (
          <div className="mt-2 p-2 bg-muted rounded-sm shadow-sm border border-border">
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-base text-foreground">Distance Information</span>
            </div>
            <div className="flex-grow">
              {mapData.llm_response && (
                <p className="text-sm text-foreground mb-1">{mapData.llm_response}</p>
              )}
              <div className="text-sm text-muted-foreground space-y-0.5">
                <p><span className="font-medium text-foreground">From:</span> {(mapData.data as { origin: string }).origin}</p>
                <p><span className="font-medium text-foreground">To:</span> {(mapData.data as { destination: string }).destination}</p>
                <p><span className="font-medium text-foreground">Distance:</span> {(mapData.data as { distance: string }).distance}</p>
                <p><span className="font-medium text-foreground">Estimated Travel Time:</span> {(mapData.data as { duration: string }).duration}</p>
              </div>
              <div className="mb-1 mt-1">
                <div
                  ref={mapRef}
                  className="w-full h-[200px] rounded-sm"
                  style={{ display: mapData.coordinates && mapData.encoded_polyline ? 'block' : 'none' }}
                ></div>
                {mapData.map_url && (
                  <a href={mapData.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150 mt-0.5 block">
                    View Route on Google Maps
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      case "multi_location":
        return (
          <div className="mt-2 p-2 bg-muted rounded-sm shadow-sm border border-border">
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold text-base text-foreground">Office Locations</span>
            </div>
            <ul className="space-y-1">
              {(mapData.data as { city: string; address: string; map_url?: string; static_map_url?: string }[]).map(
                (loc, index) => (
                  <li key={index} className="flex flex-row items-start gap-2">
                    {loc.static_map_url && (
                      <a href={loc.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img
                          src={loc.static_map_url}
                          alt={`${loc.city} Map`}
                          className="rounded-sm w-[120px] h-auto object-cover"
                          onError={() => console.error("Failed to load map image:", loc.static_map_url)}
                        />
                      </a>
                    )}
                    <div className="flex-grow">
                      <span className="font-medium block text-base mb-0.5 text-foreground">{loc.city}</span>
                      <p className="text-sm text-muted-foreground">{loc.address}</p>
                      {loc.map_url && (
                        <a href={loc.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors duration-150">
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

  const preprocessJobDescription = (content: string): string => {
    if (content === "No documents available to answer your query. Please upload relevant documents or ask a location-based question.") {
      return "I don't have the documents needed to answer your question right now. Could you upload any relevant files or try asking a location-based question? I'm here to help!";
    }

    if (content.includes("**") && content.includes("1.")) {
      const intro = "Here's a clear overview of the available job roles:\n\n";
      let formattedContent = content.replace(/\*\*(.*?)\*\*/g, '**$1**');
      formattedContent = formattedContent.replace(/(\d+\.\s+)/g, '\n$1');
      const lines = formattedContent.split('\n').map(line => {
        if (line.match(/^\d+\.\s+/)) {
          return line.replace(/(\d+\.\s+)(.*?):/, '$1**$2**:');
        }
        return line;
      });
      return intro + lines.join('\n');
    }

    return content;
  };

  const markdownComponents = {
    h1: ({ node, ...props }: any) => <h1 className="text-xl font-bold mt-2 mb-1 text-foreground" {...props} />,
    h2: ({ node, ...props }: any) => <h2 className="text-lg font-semibold mt-1.5 mb-1 text-foreground" {...props} />,
    h3: ({ node, ...props }: any) => <h3 className="text-base font-medium mt-1 mb-0.5 text-foreground" {...props} />,
    p: ({ node, ...props }: any) => <p className="text-sm mb-1 text-foreground" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 mb-1 text-sm text-foreground" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 mb-1 text-sm text-foreground" {...props} />,
    li: ({ node, ...props }: any) => <li className="mb-0.5 text-foreground flex items-start gap-0.5" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-semibold text-foreground" {...props} />,
    em: ({ node, ...props }: any) => <em className="italic text-foreground" {...props} />,
    a: ({ node, ...props }: any) => <a className="text-primary underline hover:text-primary/80 transition-colors duration-150" target="_blank" rel="noopener noreferrer" {...props} />,
    code: ({ node, ...props }: any) => <code className="bg-muted px-0.5 py-0.2 rounded text-sm text-foreground" {...props} />,
    pre: ({ node, ...props }: any) => <pre className="bg-muted p-1 rounded-sm overflow-x-auto text-sm text-foreground" {...props} />,
    img: ({ node, ...props }: any) => (
      <Dialog open={isDialogOpen && selectedImage?.src === props.src} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) setSelectedImage(null);
      }}>
        <DialogTrigger asChild>
          <img
            {...props}
            className="inline-block w-4 h-4 object-cover rounded-sm ml-0.5 cursor-pointer hover:opacity-80 transition-opacity duration-150"
            onClick={() => handleImageClick(props.src || '', props.alt || '')}
            onError={() => {
              console.error(`Failed to load inline image: ${props.src}`);
              toast.error(`Failed to load image: ${props.alt || 'Image'}`, { duration: 5000 });
            }}
          />
        </DialogTrigger>
        <DialogContent className="sm:max-w-xs bg-card border border-border rounded-sm shadow-sm transition-all duration-150">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">{selectedImage?.alt || 'Image'}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center p-1">
            {selectedImage?.src ? (
              <img
                src={selectedImage.src}
                alt={selectedImage.alt || 'Image'}
                className="w-32 h-32 object-contain rounded-sm"
                onError={() => {
                  console.error(`Failed to load dialog image: ${selectedImage.src}`);
                  toast.error(`Failed to load image: ${selectedImage.alt || 'Image'}`, { duration: 5000 });
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No image available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    ),
  };

  return (
    <ScrollArea className="h-full px-2 py-3">
      <div className="max-w-4xl mx-auto space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-2 animate-pulse">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <h3 className="text-base font-semibold mb-1 text-foreground">Welcome to ASK HR</h3>
            <p className="text-sm text-muted-foreground">{role === "candidate" ? "Ask about job opportunities, interview details, or even office locations!" : "Start a conversation or upload a document to get started."}</p>
            {role === "candidate" && (
              <div className="mt-2 space-y-1 w-full max-w-md">
                <h4 className="text-base font-medium text-foreground">Try These Questions:</h4>
                {suggestedQuestions.map((q, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className="block w-full text-left hover:bg-accent transition-colors duration-150 text-base py-0.5 px-1"
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
                <div className={`flex ${message.role === role ? "justify-end" : "justify-start"} gap-1 mb-3`}>
                  <div className="flex flex-col items-end max-w-[70%]">
                    <div className={`chat-bubble-${message.role} rounded-lg ${message.role === role ? "rounded-tr-sm" : "rounded-tl-sm"} px-2 py-1 mb-1 border hover:bg-accent text-foreground shadow-sm transition-all duration-150 hover:shadow-md border-border`}>
                      <span className="text-sm font-semibold text-foreground/80">{message.role.toUpperCase()}</span>
                      <p className="text-sm leading-normal whitespace-pre-wrap text-foreground">{message.content}</p>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <Avatar className="h-6 w-6 ring-1 ring-primary/20">
                    <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground">
                      <User className="h-3 w-3" />
                    </AvatarFallback>
                  </Avatar>
                </div>
              ) : message.role === "assistant" ? (
                <div className="flex gap-1 mb-3">
                  <Avatar className="h-6 w-6 ring-1 ring-primary/20">
                    <AvatarFallback className="bg-card border">
                      <Bot className="h-3 w-3 text-primary" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <div className="chat-bubble-ai rounded-lg rounded-tl-sm px-2 py-1 bg-card shadow-sm border border-border transition-all duration-150 hover:shadow-md">
                      <div className="prose prose-sm max-w-none">
                        <div className="text-sm leading-normal whitespace-pre-wrap text-foreground">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                            components={markdownComponents}
                          >
                            {DOMPurify.sanitize(preprocessJobDescription(message.content))}
                          </ReactMarkdown>
                        </div>
                        {message.audio_base64 && (
                          <audio controls src={`data:audio/mp3;base64,${message.audio_base64}`} className="mt-1 w-full rounded-sm" />
                        )}
                        {message.map_data && renderMapData(message.map_data)}
                        {message.media_data && message.media_data.type === "video" && (
                          <video controls src={message.media_data.url} className="mt-1 w-full max-w-xs rounded-sm" />
                        )}
                        {message.media_data && message.media_data.type === "image" && (
                          <Dialog open={isDialogOpen && selectedImage?.src === message.media_data?.url} onOpenChange={(open) => {
                            setIsDialogOpen(open);
                            if (!open) setSelectedImage(null);
                          }}>
                            <DialogTrigger asChild>
                              <img
                                src={message.media_data.url}
                                alt="Media Image"
                                className="mt-1 w-16 h-16 object-cover rounded-sm cursor-pointer hover:opacity-80 transition-opacity duration-150"
                                onClick={() => handleImageClick(message.media_data!.url, "Media Image")}
                                onError={() => {
                                  console.error(`Failed to load media image: ${message.media_data!.url}`);
                                  toast.error("Failed to load image", { duration: 5000 });
                                }}
                              />
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-xs bg-card border border-border rounded-sm shadow-sm transition-all duration-150">
                              <DialogHeader>
                                <DialogTitle className="text-base font-semibold text-foreground">Media Image</DialogTitle>
                              </DialogHeader>
                              <div className="flex justify-center p-1">
                                {message.media_data?.url ? (
                                  <img
                                    src={message.media_data.url}
                                    alt="Media Image"
                                    className="w-32 h-32 object-contain rounded-sm"
                                    onError={() => {
                                      console.error(`Failed to load dialog image: ${message.media_data!.url}`);
                                      toast.error("Failed to load image", { duration: 5000 });
                                    }}
                                  />
                                ) : (
                                  <p className="text-sm text-muted-foreground">No image available</p>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {formatTime(message.timestamp)}
                        {thinkDeepMode && <span className="ml-1 text-sm text-primary">Deep Think</span>}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent transition-colors duration-150"
                          onClick={() => handleCopy(message.content)}
                          title="Copy response"
                        >
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent transition-colors duration-150"
                          onClick={() => handleRegenerate(message.id)}
                          title="Regenerate response"
                        >
                          <RefreshCw className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent transition-colors duration-150"
                          onClick={() => handleShare(message.content)}
                          title="Share response"
                        >
                          <Share className="h-2.5 w-2.5" />
                        </Button>
                        <div className="w-px h-3 bg-border mx-0.5" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent transition-colors duration-150"
                          onClick={() => handleFeedback(message.id, true)}
                          title="Like response"
                        >
                          <ThumbsUp className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent transition-colors duration-150"
                          onClick={() => handleFeedback(message.id, false)}
                          title="Dislike response"
                        >
                          <ThumbsDown className="h-2.5 w-2.5" />
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
          <div className="flex justify-end gap-1 mb-3">
            <div className="flex flex-col items-end max-w-[70%]">
              <div className="chat-bubble-candidate rounded-lg rounded-tr-sm px-2 py-1 mb-1 bg-muted/50 animate-pulse">
                <p className="text-sm leading-normal whitespace-pre-wrap">
                  {liveTranscript || "Listening..."}
                </p>
              </div>
              <span className="text-sm text-muted-foreground flex items-center gap-0.5">
                <MicIcon className="h-3 w-3 animate-pulse" /> Recording...
              </span>
            </div>
            <Avatar className="h-6 w-6 ring-1 ring-primary/20">
              <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground">
                <User className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}