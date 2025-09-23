
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
import traceback
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
import requests

import math
 
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

# Updated main.py endpoint
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
 
        agent_instance = Agent()
        intent_data = await agent_instance.classify_intent_and_extract(query_corrected, history, query_req.role)

        is_map_query = intent_data.get("is_map", False)
        map_data = None
        media_data = None
        if is_map_query:
            logger.info(f"Routing query '{query_corrected}' as map-related (is_map: {is_map_query}) with intent_data: {intent_data}")
            try:
                map_data = await handle_map_query(session_id, QueryRequest(
                    query=query_corrected,
                    role=query_req.role,
                    voice_mode=query_req.voice_mode
                ), intent_data)
                response, history = await context_manager.process_map_query(session_id, query_corrected, query_req.role, map_data, intent_data)
            except Exception as e:
                logger.error(f"Map query failed for session {session_id}: {str(e)}")
                logger.error(f"Full traceback: {traceback.format_exc()}")
                logger.error(f"Intent data: {intent_data}, Query: {query_corrected}")
                response = f"Sorry, I couldn't process the location request for '{query_corrected}'. Please rephrase."
                history.append({
                    "role": query_req.role,
                    "query": query_corrected,
                    "response": response,
                    "timestamp": time.time(),
                    "intent_data": intent_data,
                    "map_data": None
                })
                collection_name = f"sessions_{session_id}"
                await context_manager.db[collection_name].update_one(
                    {"session_id": session_id},
                    {"$set": {"chat_history": history[-10:], "updated_at": time.time()}}
                )
                logger.warning(f"Fallback response stored for map query failure in session {session_id}")
        else:
            logger.info(f"Routing query '{query_corrected}' as non-map (is_map: {is_map_query}) with intent_data: {intent_data}")
            session_data = await context_manager.get_session(session_id)
            if not session_data.get("extracted_text") and intent_data.get("intent") == "document":
                response = "No documents available to answer your query. Please upload relevant documents or ask a location-based question."
                history.append({
                    "role": query_req.role,
                    "query": query_corrected,
                    "response": response,
                    "timestamp": time.time(),
                    "intent_data": intent_data
                })
                await context_manager.store_session_data(session_id, {"extracted_text": {}})
            else:
                response, media_data, history = await context_manager.process_query(session_id, query_corrected, query_req.role, intent_data=intent_data)
                logger.debug(f"Non-map query processed, media_data: {media_data}")
       
        if session_id in websocket_connections:
            for ws in websocket_connections[session_id]:
                try:
                    await ws.send_json({
                        "role": query_req.role,
                        "content": query_req.query,
                        "timestamp": time.time()
                    })
                    ws_response = {
                        "role": "assistant",
                        "content": response,
                        "timestamp": time.time(),
                    }
                    if is_map_query:
                        ws_response["map_data"] = map_data
                    else:
                        ws_response["media_data"] = media_data
                    logger.debug(f"Sending WebSocket response: {ws_response}")
                    await ws.send_json(ws_response)
                except Exception as e:
                    logger.error(f"WebSocket error for session {session_id}: {str(e)}")
                    websocket_connections[session_id].remove(ws)
 
        response_data = {
            "response": response,
            "history": history
        }
        if not is_map_query and media_data:
            response_data["media_data"] = media_data
            logger.debug(f"Including media_data in HTTP response: {media_data}")
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


country_to_city = {
    "malaysia": "Kuala Lumpur, Malaysia",
    "australia": "Lane Cove, Australia",
    "uk": "Chiswick, UK",
    "mexico": "Guadalajara, Mexico",
    "canada": "Surrey, Canada",
    "uae": "Dubai, UAE"
}
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
 



@app.post("/map-query/{session_id}")
async def handle_map_query(session_id: str, query_req: QueryRequest, intent_data: dict = None):
    try:
        if not gmaps:
            raise HTTPException(status_code=500, detail="Google Maps API key not configured")
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")

        map_data = {}
        intent = intent_data.get("intent", "non_map") if intent_data else "non_map"
        
        # Safe extraction for city_query
        city_value = intent_data.get("city") if intent_data else None
        city_query = city_value.lower() if isinstance(city_value, str) else ""
        
        # Safe extraction for nearby_type
        nearby_value = intent_data.get("nearby_type") if intent_data else None
        nearby_type = nearby_value.lower() if isinstance(nearby_value, str) else ""
        
        # Safe extraction for origin and destination
        origin_value = intent_data.get("origin") if intent_data else None
        origin = origin_value.strip() if isinstance(origin_value, str) else ""
        destination_value = intent_data.get("destination") if intent_data else None
        destination = destination_value.strip() if isinstance(destination_value, str) else ""
        
        logger.info(f"Extracted params: intent={intent}, city_query='{city_query}', nearby_type='{nearby_type}', origin='{origin}', destination='{destination}'")

        # Find location based on extracted city (for single_location, nearby, or directions)
        location = None
        if city_query:
            location = next((loc for loc in quadrant_locations if loc["city"].lower() == city_query), None)
            if not location:
                # Fallback fuzzy match if exact fails
                for loc in quadrant_locations:
                    score = fuzz.partial_ratio(city_query, loc["city"].lower())
                    if score >= 80:
                        location = loc
                        break
                if not location:
                    raise HTTPException(status_code=404, detail=f"Quadrant Technologies location not found for {city_query}")

        if intent == "single_location":
            if not location:
                raise HTTPException(status_code=400, detail="Please specify a valid city for location query")
            
            # Generate map URLs for the single location
            map_url = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(location['address'])}"
            static_map_url = f"https://maps.googleapis.com/maps/api/staticmap?center={location['lat']},{location['lng']}&zoom=15&size=600x300&markers=color:purple|label:Q|{location['lat']},{location['lng']}&key={GOOGLE_MAPS_API_KEY}"
            
            map_data = {
                "type": "address",
                "data": location["address"],
                "city": location["city"],
                "map_url": map_url,
                "static_map_url": static_map_url
            }

        elif intent == "multi_location":
            # Generate data for all Quadrant Technologies locations
            locations_data = []
            for loc in quadrant_locations:
                map_url = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(loc['address'])}"
                static_map_url = f"https://maps.googleapis.com/maps/api/staticmap?center={loc['lat']},{loc['lng']}&zoom=15&size=600x300&markers=color:purple|label:Q|{loc['lat']},{loc['lng']}&key={GOOGLE_MAPS_API_KEY}"
                locations_data.append({
                    "city": loc["city"],
                    "address": loc["address"],
                    "map_url": map_url,
                    "static_map_url": static_map_url
                })
            
            map_data = {
                "type": "multi_location",
                "data": locations_data,
                "map_url": "https://www.google.com/maps/search/?api=1&query=Quadrant%20Technologies",
                "static_map_url": None
            }

        elif intent == "nearby":
            if not location:
                raise HTTPException(status_code=400, detail="Please specify a city for nearby search")

            # Normalize nearby_type for better search
            keyword = nearby_type or "nearby amenities"

            logger.info(f"Using keyword for Places API: '{keyword}'")

            if session_id not in session_storage:
                session_storage[session_id] = {"previous_places": [], "next_page_token": None}

            if "more" in query_req.query.lower() if query_req and query_req.query else False:
                session_storage[session_id]["previous_places"] = []

            # Initialize coordinates list with source Quadrant location
            coordinates = [{
                "lat": location["lat"],
                "lng": location["lng"],
                "label": location["address"],
                "color": "purple"
            }]

            # Initial search with specific keyword
            places = gmaps.places_nearby(
                location={"lat": location["lat"], "lng": location["lng"]},
                radius=2000,
                keyword=keyword
            )
            logger.info(f"Places API returned {len(places['results'])} results for keyword '{keyword}' near {location['city']}")
            data_list = []
            seen_place_ids = set(session_storage[session_id]["previous_places"])

            # Build markers for unified map URL
            markers = [f"color:purple|label:Q|{location['lat']},{location['lng']}"]
            for place in places['results'][:10]:
                place_id = place['place_id']
                place_name = place['name'].lower()
                if place_id not in seen_place_ids:
                    place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                    price_level = place.get('price_level')
                    price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                    place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                    item = {
                        "name": place['name'],
                        "address": place.get('vicinity', 'N/A'),
                        "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                        "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}&key={GOOGLE_MAPS_API_KEY}",
                        "rating": place.get('rating', 'N/A'),
                        "total_reviews": place.get('user_ratings_total', 0),
                        "type": place_type,
                        "price_level": price_level_display
                    }
                    data_list.append(item)
                    coordinates.append({
                        "lat": place_lat,
                        "lng": place_lng,
                        "label": place.get('vicinity', place['name'])
                    })
                    markers.append(f"color:red|{place_lat},{place_lng}")
                    seen_place_ids.add(place_id)

            # Handle pagination for "more" queries
            next_page_token = places.get('next_page_token')
            if next_page_token and len(data_list) < 10 and "more" in query_req.query.lower() if query_req and query_req.query else False:
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
                    place_name = place['name'].lower()
                    if place_id not in seen_place_ids:
                        place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                        price_level = place.get('price_level')
                        price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                        place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                        item = {
                            "name": place['name'],
                            "address": place.get('vicinity', 'N/A'),
                            "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                            "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}&key={GOOGLE_MAPS_API_KEY}",
                            "rating": place.get('rating', 'N/A'),
                            "total_reviews": place.get('user_ratings_total', 0),
                            "type": place_type,
                            "price_level": price_level_display
                        }
                        data_list.append(item)
                        coordinates.append({
                            "lat": place_lat,
                            "lng": place_lng,
                            "label": place.get('vicinity', place['name'])
                        })
                        markers.append(f"color:red|{place_lat},{place_lng}")
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
                    place_name = place['name'].lower()
                    if place_id not in seen_place_ids:
                        place_lat, place_lng = place['geometry']['location']['lat'], place['geometry']['location']['lng']
                        price_level = place.get('price_level')
                        price_level_display = ''.join(['$'] * price_level) if price_level is not None else 'N/A'
                        place_type = place.get('types', [])[0].replace('_', ' ').title() if place.get('types') else 'N/A'
                        item = {
                            "name": place['name'],
                            "address": place.get('vicinity', 'N/A'),
                            "map_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(place.get('vicinity', place['name']))}",
                            "static_map_url": f"https://maps.googleapis.com/maps/api/staticmap?center={place_lat},{place_lng}&zoom=15&size=150x112&markers=color:red|{place_lat},{place_lng}&key={GOOGLE_MAPS_API_KEY}",
                            "rating": place.get('rating', 'N/A'),
                            "total_reviews": place.get('user_ratings_total', 0),
                            "type": place_type,
                            "price_level": price_level_display
                        }
                        data_list.append(item)
                        coordinates.append({
                            "lat": place_lat,
                            "lng": place_lng,
                            "label": place.get('vicinity', place['name'])
                        })
                        markers.append(f"color:red|{place_lat},{place_lng}")
                        seen_place_ids.add(place_id)
                session_storage[session_id]["previous_places"] = list(seen_place_ids)

            if not data_list:
                raise HTTPException(status_code=404, detail=f"No {keyword} found near {location['city']}")

            # Calculate center for unified map
            all_lats = [location["lat"]] + [place["lat"] for place in coordinates[1:]]
            all_lngs = [location["lng"]] + [place["lng"] for place in coordinates[1:]]
            center_lat = sum(all_lats) / len(all_lats)
            center_lng = sum(all_lngs) / len(all_lngs)
            
            # Generate unified map URL
            unified_map_url = f"https://www.google.com/maps/search/?api=1&query={center_lat},{center_lng}&zoom=13"
            
            # Generate unified static map URL for preview
            unified_static_map_url = (
                f"https://maps.googleapis.com/maps/api/staticmap?center={center_lat},{center_lng}"
                f"&zoom=13&size=600x300&markers={'|'.join(markers)}&key={GOOGLE_MAPS_API_KEY}"
            )

            map_data = {
                "type": "nearby",
                "data": data_list,
                "coordinates": coordinates,
                "map_url": unified_map_url,
                "static_map_url": unified_static_map_url
            }

        elif intent == "directions":
            if not location and not city_query:
                raise HTTPException(status_code=400, detail="Please specify a destination city for directions")
            source = location or next((loc for loc in quadrant_locations if loc["city"].lower() == city_query), None)
            if not source:
                raise HTTPException(status_code=404, detail="Source Quadrant location not found")
            source_addr = source["address"]

            # Existing directions logic for step-by-step navigation (when origin is provided)
            if origin:
                directions = gmaps.directions(origin, source_addr, mode="driving")
                if directions:
                    legs = directions[0]['legs'][0]
                    steps = [re.sub('<[^<]+?>', '', step['html_instructions']) for step in legs['steps']]
                    origin_addr = legs['start_address']
                    dest_addr = legs['end_address']
                    encoded_polyline = directions[0]['overview_polyline']['points']
                    map_url = f"https://www.google.com/maps/dir/?api=1&origin={urllib.parse.quote(origin_addr)}&destination={urllib.parse.quote(dest_addr)}&travelmode=driving"
                    static_map_url = f"https://maps.googleapis.com/maps/api/staticmap?size=150x112&path=enc:{urllib.parse.quote(encoded_polyline)}&markers=label:Q|color:purple|{source['lat']},{source['lng']}&key={GOOGLE_MAPS_API_KEY}"
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

        elif intent == "distance":
            if not location and not city_query:
                raise HTTPException(status_code=400, detail="Please specify a city for distance query")
            source = location or next((loc for loc in quadrant_locations if loc["city"].lower() == city_query), None)
            if not source:
                raise HTTPException(status_code=404, detail="Source Quadrant location not found")
            source_addr = source["address"]

            if not destination:
                raise HTTPException(status_code=400, detail="Please specify a destination for distance query")

            from agent import Agent  # Import Agent class to generate LLM response
            agent = Agent()  # Initialize Agent (ensure proper initialization with client)

            # Resolve destination address using Places API (New)
            places_url = "https://places.googleapis.com/v1/places:searchText"
            headers = {
                "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location"
            }
            payload = {
                "textQuery": f"{destination} near {source['city']}",
                "locationBias": {
                    "circle": {
                        "center": {"latitude": source["lat"], "longitude": source["lng"]},
                        "radius": 50000  # 50km radius
                    }
                }
            }
            try:
                places_response = requests.post(places_url, json=payload, headers=headers, timeout=10)
                logger.debug(f"Places API request payload: {payload}")
                logger.debug(f"Places API response: {places_response.text}")
                places_response.raise_for_status()
                places_data = places_response.json()
                
                if not places_data.get("places"):
                    raise HTTPException(status_code=404, detail=f"Could not find a precise location for {destination} near {source['city']}")
                
                place = places_data["places"][0]
                place_id = place.get("id")
                dest_name = place.get("displayName", {}).get("text", destination)
                dest_addr = place.get("formattedAddress", dest_name)
                dest_lat = place.get("location", {}).get("latitude")
                dest_lng = place.get("location", {}).get("longitude")

                # Validate distance to avoid false positives (e.g., wrong state)
                if dest_lat and dest_lng:
                    from math import radians, sin, cos, sqrt, atan2
                    def haversine_distance(lat1, lon1, lat2, lon2):
                        R = 6371  # Earth's radius in km
                        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
                        dlat = lat2 - lat1
                        dlon = lon2 - lon1
                        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
                        c = 2 * atan2(sqrt(a), sqrt(1-a))
                        return R * c
                    approx_distance = haversine_distance(source["lat"], source["lng"], dest_lat, dest_lng)
                    if approx_distance > 100:  # Reject if >100 km
                        logger.warning(f"Places API returned a location too far away: {dest_addr} ({approx_distance:.1f} km)")
                        raise HTTPException(status_code=404, detail=f"Found {dest_name} at {dest_addr}, but it's too far from {source['city']}. Please clarify the destination.")

            except requests.RequestException as e:
                logger.error(f"Places API error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Google Maps Places API error: {str(e)}")

            # Call Google Maps Routes API with placeId or address
            routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
            headers = {
                "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
            }
            payload = {
                "origin": {"address": source_addr},
                "destination": {"placeId": place_id} if place_id else {"address": dest_name},
                "travelMode": "DRIVE",
                "computeAlternativeRoutes": False,
                "units": "METRIC"
            }
            try:
                response = requests.post(routes_url, json=payload, headers=headers, timeout=10)
                logger.debug(f"Routes API request payload: {payload}")
                logger.debug(f"Routes API response: {response.text}")
                response.raise_for_status()
                route_data = response.json()
                
                if route_data.get("routes"):
                    distance_meters = route_data["routes"][0]["distanceMeters"]
                    duration_seconds = route_data["routes"][0]["duration"]
                    # Convert distance to kilometers
                    distance = f"{distance_meters / 1000:.1f} km"
                    # Convert duration to human-readable format
                    duration_seconds = int(duration_seconds.rstrip("s"))
                    duration = f"{duration_seconds // 60} mins" if duration_seconds < 3600 else f"{duration_seconds // 3600} hr {(duration_seconds % 3600) // 60} mins"
                    origin_addr = source_addr
                    
                    # Generate map URLs (use resolved address for map link)
                    map_url = f"https://www.google.com/maps/dir/?api=1&origin={urllib.parse.quote(origin_addr)}&destination={urllib.parse.quote(dest_addr)}&travelmode=driving"
                    static_map_url = f"https://maps.googleapis.com/maps/api/staticmap?center={source['lat']},{source['lng']}&zoom=13&size=150x112&markers=label:Q|color:purple|{source['lat']},{source['lng']}&key={GOOGLE_MAPS_API_KEY}"
                    
                    # Generate LLM response
                    map_data_temp = {
                        "type": "distance",
                        "data": {
                            "origin": origin_addr,
                            "destination": dest_name,
                            "distance": distance,
                            "duration": duration
                        }
                    }
                    llm_response = await agent.process_map_query(map_data_temp, query_req.query, role="candidate")
                    
                    map_data = {
                        "type": "distance",
                        "data": {
                            "origin": origin_addr,
                            "destination": dest_name,
                            "distance": distance,
                            "duration": duration
                        },
                        "llm_response": llm_response,
                        "map_url": map_url,
                        "static_map_url": static_map_url,
                        "coordinates": [
                            {"lat": source["lat"], "lng": source["lng"], "label": "Origin", "color": "purple"},
                            {"lat": dest_lat, "lng": dest_lng, "label": dest_name, "color": "red"}
                        ]
                    }
                else:
                    raise HTTPException(status_code=404, detail=f"No route found to {dest_name}")
            except requests.RequestException as e:
                logger.error(f"Routes API error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Google Maps Routes API error: {str(e)}")

        else:
            raise HTTPException(status_code=400, detail="Invalid map intent")

        return map_data
    except ApiError as e:
        logger.error(f"Google Maps API error for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Google Maps API error: {str(e)}")
    except Exception as e:
        logger.error(f"Error processing map query for session {session_id}: {str(e)}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
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