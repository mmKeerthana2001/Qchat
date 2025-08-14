# context_manager.py
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
from agent import Agent

# Set up logging
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

    async def create_session(self, session_id: str):
        """
        Create a new empty session in MongoDB and Qdrant.

        Parameters:
        ---------
        session_id: Unique session ID.

        """
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]

            session_data = {
                "session_id": session_id,
                "extracted_text": {},
                "chat_history": [],
                "created_at": time.time()
            }
            await doc_collection.insert_one(session_data)
            logger.info(f"Created new session in MongoDB: {session_id}")

            qdrant_collection = f"docs_{session_id}"
            await self.qdrant_client.recreate_collection(
                collection_name=qdrant_collection,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )
            logger.info(f"Created Qdrant collection for session {session_id}")
        except Exception as e:
            logger.error(f"Error creating session {session_id}: {str(e)}")
            raise

    def chunk_text(self, text: str, max_chunk_size: int = 500) -> List[str]:
        """
        Split text into chunks by newlines with max word limit, or return a single empty chunk.

        Parameters:
        ---------
        text: Input text to chunk.
        max_chunk_size: Maximum number of words per chunk.

        Returns:
        -------
        List[str]: List of text chunks, or [""] if text is empty.
        """
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
        """
        Store or update extracted text in MongoDB and embeddings in Qdrant for an existing session.

        Parameters:
        ---------
        session_id: Unique session ID.
        extracted_text: Dictionary mapping filenames to extracted text (can be empty).
        """
        try:
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]

            # Update extracted text in MongoDB
            await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"extracted_text": extracted_text, "updated_at": time.time()}}
            )
            logger.info(f"Stored/updated extracted text in MongoDB for session: {session_id}")

            qdrant_collection = f"docs_{session_id}"

            # Batch generate embeddings
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

    async def process_query(self, session_id: str, query: str) -> Tuple[str, List[Dict[str, str]]]:
        """
        Process a user query by retrieving relevant context from MongoDB and Qdrant.

        Parameters:
        ---------
        session_id: Unique session ID.
        query: Current user query.

        Returns:
        -------
        tuple: (LLM response, updated chat history)
        """
        try:
            # Retrieve session data from MongoDB
            collection_name = f"sessions_{session_id}"
            doc_collection = self.db[collection_name]
            session_data = await doc_collection.find_one({"session_id": session_id})
            if not session_data:
                raise ValueError(f"Session {session_id} not found")

            # Get chat history (last 10 messages)
            history = session_data.get("chat_history", [])[-10:]

            # Generate query embedding
            query_embedding = self.embedder.encode(query, convert_to_numpy=True).tolist()

            # Search Qdrant for relevant document chunks
            qdrant_collection = f"docs_{session_id}"
            search_result = await self.qdrant_client.search(
                collection_name=qdrant_collection,
                query_vector=query_embedding,
                limit=5  # Retrieve top 5 relevant chunks
            )

            # Combine relevant document chunks
            documents = "\n\n".join(
                f"File: {hit.payload['filename']}\nChunk: {hit.payload['chunk']}"
                for hit in search_result
            )
            logger.info(f"Retrieved {len(search_result)} relevant chunks for session {session_id}")

            # Initialize Agent for LLM query
            agent = Agent()
            response = await agent.process_query(documents, history, query)

            # Update chat history in MongoDB
            history.append({"query": query, "response": response})
            await doc_collection.update_one(
                {"session_id": session_id},
                {"$set": {"chat_history": history[-10:], "updated_at": time.time()}}
            )
            logger.info(f"Updated chat history for session {session_id}")

            return response, history

        except Exception as e:
            logger.error(f"Error processing query for session {session_id}: {str(e)}")
            raise

    async def clear_session(self, session_id: str):
        """
        Clear session data from MongoDB and Qdrant.

        Parameters:
        ---------
        session_id: Session ID to clear.
        """
        try:
            # Delete MongoDB collection
            collection_name = f"sessions_{session_id}"
            self.db.drop_collection(collection_name)
            logger.info(f"Cleared MongoDB collection for session {session_id}")

            # Delete Qdrant collection
            qdrant_collection = f"docs_{session_id}"
            self.qdrant_client.delete_collection(qdrant_collection)
            logger.info(f"Cleared Qdrant collection for session {session_id}")
        except Exception as e:
            logger.error(f"Error clearing session {session_id}: {e}")