// src/ws/mediaStream.js
import WebSocket, { WebSocketServer } from 'ws';

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = 'alloy'
} = process.env;

const MODEL = 'gpt-4o-realtime-preview-2024-10-01';

const SYSTEM_MESSAGE =
  'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. ' +
  'You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.';

const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created'
];

const SHOW_TIMING_MATH = false;

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: '/media-stream' });
  console.log('WebSocket server ready at /media-stream');

  wss.on('connection', (connection) => {
    console.log('Twilio Media Stream connected');

    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      }
    );

    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: REALTIME_VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ['text', 'audio'],
          temperature: 0.8
        }
      };
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH) {
          console.log(
            `Truncate elapsed: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );
        }

        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: 'clear',
            streamSid
          })
        );

        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    const sendMark = () => {
      if (!streamSid) return;
      const markEvent = {
        event: 'mark',
        streamSid,
        mark: { name: 'responsePart' }
      };
      connection.send(JSON.stringify(markEvent));
      markQueue.push('responsePart');
    };

    // --- OpenAI WS events ---
    openAiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime');
      setTimeout(initializeSession, 100);
    });

    openAiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(msg.type)) {
          console.log('OpenAI event:', msg.type);
        }

        if (msg.type === 'response.audio.delta' && msg.delta) {
          const audioDelta = {
            event: 'media',
            streamSid,
            media: { payload: msg.delta }
          };
          connection.send(JSON.stringify(audioDelta));

          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH) {
              console.log(`Start timestamp set: ${responseStartTimestampTwilio}ms`);
            }
          }

          if (msg.item_id) {
            lastAssistantItem = msg.item_id;
          }

          sendMark();
        }

        if (msg.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (e) {
        console.error('OpenAI message parse error:', e, 'raw:', data);
      }
    });

    openAiWs.on('close', () => console.log('OpenAI WS closed'));
    openAiWs.on('error', (err) => console.error('OpenAI WS error:', err));

    // --- Twilio <Stream> WS events ---
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'start':
            streamSid = data.start.streamSid;
            console.log('Stream started:', streamSid);
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH) {
              console.log(`media ts: ${latestMediaTimestamp}ms`);
            }
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;

          case 'mark':
            if (markQueue.length) markQueue.shift();
            break;

          case 'stop':
            // Call ended by Twilio
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            break;

          default:
            // other events: dtmf, dtmf_received, etc.
            break;
        }
      } catch (e) {
        console.error('Twilio message parse error:', e, 'raw:', message);
      }
    });

    connection.on('close', () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log('Twilio Media Stream disconnected');
    });
  });
}
