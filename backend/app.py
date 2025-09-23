# app.py

import os
import asyncio
from fastapi import FastAPI, WebSocket
from dotenv import load_dotenv
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

load_dotenv()
app = FastAPI()

client = TranscribeStreamingClient(region=os.getenv("AWS_REGION"))

class MyEventHandler(TranscriptResultStreamHandler):
    def __init__(self, output_stream, websocket: WebSocket):
        super().__init__(output_stream)
        self.websocket = websocket

    async def handle_transcript_event(self, transcript_event: TranscriptEvent):
        for result in transcript_event.transcript.results:
            for alt in result.alternatives:
                text = alt.transcript
                if text.strip():
                    await self.websocket.send_text(text)

@app.websocket("/transcribe")
async def transcribe_audio(websocket: WebSocket):
    await websocket.accept()

    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=16000,
        media_encoding="pcm"
    )

    handler = MyEventHandler(stream.output_stream, websocket)
    handler_task = asyncio.create_task(handler.handle_events())

    try:
        while True:
            data = await websocket.receive_bytes()
            await stream.input_stream.send_audio_event(audio_chunk=data)
    except Exception as e:
        print("WebSocket closed:", e)
    finally:
        await stream.input_stream.end_stream()
        await handler_task
        await websocket.close()