import os
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List
from read_files import ReadFiles
from context_manager import ContextManager
from login import LoginHandler
from agent import Agent
import logging
from fastapi.responses import JSONResponse, RedirectResponse, Response, FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
import time
from pydantic import BaseModel
import io
import uuid
import re
import boto3
import base64
from pymongo import MongoClient
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent
from dotenv import load_dotenv
import pathlib
from datetime import datetime
import googlemaps
from googlemaps.exceptions import ApiError
import urllib.parse
from rapidfuzz import process, fuzz

load_dotenv()
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_POLLY_VOICE_ID = os.getenv("AWS_POLLY_VOICE_ID", "Joanna")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

polly = boto3.client(
    'polly',
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY
)

session_storage = {}
transcribe_client = TranscribeStreamingClient(region=AWS_REGION)

gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY) if GOOGLE_MAPS_API_KEY else None

agent = Agent()

class DebugMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        logger.debug(f"Request path: {request.url.path}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        if request.headers.get("content-type", "").startswith("multipart/form-data"):
            logger.debug("Multipart form data request detected")
        response = await call_next(request)
        return response

app = FastAPI()
app.add_middleware(DebugMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

file_reader = ReadFiles()
context_manager = ContextManager()
login_handler = LoginHandler()

websocket_connections = {}

logging.basicConfig(level=logging.INFO)
logging.getLogger("python_multipart").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

mongo_client = MongoClient("mongodb://localhost:27017")
db = mongo_client["document_analysis"]
sessions_collection = db["sessions"]

security = HTTPBearer(auto_error=False)

async def verify_session(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials or credentials.scheme != "Bearer" or not credentials.credentials:
        logger.error("Invalid or missing Authorization header. Expected: 'Bearer <session_id>'")
        raise HTTPException(status_code=401, detail="Invalid or missing Authorization header")
    session_id = credentials.credentials
    try:
        session = sessions_collection.find_one({"session_id": session_id})
        if not session:
            logger.error(f"Invalid session ID: {session_id}")
            raise HTTPException(status_code=401, detail="Invalid session ID")
        if session.get("expires_at") < datetime.utcnow():
            logger.error(f"Session expired: {session_id}")
            raise HTTPException(status_code=401, detail="Session expired")
        logger.info(f"Verified session {session_id} for user {session['email']}")
        return {"user_id": session["user_id"], "email": session["email"]}
    except Exception as e:
        logger.error(f"Error verifying session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error verifying session: {str(e)}")

class QueryRequest(BaseModel):
    query: str
    role: str
    voice_mode: bool = False

class SessionRequest(BaseModel):
    candidate_name: str
    candidate_email: str

class InitialMessageRequest(BaseModel):
    message: str

def is_valid_uuid(value: str) -> bool:
    uuid_pattern = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )
    return bool(uuid_pattern.match(value))

class MyEventHandler(TranscriptResultStreamHandler):
    def __init__(self, stream, websocket: WebSocket):
        super().__init__(stream)
        self.websocket = websocket

    async def handle_transcript_event(self, transcript_event: TranscriptEvent):
        for result in transcript_event.transcript.results:
            for alt in result.alternatives:
                text = alt.transcript
                if text.strip():
                    await self.websocket.send_text(text)

@app.get("/login")
async def initiate_login():
    try:
        return await login_handler.initiate_login()
    except Exception as e:
        logger.error(f"Error initiating login: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error initiating login: {str(e)}")

@app.get("/callback")
async def handle_callback(request: Request):
    try:
        return await login_handler.handle_callback(request)
    except HTTPException as e:
        logger.error(f"HTTP error in callback: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error handling callback: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error handling callback: {str(e)}")

@app.get("/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        if credentials and credentials.scheme == "Bearer" and credentials.credentials:
            session_id = credentials.credentials
            sessions_collection.delete_one({"session_id": session_id})
            logger.info(f"Session {session_id} invalidated")
        return RedirectResponse(url="http://localhost:8080/")
    except Exception as e:
        logger.error(f"Error during logout: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error during logout: {str(e)}")

@app.get("/user-info", dependencies=[Depends(verify_session)])
async def get_user_info(user: dict = Depends(verify_session)):
    return {"email": user["email"]}

@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)

@app.get("/sessions/", dependencies=[Depends(verify_session)])
async def get_sessions():
    try:
        sessions = await context_manager.list_sessions()
        return JSONResponse(content={"sessions": sessions})
    except Exception as e:
        logger.error(f"Error fetching sessions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching sessions: {str(e)}")

@app.post("/create-session/", dependencies=[Depends(verify_session)])
async def create_session(request: SessionRequest):
    try:
        start_time = time.time()
        session_id = str(uuid.uuid4())
        share_token = str(uuid.uuid4())
        await context_manager.create_session(session_id, request.candidate_name, request.candidate_email, share_token)
        logger.info(f"Created new session: {session_id} for {request.candidate_name}")
        logger.info(f"Session creation time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content={"session_id": session_id, "share_token": share_token})
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating session: {str(e)}")

@app.post("/extract-text/{session_id}")
async def extract_text_from_files(session_id: str, files: List[UploadFile] = File(...)):
    start_time = time.time()
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        
        logger.info(f"Received {len(files)} files for session {session_id}: {[file.filename for file in files]}")
        allowed_extensions = ["pdf", "doc", "docx"]
        file_contents = []
        for file in files:
            if not file.filename:
                raise HTTPException(status_code=400, detail="No filename provided for one or more files")
            file_ext = file.filename.split(".")[-1].lower()
            if file_ext not in allowed_extensions:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file format: {file_ext}. Supported formats: {allowed_extensions}"
                )
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"Empty file: {file.filename}")
            file_contents.append((file.filename, io.BytesIO(content)))
            logger.debug(f"Read {file.filename} into memory")
        
        results = await file_reader.file_reader(file_contents)
        extracted_text = {filename: text for filename, text in results.items()}
        for filename, text in extracted_text.items():
            logger.info(f"Processed {filename}: {len(text)} characters")
        
        await context_manager.store_session_data(session_id, extracted_text)
        
        if session_id in websocket_connections:
            for ws in websocket_connections[session_id]:
                try:
                    for filename in extracted_text.keys():
                        await ws.send_json({
                            "type": "file_uploaded",
                            "filename": filename,
                            "path": f"uploads/{session_id}/{filename}",
                            "timestamp": time.time()
                        })
                except:
                    websocket_connections[session_id].remove(ws)
        
        logger.info(f"Total processing time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content={"session_id": session_id, "extracted_text": extracted_text})
    
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error processing files for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@app.post("/upload-files/{session_id}")
async def upload_files(session_id: str, files: List[UploadFile] = File(...)):
    try:
        return await extract_text_from_files(session_id, files)
    except HTTPException as e:
        logger.error(f"HTTP error in upload-files: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error uploading files for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error uploading files: {str(e)}")

@app.get("/files/{session_id}")
async def get_files(session_id: str):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        session = await context_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        extracted_text = session.get("extracted_text", {})
        files = [{"filename": filename, "path": f"uploads/{session_id}/{filename}"} for filename in extracted_text.keys()]
        logger.info(f"Retrieved {len(files)} files for session {session_id}")
        return JSONResponse(content={"files": files})
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error retrieving files for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving files: {str(e)}")

@app.get("/download-file/{session_id}")
async def download_file(session_id: str, path: str):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        file_path = pathlib.Path(path)
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(file_path, filename=file_path.name)
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error downloading file for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

@app.get("/messages/{session_id}")
async def get_messages(session_id: str):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        
        session = await context_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        chat_history = session.get("chat_history", [])
        messages = [
            {
                "role": msg["role"],
                "query": msg.get("query", ""),
                "response": msg.get("response", ""),
                "timestamp": msg.get("timestamp", time.time()),
                "audio_base64": msg.get("audio_base64"),
                "map_data": msg.get("map_data")
            }
            for msg in chat_history
        ]
        logger.info(f"Retrieved {len(messages)} messages for session {session_id}")
        return JSONResponse(content={"messages": messages})
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error retrieving messages for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving messages: {str(e)}")

@app.post("/send-initial-message/{session_id}", dependencies=[Depends(verify_session)])
async def send_initial_message(session_id: str, req: InitialMessageRequest):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        
        await context_manager.add_initial_message(session_id, req.message)
        if session_id in websocket_connections:
            for ws in websocket_connections[session_id]:
                try:
                    await ws.send_json({
                        "role": "hr",
                        "content": req.message,
                        "timestamp": time.time(),
                        "type": "initial"
                    })
                except:
                    websocket_connections[session_id].remove(ws)
        
        return JSONResponse(content={"status": "Initial message sent and flag set"})
    except Exception as e:
        logger.error(f"Error sending initial message for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error sending initial message: {str(e)}")

@app.get("/generate-share-link/{session_id}", dependencies=[Depends(verify_session)])
async def generate_share_link(session_id: str):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        session = await context_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if not session.get("initial_message_sent", False):
            raise HTTPException(status_code=403, detail="Initial message must be sent before generating share link")
        share_token = session.get("share_token")
        link = f"http://localhost:8080/candidate-chat?token={share_token}"
        return JSONResponse(content={"share_link": link})
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error generating share link for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating share link: {str(e)}")

@app.get("/get-session/{session_id}")
async def get_session(session_id: str):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        session = await context_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return JSONResponse(content={
            "initial_message_sent": session.get("initial_message_sent", False)
        })
    except Exception as e:
        logger.error(f"Error getting session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting session: {str(e)}")

@app.get("/validate-token/")
async def validate_token(token: str):
    try:
        session_id = await context_manager.validate_token(token)
        if not session_id:
            logger.warning(f"Invalid or expired token: {token}")
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        logger.info(f"Validated token {token} for session {session_id}")
        return JSONResponse(content={"session_id": session_id})
    except HTTPException as e:
        raise
    except Exception as e:
        logger.error(f"Unexpected error validating token {token}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Unexpected error validating token: {str(e)}")

@app.post("/chat/{session_id}")
async def chat_with_documents(session_id: str, query_req: QueryRequest):
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        
        start_time = time.time()
        logger.info(f"Received chat query for session {session_id}: {query_req.query} by {query_req.role}")

        session = await context_manager.get_session(session_id)
        history = session.get("chat_history", [])
        query_corrected = await agent.correct_query(query_req.query, history, query_req.role)

        query_lower = query_corrected.lower()
        is_map_query = any(keyword in query_lower for keyword in [
            "address", "nearby", "near", "pgs", "restaurants", "directions", 
            "locations", "where", "all", "offices", "location", "loctaion", 
            "ocation", "pg", "restruants", "malaysia", "australia", "uk", 
            "mexico", "canada", "uae", "ladies pg", "gents pg", "ladies pgs", "gents pgs"
        ])
        
        if is_map_query and gmaps:
            try:
                map_data = await handle_map_query(session_id, QueryRequest(query=query_corrected, role=query_req.role, voice_mode=query_req.voice_mode))
                response, history = await context_manager.process_map_query(session_id, query_corrected, query_req.role, map_data)
            except HTTPException as e:
                logger.warning(f"Map query failed for session {session_id}: {e.detail}")
                response = f"Sorry, I couldn't find location information for '{query_corrected}'. Please check the spelling or try a different location."
                history.append({
                    "role": query_req.role,
                    "query": query_corrected,
                    "response": response,
                    "timestamp": time.time()
                })
                await context_manager.store_session_data(session_id, {"extracted_text": {}})  # Store empty extracted_text
                response_data = {"response": response, "history": history}
                if query_req.voice_mode and AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
                    try:
                        synth_response = polly.synthesize_speech(
                            Text=response,
                            OutputFormat='mp3',
                            VoiceId=AWS_POLLY_VOICE_ID,
                            Engine='neural'
                        )
                        audio_data = synth_response['AudioStream'].read()
                        response_data['audio_base64'] = base64.b64encode(audio_data).decode('utf-8')
                        logger.info(f"Generated audio for session {session_id}")
                    except Exception as e:
                        logger.error(f"Polly TTS error for session {session_id}: {str(e)}")
                        response_data['audio_base64'] = None
                return JSONResponse(content=response_data)
        else:
            session_data = await context_manager.get_session(session_id)
            if not session_data.get("extracted_text"):
                response = "No documents available to answer your query. Please upload relevant documents or ask a location-based question."
                history.append({
                    "role": query_req.role,
                    "query": query_corrected,
                    "response": response,
                    "timestamp": time.time()
                })
                await context_manager.store_session_data(session_id, {"extracted_text": {}})
            else:
                response, history = await context_manager.process_query(session_id, query_corrected, query_req.role)
        
        if session_id in websocket_connections:
            for ws in websocket_connections[session_id]:
                try:
                    await ws.send_json({
                        "role": query_req.role,
                        "content": query_req.query,
                        "timestamp": time.time()
                    })
                    await ws.send_json({
                        "role": "assistant",
                        "content": response,
                        "timestamp": time.time(),
                        "map_data": map_data if is_map_query and 'map_data' in locals() else None
                    })
                except:
                    websocket_connections[session_id].remove(ws)

        response_data = {"response": response, "history": history}
        if query_req.voice_mode:
            if not AWS_ACCESS_KEY_ID or not AWS_SECRET_ACCESS_KEY:
                raise HTTPException(status_code=500, detail="AWS credentials not configured")
            try:
                synth_response = polly.synthesize_speech(
                    Text=response,
                    OutputFormat='mp3',
                    VoiceId=AWS_POLLY_VOICE_ID,
                    Engine='neural'
                )
                audio_data = synth_response['AudioStream'].read()
                response_data['audio_base64'] = base64.b64encode(audio_data).decode('utf-8')
                logger.info(f"Generated audio for session {session_id}")
            except Exception as e:
                logger.error(f"Polly TTS error for session {session_id}: {str(e)}")
                response_data['audio_base64'] = None
        
        logger.info(f"Chat processing time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content=response_data)
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error processing chat query for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing chat query: {str(e)}")

# Mapping for country names to specific cities
country_to_city = {
    "malaysia": "Kuala Lumpur, Malaysia",
    "australia": "Lane Cove, Australia",
    "uk": "Chiswick, UK",
    "mexico": "Guadalajara, Mexico",
    "canada": "Surrey, Canada",
    "uae": "Dubai, UAE"
}

@app.post("/map-query/{session_id}")
async def handle_map_query(session_id: str, query_req: QueryRequest):
    try:
        if not gmaps:
            raise HTTPException(status_code=500, detail="Google Maps API key not configured")
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")

        query = query_req.query.lower()
        map_data = {}

        # Hardcoded Quadrant Technologies locations with coordinates
        quadrant_locations = [
            {"city": "US, Redmond, WA", "address": "5020, 148th Ave NE Ste 250, Redmond, WA, 98052", "lat": 47.6456, "lng": -122.1419},
            {"city": "Iselin, NJ", "address": "33 S Wood Ave, Suite 600, Iselin, New Jersey, 08830", "lat": 40.5754, "lng": -74.3282},
            {"city": "Dallas, TX", "address": "3333 Lee Pkwy #600, Dallas, Texas, 75219", "lat": 32.8085, "lng": -96.8035},
            {"city": "Hyderabad, Telangana", "address": "4th floor, Building No.21, Raheja Mindspace, Sy No. 64 (Part), Madhapur, Hyderabad, Telangana, 500081", "lat": 17.4416, "lng": 78.3804},
            {"city": "Bengaluru, Karnataka", "address": "Office No. 106, #1, Navarathna garden, Doddakallasandra Kanakpura Road, Bengaluru, Karnataka, 560062", "lat": 12.8797, "lng": 77.5407},
            {"city": "Warangal, Telangana", "address": "IT - SEZ, Madikonda, Warangal, Telangana, 506009", "lat": 17.9475, "lng": 79.5781},
            {"city": "Noida, Uttar Pradesh", "address": "Worcoz, A-24, 1st Floor, Sector 63, Noida, Uttar Pradesh, 201301", "lat": 28.6270, "lng": 77.3727},
            {"city": "Guadalajara, Mexico", "address": "Amado Nervo 785, Guadalajara, Jalisco, 44656", "lat": 20.6720, "lng": -103.3668},
            {"city": "Surrey, Canada", "address": "7404 King George Blvd, Suite 200, Surrey, British Columbia, V3W 1N6", "lat": 49.1372, "lng": -122.8457},
            {"city": "Dubai, UAE", "address": "The Meydan Hotel, Grandstand, 6th floor, Meydan Road, Dubai, Nad Al Sheba", "lat": 25.1560, "lng": 55.2964},
            {"city": "Lane Cove, Australia", "address": "24 Birdwood Lane, Lane Cove, New South Wales", "lat": -33.8144, "lng": 151.1693},
            {"city": "Kuala Lumpur, Malaysia", "address": "19A-24-3, Level 24, Wisma UOA No. 19, Jalan Pinang, Business Suite Unit, Kuala Lumpur, Wilayah Persekutuan, 50450", "lat": 3.1517, "lng": 101.7129},
            {"city": "Singapore", "address": "#02-01, 68 Circular Road, Singapore, 049422", "lat": 1.2864, "lng": 103.8491},
            {"city": "Chiswick, UK", "address": "Gold Building 3 Chiswick Business Park, Chiswick, London, W4 5YA", "lat": 51.4937, "lng": -0.2786}
        ]

        # Clean query by removing common words
        stop_words = ["can", "i", "know", "all", "quadrant", "technologies", "location", "locations", "address", "office", "loctaion", "ocation"]
        cleaned_query = " ".join(word for word in query.split() if word not in stop_words)

        # Check for multi-location query first
        if any(keyword in query for keyword in ["locations", "where", "all", "offices"]) and "quadrant" in query:
            data_list = []
            for loc in quadrant_locations:
                item = {
                    "city": loc["city"],
                    "address": loc["address"],
                    "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(loc['address'])}",
                    "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={loc['lat']},{loc['lng']}&zoom=15&size=150x112&markers=label:Q|color:purple|{loc['lat']},{loc['lng']}&key={GOOGLE_MAPS_API_KEY}"
                }
                data_list.append(item)
            map_data = {
                "type": "multi_location",
                "data": data_list
            }
            logger.info(f"Multi-location query matched: returning all {len(data_list)} Quadrant Technologies locations")
            return map_data

        # Extract potential city name
        city_query = None
        city_scores = []
        
        # Check for country names
        for country, city in country_to_city.items():
            if country in query:
                city_query = city.lower()
                city_scores.append((city_query, 100))
                break

        # Perform fuzzy matching for single-location queries
        if not city_query and not any(keyword in query for keyword in ["locations", "where", "all", "offices"]):
            for loc in quadrant_locations:
                city_lower = loc["city"].lower()
                score = fuzz.partial_ratio(cleaned_query, city_lower.split(",")[0]) if "," in city_lower else fuzz.partial_ratio(cleaned_query, city_lower)
                city_scores.append((city_lower, score))
            
            # Select the city with the highest score above threshold
            if city_scores:
                best_match = max(city_scores, key=lambda x: x[1])
                if best_match[1] >= 50:  # Lowered to 50
                    city_query = best_match[0]

        # Log fuzzy matching scores
        logger.info(f"Fuzzy matching scores for query '{query}' (cleaned: '{cleaned_query}'): {city_scores}")

        # If no valid city match for single-location query, raise error
        if not city_query and any(keyword in query for keyword in ["quadrant", "location", "address", "office", "loctaion", "ocation", "where"]):
            raise HTTPException(status_code=404, detail=f"No Quadrant Technologies location found for query '{query}'")

        # Find the location for single-location queries
        if city_query:
            location = next((loc for loc in quadrant_locations if loc["city"].lower() == city_query), None)
            if not location:
                location = next((loc for loc in quadrant_locations if loc["city"].split(",")[0].lower() == city_query.split(",")[0].lower()), None)
                if not location:
                    raise HTTPException(status_code=404, detail=f"Quadrant Technologies location not found for {city_query}")

        # Handle nearby searches
        if any(keyword in query for keyword in ["nearby", "near", "pgs", "ladies pg", "gents pg", "ladies pgs", "gents pgs", "restaurants", "pg", "restruants"]):
            if not city_query:
                raise HTTPException(status_code=400, detail="Please specify a valid city for nearby search")
            keyword = "paying guest, hostel" if any(k in query for k in ["pg", "pgs", "ladies pg", "gents pg", "ladies pgs", "gents pgs"]) else "restaurant" if any(k in query for k in ["restaurants", "restruants"]) else None
            if keyword:
                if session_id not in session_storage:
                    session_storage[session_id] = {"previous_places": [], "next_page_token": None}
                
                if "more" in query:
                    session_storage[session_id]["previous_places"] = []
                
                places = gmaps.places_nearby(
                    location={"lat": location["lat"], "lng": location["lng"]},
                    radius=2000,
                    keyword=keyword
                )
                logger.info(f"Places API returned {len(places['results'])} results for keyword '{keyword}' near {location['city']}")
                data_list = []
                seen_place_ids = set(session_storage[session_id]["previous_places"])
                
                for place in places['results'][:10]:
                    place_id = place['place_id']
                    if place_id not in seen_place_ids:
                        place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                        # Map price_level to dollar signs
                        price_level = place.get('price_level')
                        price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                        # Get primary type
                        place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                        item = {
                            "name": place['name'],
                            "address": place.get('vicinity', 'N/A'),
                            "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                            "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}|label:Q|color:purple|{location['lat']},{location['lng']}&key={GOOGLE_MAPS_API_KEY}",
                            "rating": place.get('rating', 'N/A'),
                            "total_reviews": place.get('user_ratings_total', 0),
                            "type": place_type,
                            "price_level": price_level_display
                        }
                        data_list.append(item)
                        seen_place_ids.add(place_id)
                
                next_page_token = places.get('next_page_token')
                if next_page_token and len(data_list) < 10 and "more" in query:
                    logger.info(f"Fetching more results with next_page_token: {next_page_token}")
                    time.sleep(2)
                    more_places = gmaps.places_nearby(
                        location={"lat": location["lat"], "lng": location["lng"]},
                        radius=2000,
                        keyword=keyword,
                        page_token=next_page_token
                    )
                    logger.info(f"Places API returned {len(more_places['results'])} additional results")
                    for place in more_places['results'][:10 - len(data_list)]:
                        place_id = place['place_id']
                        if place_id not in seen_place_ids:
                            place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                            price_level = place.get('price_level')
                            price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                            place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                            item = {
                                "name": place['name'],
                                "address": place.get('vicinity', 'N/A'),
                                "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                                "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}|label:Q|color:purple|{location['lat']},{location['lng']}&key={GOOGLE_MAPS_API_KEY}",
                                "rating": place.get('rating', 'N/A'),
                                "total_reviews": place.get('user_ratings_total', 0),
                                "type": place_type,
                                "price_level": price_level_display
                            }
                            data_list.append(item)
                            seen_place_ids.add(place_id)
                
                session_storage[session_id]["previous_places"] = list(seen_place_ids)
                session_storage[session_id]["next_page_token"] = next_page_token if next_page_token else None
                logger.info(f"Session {session_id} updated: {session_storage[session_id]}")
                
                if not data_list:
                    logger.warning(f"No {keyword} found within 2000m. Trying broader radius (3000m).")
                    places = gmaps.places_nearby(
                        location={"lat": location["lat"], "lng": location["lng"]},
                        radius=3000,
                        keyword=keyword
                    )
                    for place in places['results'][:10]:
                        place_id = place['place_id']
                        if place_id not in seen_place_ids:
                            place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                            price_level = place.get('price_level')
                            price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                            place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                            item = {
                                "name": place['name'],
                                "address": place.get('vicinity', 'N/A'),
                                "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                                "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}|label:Q|color:purple|{location['lat']},{location['lng']}&key={GOOGLE_MAPS_API_KEY}",
                                "rating": place.get('rating', 'N/A'),
                                "total_reviews": place.get('user_ratings_total', 0),
                                "type": place_type,
                                "price_level": price_level_display
                            }
                            data_list.append(item)
                            seen_place_ids.add(place_id)
                    session_storage[session_id]["previous_places"] = list(seen_place_ids)
                
                if not data_list:
                    raise HTTPException(status_code=404, detail=f"No {keyword} found near {location['city']}")
                
                map_data = {
                    "type": "nearby",
                    "data": data_list
                }
            else:
                raise HTTPException(status_code=400, detail="Invalid nearby query. Specify 'PGs' or 'restaurants'.")
        # Handle specific office location queries
        elif city_query and any(keyword in query for keyword in ["quadrant", "location", "address", "office", "loctaion", "ocation"]):
            map_data = {
                "type": "address",
                "city": location["city"],
                "data": location["address"],
                "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(location['address'])}",
                "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={location['lat']},{location['lng']}&zoom=15&size=150x112&markers=label:Q|color:purple|{location['lat']},{location['lng']}&key={GOOGLE_MAPS_API_KEY}"
            }
            logger.info(f"Single location query matched: {location['city']}")
        # Handle directions
        elif "directions to quadrant technologies" in query:
            destination = None
            if city_query:
                destination = next((loc for loc in quadrant_locations if loc["city"].lower() == city_query), None)
            origin = query.split("from")[-1].strip() if "from" in query else None
            if destination or not city_query:
                destination_addr = destination["address"] if destination else "Quadrant Technologies"
                if origin:
                    directions = gmaps.directions(origin, destination_addr, mode="driving")
                    if directions:
                        legs = directions[0]['legs'][0]
                        steps = [re.sub('<[^<]+?>', '', step['html_instructions']) for step in legs['steps']]
                        origin_addr = legs['start_address']
                        dest_addr = legs['end_address']
                        encoded_polyline = directions[0]['overview_polyline']['points']
                        map_url = f"https://www.google.com/maps/dir/?api=1&origin={urllib.parse.quote(origin_addr)}&destination={urllib.parse.quote(dest_addr)}&travelmode=driving"
                        dest_lat = destination['lat'] if destination else legs['end_location']['lat']
                        dest_lng = destination['lng'] if destination else legs['end_location']['lng']
                        static_map_url = f"https://maps.googleapis.com/maps/api/staticmap?size=150x112&path=enc:{urllib.parse.quote(encoded_polyline)}&markers=label:Q|color:purple|{dest_lat},{dest_lng}&key={GOOGLE_MAPS_API_KEY}"
                        map_data = {
                            "type": "directions",
                            "data": steps,
                            "map_url": map_url,
                            "static_map_url": static_map_url
                        }
                    else:
                        raise HTTPException(status_code=404, detail="Directions not found")
                else:
                    raise HTTPException(status_code=400, detail="Please specify an origin for directions")
            else:
                raise HTTPException(status_code=404, detail="Quadrant Technologies location not found")
        else:
            raise HTTPException(status_code=400, detail="Not a map-related query")

        return map_data
    except ApiError as e:
        logger.error(f"Google Maps API error for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Google Maps API error: {str(e)}")
    except Exception as e:
        logger.error(f"Error processing map query for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing map query: {str(e)}")

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(session_id: str, websocket: WebSocket):
    if not is_valid_uuid(session_id):
        await websocket.close(code=1008, reason="Invalid session_id format")
        return
    
    await websocket.accept()  # Explicitly accept the WebSocket connection
    logger.info(f"WebSocket connection accepted for session {session_id}")

    if session_id not in websocket_connections:
        websocket_connections[session_id] = []
    websocket_connections[session_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_json()
            logger.debug(f"Received WebSocket message for session {session_id}: {data}")
            # Handle ping to keep connection alive
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
            else:
                # Handle other message types if needed
                pass
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session {session_id}")
        websocket_connections[session_id].remove(websocket)
        if not websocket_connections[session_id]:
            del websocket_connections[session_id]
    except Exception as e:
        logger.error(f"WebSocket error for session {session_id}: {str(e)}")
        websocket_connections[session_id].remove(websocket)
        if not websocket_connections[session_id]:
            del websocket_connections[session_id]
        await websocket.close(code=1011, reason=str(e))

@app.websocket("/transcribe/{session_id}")
async def transcribe_websocket(session_id: str, websocket: WebSocket):
    if not is_valid_uuid(session_id):
        await websocket.close(code=1008, reason="Invalid session_id format")
        return
    
    await websocket.accept()
    logger.info(f"Transcription WebSocket connection accepted for session {session_id}")

    try:
        stream = await transcribe_client.start_stream_transcription(
            language_code="en-US",
            media_sample_rate_hz=16000,
            media_encoding="pcm"
        )
        handler = MyEventHandler(stream, websocket)

        async def receive_audio():
            try:
                while True:
                    data = await websocket.receive_bytes()
                    await stream.input_stream.send_audio_event(audio_chunk=data)
            except WebSocketDisconnect:
                logger.info(f"Transcription WebSocket disconnected for session {session_id}")
            except Exception as e:
                logger.error(f"Error receiving audio for session {session_id}: {str(e)}")
                await stream.input_stream.end_stream()

        async def process_transcription():
            try:
                await handler.handle_events()
            except Exception as e:
                logger.error(f"Error processing transcription for session {session_id}: {str(e)}")
                await stream.input_stream.end_stream()

        await asyncio.gather(receive_audio(), process_transcription())
    except Exception as e:
        logger.error(f"Transcription WebSocket error for session {session_id}: {str(e)}")
        await websocket.close(code=1011, reason=str(e))
    finally:
        await websocket.close(code=1000, reason="Transcription completed")