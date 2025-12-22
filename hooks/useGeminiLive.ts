import { useState, useRef, useCallback, useEffect } from 'react';
import { createPcmBlob, decode, decodeAudioData } from '../utils/audio';

interface UseGeminiLiveProps {
  sourceLang: string;
  targetLang: string;
  playAudio: boolean;
}

export const useGeminiLive = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string>('');
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Socket Ref
  const socketRef = useRef<WebSocket | null>(null);
  
  // Transcript Buffer
  const currentTranscriptionRef = useRef<string>('');

  const connect = useCallback(async ({ sourceLang, targetLang, playAudio }: UseGeminiLiveProps) => {
    try {
      setIsConnecting(true);
      setError(null);
      setCurrentText('');
      currentTranscriptionRef.current = '';

      // Initialize Audio Contexts first
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Determine WebSocket URL based on environment
      // In production, we typically use the same host but with ws/wss protocol
      // Or use a specific env var if backend is separate
      let wsUrl = 'ws://localhost:8080'; // Default local

      const meta = import.meta as any;
      if (meta.env && meta.env.VITE_BACKEND_URL) {
        wsUrl = meta.env.VITE_BACKEND_URL;
      } else if (window.location.protocol.startsWith('http')) {
        // If deployed to same domain (e.g. valid for some setups), infer WS url
        // But since we are splitting Frontend and Backend usually, explicit URL is better.
        // For now, if we are on https, assume secure wss on the backend
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // If running in a cloud environment where frontend/backend are separate, 
        // you MUST set VITE_BACKEND_URL. 
        // If falling back to localhost logic:
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
             // Placeholder: User needs to configure this for their specific deployment
             console.warn("Running on remote host but VITE_BACKEND_URL not set. Connection might fail.");
        }
      }

      console.log(`Connecting to backend: ${wsUrl}`);
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        // Send configuration to server
        socket.send(JSON.stringify({
          type: 'config',
          data: { sourceLang, targetLang }
        }));
      };

      socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'connected':
            setIsConnected(true);
            setIsConnecting(false);
            startAudioStreaming(); // Start sending microphone data
            break;

          case 'text':
            if (msg.content) {
              currentTranscriptionRef.current += msg.content;
              if (currentTranscriptionRef.current.length > 500) {
                  currentTranscriptionRef.current = currentTranscriptionRef.current.slice(-500);
              }
              setCurrentText(currentTranscriptionRef.current);
            }
            break;
          
          case 'turn_complete':
             currentTranscriptionRef.current += " ";
             setCurrentText(currentTranscriptionRef.current);
             break;

          case 'audio':
            if (playAudio && audioContextRef.current && msg.data) {
              handleAudioPlayback(msg.data);
            }
            break;

          case 'error':
            // Generic error for user
            setError(msg.message);
            setIsConnected(false);
            break;
        }
      };

      socket.onerror = (e) => {
        console.error("WebSocket Error", e);
        setError("Connection failed. Ensure backend server is running.");
        setIsConnecting(false);
        setIsConnected(false);
      };

      socket.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
      };

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to start session");
      setIsConnecting(false);
    }
  }, []);

  const startAudioStreaming = () => {
    if (!inputContextRef.current || !streamRef.current || !socketRef.current) return;
    
    const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
    const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (e) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        // We reuse the existing util to create the blob format Gemini expects
        // But we send it to our proxy server instead
        const pcmBlob = createPcmBlob(inputData);
        
        socketRef.current.send(JSON.stringify({
          type: 'audio_input',
          data: pcmBlob // { mimeType: '...', data: 'base64...' }
        }));
      }
    };

    source.connect(processor);
    processor.connect(inputContextRef.current.destination);
    
    sourceRef.current = source;
    processorRef.current = processor;
  };

  const handleAudioPlayback = async (base64Audio: string) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    
    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    
    try {
      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        ctx,
        24000,
        1
      );
      
      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(ctx.destination);
      bufferSource.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    } catch (e) {
      console.error("Audio decode error", e);
    }
  };

  const disconnect = useCallback(() => {
    // Stop tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Disconnect audio nodes
    if (processorRef.current && inputContextRef.current) {
      processorRef.current.disconnect();
      sourceRef.current?.disconnect();
    }

    if (inputContextRef.current?.state !== 'closed') {
      inputContextRef.current?.close();
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    
    // Close Socket
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setIsConnected(false);
    setCurrentText('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isConnecting,
    error,
    currentText,
    connect,
    disconnect
  };
};