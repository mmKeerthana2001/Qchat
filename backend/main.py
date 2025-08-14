import os
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from read_files import ReadFiles
from context_manager import ContextManager
import logging
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
import time
from pydantic import BaseModel
import io
import uuid
import re

# Middleware to log raw request body for debugging
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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],  # Allow frontend origin
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allow all headers
)

# Initialize ReadFiles and ContextManager
file_reader = ReadFiles()
context_manager = ContextManager()

# Set up logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("python_multipart").setLevel(logging.WARNING)  # Suppress python_multipart DEBUG logs
logger = logging.getLogger(__name__)

class QueryRequest(BaseModel):
    query: str

def is_valid_uuid(value: str) -> bool:
    """
    Validate if the provided string is a valid UUID.
    """
    uuid_pattern = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )
    return bool(uuid_pattern.match(value))

@app.post("/create-session/")
async def create_session():
    """
    FastAPI endpoint to create a new session ID for a chat.
    
    Returns:
    -------
    dict: Dictionary with the new session_id.
    """
    try:
        start_time = time.time()
        session_id = str(uuid.uuid4())
        await context_manager.create_session(session_id)
        logger.info(f"Created new session: {session_id}")
        logger.info(f"Session creation time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content={"session_id": session_id})
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating session: {str(e)}")

@app.post("/extract-text/{session_id}")
async def extract_text_from_files(session_id: str, files: List[UploadFile] = File(...)):
    """
    FastAPI endpoint to extract text from multiple PDF or DOC/DOCX files (text-only) using a provided session_id.
    Processes files in memory and stores in MongoDB/Qdrant under the given session.
    
    Parameters:
    ---------
    session_id: Unique session ID as a path parameter.
    files: List of uploaded files (PDF, DOC, or DOCX).

    Returns:
    -------
    dict: Dictionary with session_id and extracted text mapping filenames to their content.
    """
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
        
        for filename, text in extracted_text.items():
            print(f"\nExtracted text from {filename} ({len(text)} characters):")
            print(f"{text[:200]}{'...' if len(text) > 200 else ''}\n")
        
        logger.info(f"Total processing time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content={"session_id": session_id, "extracted_text": extracted_text})
    
    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error processing files for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@app.post("/chat/{session_id}")
async def chat_with_documents(session_id: str, query_req: QueryRequest):
    """
    FastAPI endpoint to process user queries against stored text and conversation history.
    Session ID is provided as a path parameter.

    Parameters:
    ---------
    session_id: Unique session ID as a path parameter.
    query_req: QueryRequest object with query.

    Returns:
    -------
    dict: Response containing the LLM's answer and updated conversation history.
    """
    try:
        if not is_valid_uuid(session_id):
            raise HTTPException(status_code=400, detail="Invalid session_id format. Must be a valid UUID.")
        
        start_time = time.time()
        logger.info(f"Received chat query for session {session_id}: {query_req.query}")

        response, history = await context_manager.process_query(session_id, query_req.query)

        logger.info(f"Chat processing time: {time.time() - start_time:.2f} seconds")
        return JSONResponse(content={"response": response, "history": history})

    except HTTPException as e:
        logger.error(f"HTTP error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"Error processing chat query for session {session_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing chat query: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)