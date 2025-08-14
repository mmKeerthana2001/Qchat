import asyncio
import logging
from openai import AsyncOpenAI
from typing import Tuple
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class Agent:
    """
    Class to handle LLM interactions using OpenAI's API.
    """
    def __init__(self):
        # Load OpenAI API key
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY not found in .env file")
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        # Initialize OpenAI client
        self.client = AsyncOpenAI(api_key=api_key)
        logger.info("OpenAI client initialized successfully")

    async def process_query(self, documents: str, history: list, query: str) -> str:
        """
        Process a user query using OpenAI's LLM with provided documents and history.

        Parameters:
        ---------
        documents: Combined text from relevant document chunks.
        history: List of previous queries and responses.
        query: Current user query.

        Returns:
        -------
        str: LLM response.
        """
        try:
            # Prepare prompt with document context and chat history
            prompt = (
                "You are an expert assistant analyzing job descriptions and resumes, designed to maintain conversation context like a chat application. "
                "Below is the extracted text from relevant document sections and the conversation history. "
                "Answer the user's query based on the document content and prior conversation. "
                "Provide a concise and accurate response. If the query cannot be answered based on the provided text or history, say so clearly. "
                "Support follow-up questions and topic switches while maintaining context.\n\n"
                f"Documents:\n{documents}\n\n"
                "Conversation History:\n"
            )
            for msg in history:
                prompt += f"User: {msg['query']}\nAssistant: {msg['response']}\n"
            prompt += f"\nUser Query: {query}"

            # Query OpenAI API
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for analyzing documents with context retention."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=500,
                temperature=0.7
            )

            answer = response.choices[0].message.content.strip()
            logger.info(f"LLM response: {answer[:100]}...")
            return answer

        except Exception as e:
            logger.error(f"Error processing query: {e}")
            raise