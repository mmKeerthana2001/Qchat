
import uuid
import asyncio
import logging
from typing import Dict, List, Tuple
from motor.motor_asyncio import AsyncIOMotorClient
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
import os
import time
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from agent import Agent

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("pymongo").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

class ContextManager:
    def __init__(self):
        mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        self.mongo_client = AsyncIOMotorClient(mongodb_uri)
        self.db = self.mongo_client["document_analysis"]
        qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
        self.qdrant_client = AsyncQdrantClient(qdrant_url)
        self.embedder = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("ContextManager initialized with MongoDB and Qdrant")

    async def create_session(self, session_id: str, candidate_name: str, candidate_email: str, share_token: str):
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]

            session_data = {
                "session_id": session_id,
                "candidate_name": candidate_name or "Unknown",
                "candidate_email": candidate_email or "Unknown",
                "share_token": share_token,
                "extracted_text": {},
                "chat_history": [],
                "initial_message_sent": False,
                "created_at": time.time()
            }
            await doc_collection.insert_one(session_data)
            logger.info(f"Created new session in MongoDB: {session_id} for {candidate_name}")

            qdrant_collection = f"docs_{session_id}"
            await self.qdrant_client.recreate_collection(
                collection_name=qdrant_collection,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )
            logger.info(f"Created Qdrant collection for session {session_id}")
        except Exception as e:
            logger.error(f"Error creating session {session_id}: {str(e)}")
            raise

    async def add_initial_message(self, session_id: str, message: str):
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]
            session_data = await doc_collection.find_one({"session_id": session_id})
            if not session_data:
                logger.error(f"Session {session_id} not found")
                raise ValueError(f"Session {session_id} not found")

            history = session_data.get("chat_history", [])
            history.append({"role": "hr", "query": message, "response": "", "timestamp": time.time()})

            result = await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"chat_history": history, "initial_message_sent": True, "updated_at": time.time()}}
            )
            if result.modified_count == 0:
                logger.warning(f"No documents updated for session {session_id}")
            logger.info(f"Added initial message to session {session_id} and set flag")
        except Exception as e:
            logger.error(f"Error adding initial message for {session_id}: {str(e)}")
            raise

    async def get_session(self, session_id: str):
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]
            session = await doc_collection.find_one({"session_id": session_id})
            if not session:
                logger.error(f"Session {session_id} not found")
            return session
        except Exception as e:
            logger.error(f"Error fetching session {session_id}: {str(e)}")
            raise

    async def list_sessions(self):
        try:
            collections = await self.db.list_collection_names()
            session_collections = [coll for coll in collections if coll.startswith("sessions_")]
            sessions = []
            for collection_name in session_collections:
                doc_collection = self.db[collection_name]
                session = await doc_collection.find_one()
                if session:
                    try:
                        sessions.append({
                            "session_id": session.get("session_id", "Unknown"),
                            "candidate_name": session.get("candidate_name", "Unknown"),
                            "candidate_email": session.get("candidate_email", "Unknown"),
                            "created_at": session.get("created_at", time.time()),
                            "chat_history": session.get("chat_history", []),
                            "initial_message_sent": session.get("initial_message_sent", False)
                        })
                    except KeyError as e:
                        logger.error(f"Missing key {e} in session {collection_name}")
                        continue
            logger.info(f"Retrieved {len(sessions)} sessions from MongoDB")
            return sessions
        except Exception as e:
            logger.error(f"Error listing sessions: {str(e)}")
            raise

    async def validate_token(self, token: str) -> str:
        try:
            collections = await self.db.list_collection_names()
            session_collections = [coll for coll in collections if coll.startswith("sessions_")]
            
            for collection_name in session_collections:
                doc_collection = self.db[collection_name]
                session = await doc_collection.find_one({"share_token": token})
                if session:
                    logger.info(f"Found session with token {token} in collection {collection_name}")
                    return session["session_id"]
            
            logger.warning(f"No session found with token {token}")
            return None
        except Exception as e:
            logger.error(f"Error validating token {token}: {str(e)}")
            raise

    def chunk_text(self, text: str, max_chunk_size: int = 500) -> List[str]:
        try:
            if not text.strip():
                logger.debug("Empty text provided, returning single empty chunk")
                return [""]
            lines = text.split("\n")
            lines = [line.strip() for line in lines if line.strip()]
            chunks = []
            current_chunk = []
            current_words = 0
            for line in lines:
                word_count = len(line.split())
                if current_words + word_count <= max_chunk_size:
                    current_chunk.append(line)
                    current_words += word_count
                else:
                    if current_chunk:
                        chunks.append("\n".join(current_chunk))
                    current_chunk = [line]
                    current_words = word_count
            if current_chunk:
                chunks.append("\n".join(current_chunk))
            logger.info(f"Created {len(chunks)} chunks from text")
            return chunks
        except Exception as e:
            logger.error(f"Error chunking text: {e}")
            raise

    async def store_session_data(self, session_id: str, extracted_text: Dict[str, str]):
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]

            await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"extracted_text": extracted_text, "updated_at": time.time()}}
            )
            logger.info(f"Stored/updated extracted text in MongoDB for session: {session_id}")

            qdrant_collection = f"docs_{session_id}"
            points = []
            point_id = 1
            all_chunks = []
            chunk_metadata = []
            for filename, text in extracted_text.items():
                chunks = self.chunk_text(text)
                all_chunks.extend(chunks)
                chunk_metadata.extend([(filename, chunk) for chunk in chunks])

            if all_chunks and any(chunk.strip() for chunk in all_chunks):
                embeddings = self.embedder.encode(
                    [chunk for chunk in all_chunks if chunk.strip()],
                    batch_size=32,
                    convert_to_numpy=True
                )
                embedding_index = 0
                for (filename, chunk) in chunk_metadata:
                    if chunk.strip():
                        points.append(PointStruct(
                            id=point_id,
                            vector=embeddings[embedding_index].tolist(),
                            payload={"filename": filename, "chunk": chunk, "session_id": session_id}
                        ))
                        embedding_index += 1
                    else:
                        points.append(PointStruct(
                            id=point_id,
                            vector=[0.0] * 384,
                            payload={"filename": filename, "chunk": "", "session_id": session_id}
                        ))
                    point_id += 1
            else:
                logger.info(f"No non-empty chunks to embed for session {session_id}, storing empty data")
                for filename in extracted_text.keys():
                    points.append(PointStruct(
                        id=point_id,
                        vector=[0.0] * 384,
                        payload={"filename": filename, "chunk": "", "session_id": session_id}
                    ))
                    point_id += 1

            if points:
                await self.qdrant_client.upsert(collection_name=qdrant_collection, points=points)
                logger.info(f"Stored {len(points)} embeddings in Qdrant for session {session_id}")

        except Exception as e:
            logger.error(f"Error storing session data for {session_id}: {str(e)}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type(Exception),
        before_sleep=lambda retry_state: logger.warning(
            f"Retrying process_query for session {retry_state.args[0]} due to {retry_state.outcome.exception()}"
        )
    )
    async def process_query(self, session_id: str, query: str, role: str) -> Tuple[str, List[Dict[str, str]]]:
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]
            session_data = await doc_collection.find_one({"session_id": session_id})
            if not session_data:
                raise ValueError(f"Session {session_id} not found")

            history = session_data.get("chat_history", [])[-10:]
            query_embedding = self.embedder.encode(query, convert_to_numpy=True).tolist()

            qdrant_collection = f"docs_{session_id}"
            search_result = await self.qdrant_client.search(
                collection_name=qdrant_collection,
                query_vector=query_embedding,
                limit=5
            )

            documents = "\n\n".join(
                f"File: {hit.payload['filename']}\nChunk: {hit.payload['chunk']}"
                for hit in search_result
            )
            logger.info(f"Retrieved {len(search_result)} relevant chunks for session {session_id}")

            agent = Agent()
            try:
                response = await asyncio.wait_for(
                    agent.process_query(documents, history, query, role),
                    timeout=30.0
                )
            except asyncio.TimeoutError:
                logger.error(f"Timeout while processing query for session {session_id}")
                raise Exception("Agent processing timed out")
            except Exception as e:
                logger.error(f"Agent processing error for session {session_id}: {str(e)}")
                raise

            history.append({"role": role, "query": query, "response": response, "timestamp": time.time()})
            await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"chat_history": history[-10:], "updated_at": time.time()}}
            )
            logger.info(f"Updated chat history for session {session_id}")

            return response, history

        except Exception as e:
            logger.error(f"Error processing query for session {session_id}: {str(e)}")
            raise

    async def process_map_query(self, session_id: str, query: str, role: str, map_data: Dict) -> Tuple[str, List[Dict]]:
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]
            session_data = await doc_collection.find_one({"session_id": session_id})
            if not session_data:
                raise ValueError(f"Session {session_id} not found")

            history = session_data.get("chat_history", [])[-10:]

            agent = Agent()
            response = await agent.process_map_query(map_data, query, role)

            history.append({
                "role": role,
                "query": query,
                "response": response,
                "timestamp": time.time(),
                "map_data": map_data
            })
            await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"chat_history": history[-10:], "updated_at": time.time()}}
            )
            logger.info(f"Updated chat history with map query for session {session_id}")

            return response, history

        except Exception as e:
            logger.error(f"Error processing map query for session {session_id}: {str(e)}")
            raise

    async def clear_session(self, session_id: str):
        try:
            collection_name = f"sessions_{session_id}"
            self.db.drop_collection(collection_name)
            logger.info(f"Cleared MongoDB collection for session {session_id}")

            qdrant_collection = f"docs_{session_id}"
            self.qdrant_client.delete_collection(qdrant_collection)
            logger.info(f"Cleared Qdrant collection for session {session_id}")
        except Exception as e:
            logger.error(f"Error clearing session {session_id}: {e}")
