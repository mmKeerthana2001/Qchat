import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faStop, faSpinner, faArrowLeft, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import './VoiceInteraction.css';

interface Message {
  role: string;
  query: string;
  response: string;
  timestamp: number;
  audio_base64?: string;
  map_data?: any;
  media_data?: { type: string; url: string };
}

const VoiceInteraction: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentAudioType, setCurrentAudioType] = useState<'none' | 'preliminary' | 'delay' | 'response'>('none');
  const [queryCount, setQueryCount] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const secondaryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Renamed from delayTimeoutRef to match reference
  const reconnectAttempts = useRef<number>(0);
  const maxReconnectAttempts = 3;
  const reconnectInterval = 7000;

  // Array of preliminary response audio files in sequence
  const preliminaryAudios = [
    '/static/preliminary_response.mp3',
    '/static/preliminary_response_a.mp3',
    '/static/preliminary_response_b.mp3',
    '/static/preliminary_response_c.mp3',
    '/static/preliminary_response_d.mp3',
    '/static/preliminary_response_e.mp3'
  ];

  const getNextPreliminaryAudio = () => {
    const index = queryCount % preliminaryAudios.length;
    return preliminaryAudios[index];
  };

  const connectWebSocket = useCallback(() => {
    if (!sessionId) return;

    socketRef.current = new WebSocket(`ws://localhost:8000/ws/voice/${sessionId}`);
    socketRef.current.onopen = () => {
      console.log(`Voice WebSocket connected for session: ${sessionId}`);
      reconnectAttempts.current = 0;
      setError(null);
      const pingInterval = setInterval(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
      socketRef.current.onclose = () => clearInterval(pingInterval);
    };

    socketRef.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          console.log('Received pong, Voice WebSocket alive');
          return;
        }
        if (data.error) {
          setError(`WebSocket error: ${data.error}`);
          setIsProcessing(false);
          setIsRecording(false);
          // Clear secondary timeout on error
          if (secondaryTimeoutRef.current) {
            clearTimeout(secondaryTimeoutRef.current);
            secondaryTimeoutRef.current = null;
          }
          return;
        }
        // Only process assistant responses with audio_base64
        if (data.audio_base64 && data.role === 'assistant') {
          if (audioRef.current) {
            // Clear any pending secondary timeout
            if (secondaryTimeoutRef.current) {
              clearTimeout(secondaryTimeoutRef.current);
              secondaryTimeoutRef.current = null;
            }
            audioRef.current.src = `data:audio/mpeg;base64,${data.audio_base64}`;
            setCurrentAudioType('response');
            try {
              await audioRef.current.play();
              setIsPlaying(true);
              setIsPaused(false);
            } catch (err) {
              console.error('Error playing audio:', err);
              setError('Failed to play assistant response.');
            }
          }
          setIsProcessing(false);
        } else {
          console.log('Ignoring non-assistant or non-voice message:', data);
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
        setError('Failed to process incoming voice message.');
      }
    };

    socketRef.current.onerror = (err) => {
      console.error('Voice WebSocket error:', err);
      setError('WebSocket connection error. Attempting to reconnect...');
    };

    socketRef.current.onclose = (event) => {
      console.log(`Voice WebSocket closed for session: ${sessionId}`, event);
      if (event.code === 1008) {
        setError(`Session invalid or expired: ${event.reason}`);
      } else if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current += 1;
        setTimeout(connectWebSocket, reconnectInterval);
      } else {
        setError('Failed to reconnect to voice WebSocket after multiple attempts.');
      }
    };
  }, [sessionId]);

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const sessionIdParam = queryParams.get('sessionId');
    const token = queryParams.get('token');
    if (!sessionIdParam || !token) {
      setError('Missing session ID or token. Please access via the chat page.');
      return;
    }
    setSessionId(sessionIdParam);

    const validateToken = async () => {
      try {
        await axios.get('http://localhost:8000/validate-token/', { params: { token } });
      } catch (err: any) {
        console.error('Token validation error:', err);
        setError('Invalid or expired token. Please request a new link.');
      }
    };
    validateToken();

    connectWebSocket();

    return () => {
      socketRef.current?.close();
      if (secondaryTimeoutRef.current) {
        clearTimeout(secondaryTimeoutRef.current);
      }
    };
  }, [location.search, connectWebSocket]);

  const playPreliminaryResponse = () => {
    if (audioRef.current) {
      const audioPath = getNextPreliminaryAudio();
      console.log(`Playing preliminary audio ${queryCount + 1}: ${audioPath}`);
      audioRef.current.src = audioPath;
      setCurrentAudioType('preliminary');
      audioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setIsPaused(false);
        })
        .catch(err => {
          console.error('Error playing preliminary response:', err);
          setError(`Failed to play preliminary audio: ${audioPath}`);
        });
    }
  };

  const playDelayResponse = () => {
    if (audioRef.current) {
      audioRef.current.src = '/static/preliminary_response_1.mp3';
      setCurrentAudioType('delay');
      audioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setIsPaused(false);
        })
        .catch(err => {
          console.error('Error playing delay response:', err);
        });
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const audioChunks: Blob[] = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        if (audioChunks.length === 0) {
          setError('No audio recorded. Please try again.');
          setIsProcessing(false);
          return;
        }
        
        setQueryCount(prev => {
          const newCount = prev + 1;
          console.log(`User query #${newCount}`);
          return newCount;
        });
        
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64Audio = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: 'audio',
              audio_data: base64Audio,
              timestamp: Date.now() / 1000,
              query_count: queryCount + 1
            })
          );
          
          playPreliminaryResponse();
          
          // Main timeout for no response
          setTimeout(() => {
            if (isProcessing) {
              setError('No response from server. Please try again.');
              setIsProcessing(false);
            }
          }, 15000);
        } else {
          setError('WebSocket is not connected. Please try again.');
          setIsProcessing(false);
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start(1000);
      setIsRecording(true);
    } catch (err: any) {
      console.error('Error starting recording:', err);
      setError('Failed to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const stopResponse = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentAudioType('none');
      if (secondaryTimeoutRef.current) {
        clearTimeout(secondaryTimeoutRef.current);
        secondaryTimeoutRef.current = null;
      }
    }
  };

  const togglePause = () => {
    if (audioRef.current) {
      if (isPaused) {
        audioRef.current.play();
        setIsPlaying(true);
        setIsPaused(false);
      } else if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        setIsPaused(true);
      }
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setIsPaused(false);
    if (isProcessing) {
      if (currentAudioType === 'preliminary') {
        // Set 4-second delay for delay audio (adapted from reference's 7-second logic)
        secondaryTimeoutRef.current = setTimeout(() => {
          if (isProcessing) {
            playDelayResponse();
          }
        }, 4000); // Changed from 7000 to 4000 for 4 seconds
      }
      // For 'delay', do nothing additional
    }
    setCurrentAudioType('none');
  };

  const handleBack = () => {
    const token = new URLSearchParams(location.search).get('token');
    navigate(`/candidate-chat?token=${token}`);
  };

  const getStatusText = () => {
    if (isRecording) return 'Listening...';
    if (isProcessing) return 'Thinking...';
    if (isPlaying) return 'Speaking...';
    if (isPaused) return 'Paused';
    return 'Speak your question, and I\'ll respond with voice.';
  };

  const getBlobClass = () => {
    if (isRecording) return 'blob listening';
    if (isProcessing) return 'blob thinking';
    if (isPlaying) return 'blob speaking';
    return 'blob idle';
  };

  if (error) {
    return (
      <div className="text-red-500 text-center p-4 bg-black h-screen flex items-center justify-center">
        <div>
          <h2 className="text-lg mb-4">Error</h2>
          <p>{error}</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      <div className="p-4 flex items-center">
        <button
          onClick={handleBack}
          className="p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full mr-2"
          title="Back to Chat"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <img src="/assets/favicon.ico" alt="Quadrant Logo" className="h-8 w-8 mr-2" />
        <h1 className="text-xl font-bold">Voice Interaction</h1>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className={getBlobClass()}></div>
        <div className="mt-4 text-gray-400 text-center">
          {getStatusText()}
        </div>
      </div>
      
      <div className="p-4 flex justify-center items-center space-x-4 bg-black">
        <button
          onClick={toggleRecording}
          disabled={isProcessing || isPlaying || isPaused}
          className={`p-4 rounded-full text-white ${
            isRecording
              ? 'bg-red-600 hover:bg-red-700'
              : isProcessing
              ? 'bg-gray-600 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
          title={isRecording ? 'Stop Listening' : 'Start Listening'}
        >
          {isProcessing ? (
            <FontAwesomeIcon icon={faSpinner} spin size="lg" />
          ) : (
            <FontAwesomeIcon icon={faMicrophone} size="lg" />
          )}
        </button>
        <button
          onClick={togglePause}
          disabled={!isPlaying && !isPaused}
          className={`p-4 rounded-full text-white ${
            isPlaying || isPaused ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 cursor-not-allowed'
          }`}
          title={isPaused ? 'Resume Response' : 'Pause Response'}
        >
          <FontAwesomeIcon icon={isPaused ? faPlay : faPause} size="lg" />
        </button>
        <button
          onClick={stopResponse}
          disabled={!isPlaying && !isPaused}
          className={`p-4 rounded-full text-white ${
            isPlaying || isPaused ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 cursor-not-allowed'
          }`}
          title="Stop Response"
        >
          <FontAwesomeIcon icon={faStop} size="lg" />
        </button>
      </div>
      
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onEnded={handleAudioEnded}
        onError={(e) => {
          console.error('Audio playback error:', e);
          setError('Failed to play audio file');
          setIsPlaying(false);
        }}
      />
    </div>
  );
};

export default VoiceInteraction;