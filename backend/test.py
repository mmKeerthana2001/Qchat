import requests
import os

# Configuration
ELEVENLABS_API_KEY = "sk_72c55a358281c342e387852646d8eb25293f428234578d29"
ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
ELEVENLABS_MODEL_ID_TTS = "eleven_multilingual_v2"
PRELIMINARY_TEXT = "Ok, let me process that for you, give me a few seconds."
OUTPUT_PATH = "static/preliminary_response.mp3"

# Ensure the static directory exists
os.makedirs("static", exist_ok=True)

# Generate audio file
tts_url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
tts_headers = {
    "xi-api-key": ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
    "Accept": "audio/mp3"
}
tts_payload = {
    "text": PRELIMINARY_TEXT,
    "model_id": ELEVENLABS_MODEL_ID_TTS,
    "voice_settings": {
        "stability": 0.5,
        "similarity_boost": 0.5
    }
}

try:
    response = requests.post(tts_url, headers=tts_headers, json=tts_payload)
    response.raise_for_status()
    with open(OUTPUT_PATH, "wb") as f:
        f.write(response.content)
    print(f"Preliminary audio saved to {OUTPUT_PATH}")
except requests.RequestException as e:
    print(f"Error generating audio: {str(e)}")