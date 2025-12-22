/**
 * To run this server:
 * 1. Install dependencies: npm install ws @google/genai @deepgram/sdk dotenv
 * 2. Set API_KEY (Gemini) and DEEPGRAM_API_KEY in your environment variables.
 * 3. Run: npm start
 */

const { WebSocketServer } = require('ws');
const { GoogleGenAI } = require('@google/genai');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
require('dotenv').config();

const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });

console.log(`Secure Proxy Server (Deepgram Nova + Gemini Flash) running on port ${port}`);

wss.on('connection', (ws, req) => {
  console.log(`Client connected from ${req.socket.remoteAddress}`);

  let deepgramConnection = null;
  let keepAliveInterval = null;

  // Cleanup function
  const cleanup = () => {
    if (deepgramConnection) {
      // Try to finish gracefully if possible, or just close
      try { deepgramConnection.finish(); } catch (e) {}
      deepgramConnection = null;
    }
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  };

  ws.on('close', () => {
    console.log('Client disconnected');
    cleanup();
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      // 1. Initialize Pipeline
      if (message.type === 'config') {
        const { sourceLang, targetLang } = message.data;

        if (!process.env.API_KEY || !process.env.DEEPGRAM_API_KEY) {
          console.error("Error: Missing API Keys");
          ws.send(JSON.stringify({ type: 'error', message: 'Server configuration error' }));
          return;
        }

        // Initialize Gemini for Translation (Stateless/Flash)
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // Initialize Deepgram for STT (Streaming)
        const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
        
        deepgramConnection = deepgram.listen.live({
          model: "nova-2",
          language: sourceLang === 'Japanese' ? 'ja' : 'en',
          smart_format: true, // Improves translation quality by adding punctuation
          filler_words: false, // Remove "um", "uh" for cleaner subtitles
          endpointing: 300,   // Faster sentence detection (300ms silence)
          interim_results: true, // We get partials, but only translate finals
        });

        // Deepgram Event Handlers
        deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
          console.log('Deepgram STT Connected');
          ws.send(JSON.stringify({ type: 'connected' }));
          
          // Keep Deepgram connection alive if silence persists
          keepAliveInterval = setInterval(() => {
            if (deepgramConnection) {
              deepgramConnection.keepAlive();
            }
          }, 10000);
        });

        deepgramConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
          const transcript = data.channel.alternatives[0].transcript;
          const isFinal = data.is_final;

          // Only translate if we have text and it is a finalized sentence/phrase.
          // Translating interim results causes flickering and wastes API tokens.
          if (transcript && isFinal && transcript.trim().length > 0) {
            try {
              // Call Gemini Flash for Translation
              const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Translate the following ${sourceLang} text to ${targetLang} naturally for subtitles. Only output the translation, nothing else.\n\nText: "${transcript}"`,
              });

              const translatedText = response.text;
              
              if (translatedText) {
                ws.send(JSON.stringify({
                  type: 'text',
                  content: translatedText
                }));
                // Signal turn completion for UI effects if needed
                ws.send(JSON.stringify({ type: 'turn_complete' }));
              }
            } catch (err) {
              console.error("Translation Error:", err.message);
            }
          }
        });

        deepgramConnection.on(LiveTranscriptionEvents.Error, (err) => {
          console.error("Deepgram Error:", err);
          ws.send(JSON.stringify({ type: 'error', message: 'Transcription service error' }));
        });

        deepgramConnection.on(LiveTranscriptionEvents.Close, () => {
          console.log('Deepgram Connection Closed');
          cleanup();
        });

      // 2. Handle Audio Stream
      } else if (message.type === 'audio_input') {
        if (deepgramConnection && deepgramConnection.getReadyState() === 1) { // 1 = OPEN
          // Convert base64 from client back to Buffer for Deepgram
          const audioBuffer = Buffer.from(message.data.data, 'base64');
          deepgramConnection.send(audioBuffer);
        }
      }

    } catch (e) {
      console.error('Server Logic Error:', e.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
    }
  });
});
