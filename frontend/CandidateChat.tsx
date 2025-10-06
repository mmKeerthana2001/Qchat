import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/components/ui/sonner";
import { Menu, Send, Loader2, User, MapPin, Star, GripVertical, Mic } from "lucide-react";
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

function CandidateChat() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 3;
  const reconnectInterval = 5000; // 5 seconds
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const DEBUG = true;

  const suggestedQuestions = [
    "What is the salary range for this position?",
    "What are the next steps in the interview process?",
    "Can you tell me more about the team I'll be working with?",
    "What benefits does the company offer?",
    "What is the expected start date?",
    "What is the address of Quadrant Technologies?",
    "Are there any PGs or restaurants near Quadrant Technologies?",
    "Where are all the Quadrant Technologies offices located?",
    "Show me the company video",
    "What is the dress code?",
    "Who is the chairman?"
  ];

  // Resizing functionality
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    const minWidth = 200;
    const maxWidth = 500;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const loadGoogleMapsScript = () => {
      if (window.google?.maps) return;
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyBfdwifhc_fFYHempQVUOqR7AW8C8ynsI4&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => console.log("Google Maps API loaded");
      script.onerror = () => toast.error("Failed to load Google Maps API", { duration: 10000 });
      document.head.appendChild(script);
    };
    loadGoogleMapsScript();
  }, []);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.map_data?.type === "nearby" && lastMessage.map_data.coordinates && mapRef.current && window.google?.maps) {
      const coordinates = lastMessage.map_data.coordinates;
      const centerLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0) / coordinates.length;
      const centerLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0) / coordinates.length;

      const map = new window.google.maps.Map(mapRef.current, {
        zoom: 13,
        center: { lat: centerLat, lng: centerLng },
      });

      coordinates.forEach((coord, index) => {
        new window.google.maps.Marker({
          position: { lat: coord.lat, lng: coord.lng },
          map,
          title: coord.label,
          icon: { url: `http://maps.google.com/mapfiles/ms/icons/${coord.color || 'red'}-dot.png` }
        });
      });
    }
  }, [messages]);

  const connectWebSocket = useCallback(() => {
    if (!sessionId) return;

    const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);
    setWebsocket(ws);

    ws.onopen = () => {
      console.log("WebSocket connected for candidate session:", sessionId);
      setReconnectAttempts(0);
      ws.send(JSON.stringify({ type: "ping" }));
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
          console.log("Sent ping to keep WebSocket alive");
        }
      }, 30000);
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "pong") {
          console.log("Received pong, WebSocket alive");
          return;
        }
        if (data.error) {
          console.error("WebSocket error message:", data.error);
          toast.error(`Server error: ${data.error}`, { duration: 10000 });
          return;
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
            coordinates: data.map_data.coordinates,
            llm_response: data.map_data.llm_response
          } : undefined,
          media_data: data.media_data ? {
            type: data.media_data.type,
            url: data.media_data.url
          } : undefined
        };

        setMessages(prev => {
          // Enhanced deduplication to avoid missing messages
          const isDuplicate = prev.some(
            msg =>
              msg.role === newMessage.role &&
              msg.content === newMessage.content &&
              Math.abs(msg.timestamp.getTime() - newMessage.timestamp.getTime()) < 500
          );
          if (isDuplicate) {
            console.log("Duplicate WebSocket message ignored:", data);
            return prev;
          }
          return [...prev, newMessage];
        });
        toast.info(`${data.role.toUpperCase()} sent a new message`, { duration: 5000 });
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
        toast.error("Failed to process incoming message", { duration: 5000 });
      }
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed for session ${sessionId}: code=${event.code}, reason=${event.reason}`);
      clearInterval(pingIntervalRef.current!);
      if (event.code === 1008) {
        toast.error(`Session invalid or expired: ${event.reason}`, { duration: 10000 });
      } else if (reconnectAttempts < maxReconnectAttempts) {
        setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          console.log(`Attempting WebSocket reconnect ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
          connectWebSocket();
        }, reconnectInterval);
      } else {
        toast.error("Failed to reconnect WebSocket after multiple attempts", { duration: 10000 });
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      toast.error("WebSocket connection error", { duration: 10000 });
    };
  }, [sessionId, reconnectAttempts]);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      toast.error("Missing token. Please access via a valid link", { duration: 10000 });
      return;
    }

    const validateToken = async () => {
      try {
        const response = await fetch(`http://localhost:8000/validate-token/?token=${token}`);
        if (!response.ok) throw new Error("Invalid token");
        const data = await response.json();
        setSessionId(data.session_id);
      } catch (error) {
        console.error("Token validation error:", error);
        toast.error("Invalid or expired link", { duration: 10000 });
      }
    };
    validateToken();
  }, [searchParams]);

  useEffect(() => {
    if (sessionId) {
      const fetchMessages = async () => {
        try {
          const res = await fetch(`http://localhost:8000/messages/${sessionId}`);
          if (!res.ok) throw new Error("Failed to fetch messages");
          const data = await res.json();
          const fetchedMessages: Message[] = data.messages
            .map((msg: any) => ({
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
                coordinates: msg.map_data.coordinates,
                llm_response: msg.map_data.llm_response
              } : undefined,
              media_data: msg.media_data ? {
                type: msg.media_data.type,
                url: msg.media_data.url
              } : undefined
            }))
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
          setMessages(fetchedMessages);
        } catch (error) {
          console.error("Error fetching messages:", error);
          toast.error("Failed to load messages", { duration: 10000 });
        }
      };
      fetchMessages();
      connectWebSocket();
    }

    return () => {
      if (websocket) {
        websocket.close();
        clearInterval(pingIntervalRef.current!);
        setWebsocket(null);
      }
    };
  }, [sessionId, connectWebSocket]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector(".scrollarea-viewport");
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent, overrideMessage?: string) => {
    e.preventDefault();
    if (isLoading || !sessionId || !message.trim()) {
      toast.error("Cannot send message: No session or empty message", { duration: 10000 });
      return;
    }

    setIsLoading(true);
    const finalMessage = overrideMessage || message.trim();

    try {
      // Add candidate message to UI immediately
      const candidateMessage: Message = {
        id: crypto.randomUUID(),
        role: "candidate",
        content: finalMessage,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, candidateMessage]);

      // Send query via HTTP
      const response = await fetch(`http://localhost:8000/chat/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: finalMessage, role: "candidate" })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to send message");
      }

      const data = await response.json();
      // Add assistant response to UI immediately
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        map_data: data.map_data,
        media_data: data.media_data
      };
      setMessages(prev => {
        // Remove temporary candidate message if WebSocket already added it
        const filtered = prev.filter(
          msg => !(msg.role === "candidate" && msg.content === finalMessage && Math.abs(msg.timestamp.getTime() - candidateMessage.timestamp.getTime()) < 500)
        );
        return [...filtered, assistantMessage];
      });

      setMessage("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error(`Failed to process request: ${error instanceof Error ? error.message : String(error)}`, { duration: 10000 });
      // Remove candidate message on error
      setMessages(prev => prev.filter(msg => msg.id !== candidateMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  const handleSuggestedQuestionClick = (question: string) => {
    setMessage(question);
    handleSubmit(new Event('submit') as any, question);
  };

  const handleVoiceMode = () => {
    if (!sessionId) {
      toast.error("No session selected", { duration: 10000 });
      return;
    }
    const token = searchParams.get("token");
    navigate(`/voice-interaction?sessionId=${sessionId}&token=${token}`);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
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
                        <a href={place.map_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline hover:text-primary/80 transition-colors">
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
      case "distance":
        return (
          <div className="mt-4 p-4 bg-muted rounded-xl shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm text-foreground">Distance Information</span>
            </div>
            <div className="flex flex-row items-start gap-4">
              {mapData.static_map_url && (
                <a href={mapData.map_url || '#'} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img
                    src={mapData.static_map_url}
                    alt="Distance Map"
                    className="rounded-lg w-[150px] h-auto object-cover"
                    onError={() => console.error("Failed to load map image:", mapData.static_map_url)}
                  />
                </a>
              )}
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

  const renderMediaData = (mediaData: MediaData) => {
    if (mediaData.type === "video") {
      if (mediaData.url.includes("youtube.com") || mediaData.url.includes("youtu.be")) {
        let embedUrl = mediaData.url.replace("watch?v=", "embed/");
        if (mediaData.url.includes("youtu.be")) {
          const videoId = mediaData.url.split("youtu.be/")[1].split("?")[0];
          embedUrl = `https://www.youtube.com/embed/${videoId}`;
        }
        return (
          <iframe
            src={embedUrl}
            title="Company Video"
            className="mt-3 w-full max-w-md h-64 rounded-md"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onError={() => {
              console.error(`Failed to load YouTube video: ${mediaData.url}`);
              toast.error("Failed to load company video", { duration: 5000 });
            }}
          />
        );
      }
      return (
        <video
          controls
          src={mediaData.url}
          className="mt-3 w-full max-w-md rounded-md"
          onError={() => {
            console.error(`Failed to load video: ${mediaData.url}`);
            toast.error("Failed to load company video", { duration: 5000 });
          }}
        />
      );
    } else if (mediaData.type === "image") {
      return (
        <img
          src={mediaData.url}
          alt="Related Image"
          className="mt-3 w-24 h-24 object-cover rounded-md"
          onError={() => {
            console.error(`Failed to load media image: ${mediaData.url}`);
            toast.error("Failed to load image", { duration: 5000 });
          }}
        />
      );
    }
    return null;
  };

  const handleImageClick = (src: string, alt: string) => {
    if (DEBUG) console.log(`Image clicked: src=${src}, alt=${alt}`);
    setSelectedImage({ src, alt });
    setIsDialogOpen(true);
  };

  return (
    <div className="flex h-screen w-full flex-row">
      <div
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 bg-card/50 backdrop-blur-xl border-r border-border flex flex-col transition-transform duration-300 ease-in-out z-10 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } md:relative md:translate-x-0`}
        style={{ width: isSidebarOpen ? `${sidebarWidth}px` : '0px' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h4 className="text-sm font-medium text-foreground truncate">Suggested Questions</h4>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden flex-shrink-0"
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-2">
              {suggestedQuestions.map((q, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  className="w-full text-left text-sm text-foreground border-border hover:bg-muted/50 justify-start h-auto py-2 px-3 whitespace-normal"
                  onClick={() => handleSuggestedQuestionClick(q)}
                >
                  <span className="break-words">{q}</span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div
          ref={resizeHandleRef}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors group ${
            isResizing ? 'bg-primary/40' : ''
          }`}
          onMouseDown={handleMouseDown}
        >
          <div className="absolute top-1/2 right-0 transform -translate-y-1/2 translate-x-1/2">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col flex-1" style={{ marginLeft: isSidebarOpen ? 0 : 0 }}>
        <header className="border-b border-border bg-card/50 backdrop-blur-xl p-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={toggleSidebar}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-semibold text-foreground">Candidate Chat</h1>
            </div>
            <Button
              variant="default"
              onClick={handleVoiceMode}
              className="flex items-center gap-2"
            >
              <Mic className="h-4 w-4" />
              <span className="hidden sm:inline">ASK ME</span>
            </Button>
          </div>
        </header>

        <ScrollArea className="flex-1 p-6" ref={scrollAreaRef}>
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-96 text-center">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4 animate-pulse">
                  <img
                    src="/assets/favicon.ico"
                    alt="Quadrant Technologies Logo"
                    className="w-8 h-8 object-contain"
                    onError={() => {
                      console.error("Failed to load Quadrant logo in welcome section");
                      toast.error("Failed to load logo", { duration: 5000 });
                    }}
                  />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-foreground">Welcome to QChat</h3>
                <p className="text-sm text-muted-foreground">Ask about your application or location details</p>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="animate-fade-in">
                  {(message.role === "hr" || message.role === "candidate" || message.role === "system") ? (
                    <div className={`flex ${message.role === "candidate" ? "justify-end" : "justify-start"} gap-3 mb-6`}>
                      <div className="flex flex-col items-end max-w-[70%]">
                        <div className={`chat-bubble-${message.role} rounded-2xl ${message.role === "candidate" ? "rounded-tr-md" : "rounded-tl-md"} px-4 py-3 mb-2 ${message.role === "system" ? "bg-gray-100 text-foreground font-semibold text-sm" : "bg-gradient-to-r from-blue-500 to-purple-600 text-primary-foreground"} shadow-sm transition-all duration-300 hover:shadow-md`}>
                          {message.role === "system" ? (
                            <img
                              src="/assets/favicon.ico"
                              alt="Quadrant Technologies Logo"
                              className="inline-block w-6 h-6 mr-2"
                              onError={() => {
                                console.error("Failed to load Quadrant logo for system message");
                                toast.error("Failed to load logo", { duration: 5000 });
                              }}
                            />
                          ) : (
                            <span className="text-xs font-semibold text-primary-foreground/80">{message.role.toUpperCase()}</span>
                          )}
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                      {message.role !== "system" && (
                        <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                          <AvatarFallback className={`bg-gradient-to-r ${message.role === "hr" ? "from-blue-500 to-purple-600" : "from-blue-500 to-purple-600"} text-primary-foreground`}>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ) : message.role === "assistant" ? (
                    <div className="flex gap-3 mb-6">
                      <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                        <AvatarFallback className="bg-card border">
                          <img
                            src="/assets/favicon.ico"
                            alt="Quadrant Technologies Logo"
                            className="w-6 h-6 object-contain"
                            onError={() => {
                              console.error("Failed to load Quadrant logo for assistant avatar");
                              toast.error("Failed to load logo", { duration: 5000 });
                            }}
                          />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-2">
                        <div className="chat-bubble-ai rounded-2xl rounded-tl-md px-4 py-3 bg-card shadow-sm border border-border transition-all duration-300 hover:shadow-md">
                          <div className="prose prose-sm max-w-none">
                            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                                components={{
                                  h1: ({ node, ...props }) => <h1 className="text-lg font-bold mt-4 mb-2 text-foreground" {...props} />,
                                  h2: ({ node, ...props }) => <h2 className="text-base font-semibold mt-3 mb-2 text-foreground" {...props} />,
                                  h3: ({ node, ...props }) => <h3 className="text-sm font-medium mt-2 mb-1 text-foreground" {...props} />,
                                  p: ({ node, ...props }) => <p className="text-sm mb-3 text-foreground" {...props} />,
                                  ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 text-sm text-foreground" {...props} />,
                                  ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 text-sm text-foreground" {...props} />,
                                  li: ({ node, ...props }) => {
                                    const content = props.children?.toString() || '';
                                    const className = content.includes('✅')
                                      ? 'mb-2 text-foreground flex items-start gap-2 text-green-600'
                                      : content.includes('❌')
                                      ? 'mb-2 text-foreground flex items-start gap-2 text-red-600'
                                      : 'mb-2 text-foreground flex items-start gap-2';
                                    return <li className={className} {...props} />;
                                  },
                                  strong: ({ node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
                                  em: ({ node, ...props }) => <em className="italic text-foreground" {...props} />,
                                  a: ({ node, ...props }) => <a className="text-primary underline hover:text-primary/80 transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
                                  code: ({ node, ...props }) => <code className="bg-muted px-1 py-0.5 rounded text-sm text-foreground" {...props} />,
                                  pre: ({ node, ...props }) => <pre className="bg-muted p-3 rounded-lg overflow-x-auto text-sm text-foreground" {...props} />,
                                  img: ({ node, ...props }) => (
                                    <Dialog open={isDialogOpen && selectedImage?.src === props.src} onOpenChange={(open) => {
                                      if (DEBUG) console.log(`Dialog open state changed: ${open}`);
                                      setIsDialogOpen(open);
                                      if (!open) setSelectedImage(null);
                                    }}>
                                      <DialogTrigger asChild>
                                        <img
                                          {...props}
                                          className="inline-block w-6 h-6 object-cover rounded-md ml-2 cursor-pointer hover:opacity-80 transition-opacity"
                                          onClick={() => {
                                            if (DEBUG) console.log(`Triggering dialog for image: ${props.src}`);
                                            handleImageClick(props.src || '', props.alt || '');
                                          }}
                                          onError={() => {
                                            console.error(`Failed to load inline image: ${props.src}`);
                                            toast.error(`Failed to load image: ${props.alt || 'Dress item'}`, { duration: 5005 });
                                          }}
                                        />
                                      </DialogTrigger>
                                      <DialogContent className="sm:max-w-md bg-card border border-border rounded-lg shadow-lg transition-all duration-300">
                                        <DialogHeader>
                                          <DialogTitle className="text-lg font-semibold text-foreground">{selectedImage?.alt || 'Dress Item'}</DialogTitle>
                                        </DialogHeader>
                                        <div className="flex justify-center p-4">
                                          {selectedImage?.src ? (
                                            <img
                                              src={selectedImage.src}
                                              alt={selectedImage.alt || 'Dress Item'}
                                              className="w-48 h-48 object-contain rounded-md"
                                              onError={() => {
                                                console.error(`Failed to load dialog image: ${selectedImage.src}`);
                                                toast.error(`Failed to load image: ${selectedImage.alt || 'Dress item'}`, { duration: 5005 });
                                              }}
                                            />
                                          ) : (
                                            <p className="text-sm text-muted-foreground">No image available</p>
                                          )}
                                        </div>
                                      </DialogContent>
                                    </Dialog>
                                  ),
                                }}
                              >
                                {DOMPurify.sanitize(preprocessJobDescription(message.content))}
                              </ReactMarkdown>
                            </div>
                            {message.audio_base64 && (
                              <audio controls src={`data:audio/mp3;base64,${message.audio_base64}`} className="mt-3 w-full rounded-md" />
                            )}
                            {message.map_data && renderMapData(message.map_data)}
                            {message.media_data && renderMediaData(message.media_data)}
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
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-card/50 backdrop-blur-xl p-4">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <div className="flex-1">
                <Textarea
                  ref={textareaRef}
                  value={message}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  className="min-h-[40px] max-h-[200px] resize-none"
                  disabled={isLoading}
                />
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !message.trim()}
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
    </div>
  );
}

export default CandidateChat;