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
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reconnectAttempts = useRef<number>(0);
  const maxReconnectAttempts = 3;
  const reconnectInterval = 5000; // 5 seconds

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
          return;
        }
        // Only process assistant responses with audio_base64
        if (data.audio_base64 && data.role === 'assistant') {
          if (audioRef.current) {
            audioRef.current.src = `data:audio/mpeg;base64,${data.audio_base64}`;
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
    const sessionId = queryParams.get('sessionId');
    const token = queryParams.get('token');
    if (!sessionId || !token) {
      setError('Missing session ID or token. Please access via the chat page.');
      return;
    }
    setSessionId(sessionId);

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
    };
  }, [location.search, connectWebSocket]);

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
            })
          );
          setTimeout(() => {
            if (isProcessing) {
              setError('No response from server. Please try again.');
              setIsProcessing(false);
            }
          }, 10000);
        } else {
          setError('WebSocket is not connected. Please try again.');
          setIsProcessing(false);
        }
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
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
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

  const handleBack = () => {
    const token = new URLSearchParams(location.search).get('token');
    navigate(`/candidate-chat?token=${token}`);
  };

  if (error) {
    return <div className="text-red-500 text-center p-4">{error}</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="bg-white shadow p-4 flex items-center">
        <button
          onClick={handleBack}
          className="p-2 bg-gray-500 hover:bg-gray-600 text-white rounded-full mr-2"
          title="Back to Chat"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <img src="/assets/favicon.ico" alt="Quadrant Logo" className="h-8 w-8 mr-2" />
        <h1 className="text-xl font-bold">Voice Interaction</h1>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center text-gray-500">
          Speak your question, and I'll respond with voice.
        </div>
      </div>
      <div className="bg-white p-4 flex items-center space-x-2">
        <button
          onClick={toggleRecording}
          disabled={isProcessing}
          className={`p-2 rounded-full ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600'
              : isProcessing
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-green-500 hover:bg-green-600'
          } text-white`}
          title={isRecording ? 'Stop Listening' : 'Start Listening'}
        >
          {isProcessing ? (
            <FontAwesomeIcon icon={faSpinner} spin />
          ) : (
            <FontAwesomeIcon icon={faMicrophone} />
          )}
        </button>
        <button
          onClick={togglePause}
          disabled={!isPlaying && !isPaused}
          className={`p-2 rounded-full ${
            isPlaying || isPaused ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-300 cursor-not-allowed'
          } text-white`}
          title={isPaused ? 'Resume Response' : 'Pause Response'}
        >
          <FontAwesomeIcon icon={isPaused ? faPlay : faPause} />
        </button>
        <button
          onClick={stopResponse}
          disabled={!isPlaying && !isPaused}
          className={`p-2 rounded-full ${
            isPlaying || isPaused ? 'bg-orange-500 hover:bg-orange-600' : 'bg-gray-300 cursor-not-allowed'
          } text-white`}
          title="Stop Response"
        >
          <FontAwesomeIcon icon={faStop} />
        </button>
      </div>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onEnded={() => {
          setIsPlaying(false);
          setIsPaused(false);
        }}
      />
    </div>
  );
};

export default VoiceInteraction;