import asyncio
import logging
from openai import AsyncOpenAI
from typing import Tuple
from dotenv import load_dotenv
import os
from rapidfuzz import process, fuzz

load_dotenv()
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class Agent:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            logger.error("OPENAI_API_KEY not found in .env file")
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        self.client = AsyncOpenAI(api_key=api_key)
        logger.info("OpenAI client initialized successfully")
        self.suggested_questions = [
            "What is the salary range for this position?",
            "What are the next steps in the interview process?",
            "Can you tell me more about the team I'll be working with?",
            "What benefits does the company offer?",
            "What is the expected start date?",
            "What is the address of Quadrant Technologies?",
            "Are there any PGs or restaurants near Quadrant Technologies?",
            "Where are all the Quadrant Technologies offices located?"
        ]
        self.quadrant_cities = [
            "Redmond, WA", "Iselin, NJ", "Dallas, TX", "Hyderabad, Telangana",
            "Bengaluru, Karnataka", "Warangal, Telangana", "Noida, Uttar Pradesh",
            "Guadalajara, Mexico", "Surrey, Canada", "Dubai, UAE", "Lane Cove, Australia",
            "Kuala Lumpur, Malaysia", "Singapore", "Chiswick, UK"
        ]
        self.common_terms = ["restaurants", "restaurant", "pgs", "pg", "nearby", "near", "address", "locations", "offices"]

    async def correct_query(self, query: str, history: list, role: str) -> str:
        try:
            query_lower = query.lower()
            corrected_query = query_lower
            for city in self.quadrant_cities:
                city_lower = city.split(",")[0].lower()
                match = process.extractOne(city_lower, [query_lower], scorer=fuzz.partial_ratio, score_cutoff=80)
                if match:
                    corrected_query = corrected_query.replace(match[0], city_lower)
            for term in self.common_terms:
                match = process.extractOne(term, [query_lower], scorer=fuzz.partial_ratio, score_cutoff=80)
                if match:
                    corrected_query = corrected_query.replace(match[0], term)
            prompt = (
                "You are an expert at correcting typos and understanding user intent in queries. "
                f"Based on the conversation history, context (interacting with {'HR' if role == 'hr' else 'candidate'}), "
                "previous and following words, and the full question, correct any spelling, typing, or grammatical errors. "
                "Infer the most likely intended meaning. The query may relate to Quadrant Technologies locations or nearby amenities. "
                f"Known cities: {', '.join(self.quadrant_cities)}. Common terms: {', '.join(self.common_terms)}. "
                "Output ONLY the corrected query, nothing else."
            )
            prompt += f"\n\nConversation History:\n"
            for msg in history:
                prompt += f"{msg['role'].capitalize()}: {msg['query']}\nAssistant: {msg['response']}\n"
            prompt += f"\nOriginal Query: {query}\nCorrected Query:"
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a typo correction and intent understanding assistant."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=100,
                temperature=0.3
            )
            corrected = response.choices[0].message.content.strip()
            logger.info(f"Corrected query: '{query}' -> '{corrected}'")
            return corrected if corrected else corrected_query
        except Exception as e:
            logger.error(f"Error correcting query: {e}")
            return corrected_query

    async def process_query(self, documents: str, history: list, query: str, role: str) -> str:
        try:
            prompt = (
                "You are an expert assistant analyzing job descriptions and resumes, designed to maintain conversation context like a chat application. "
                f"You are interacting with a {'HR representative' if role == 'hr' else 'job candidate'}. "
                "Below is the extracted text from relevant document sections and the conversation history. "
                "Answer the user's query based on the document content and prior conversation. "
                "Provide a concise and accurate response. If the query cannot be answered based on the provided text or history, say so clearly. "
                "Support follow-up questions and topic switches while maintaining context."
            )
            if role == "candidate":
                prompt += f"\n\nSuggested Questions for Candidate:\n" + "\n".join(f"- {q}" for q in self.suggested_questions)
            prompt += f"\n\nDocuments:\n{documents}\n\nConversation History:\n"
            for msg in history:
                prompt += f"{msg['role'].capitalize()}: {msg['query']}\nAssistant: {msg['response']}\n"
            prompt += f"\n{role.capitalize()} Query: {query}"
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

    async def process_map_query(self, map_data: dict, query: str, role: str) -> str:
        try:
            if map_data:
                if map_data["type"] in ["address", "nearby", "multi_location"]:
                    return ""  # Return empty string for address, nearby, and multi_location to let frontend render UI
                elif map_data["type"] == "directions":
                    return "Directions:\n\n" + "\n".join(
                        f"- {step}" for step in map_data['data']
                    )
                return ""
            prompt = (
                "You are an expert assistant providing location-based information for a job candidate or HR representative. "
                f"You are interacting with a {'HR representative' if role == 'hr' else 'job candidate'}. "
                "Use the provided map data to answer the query concisely and accurately. "
                "Format the response clearly, e.g., list addresses or locations in bullet points without embedding map links. "
                "The UI will handle displaying clickable map images."
            )
            if map_data.get("type") == "address":
                prompt += f"\n\nMap Data:\nAddress: {map_data['data']}\n\nQuery: {query}"
            elif map_data.get("type") == "nearby":
                prompt += f"\n\nMap Data:\n" + "\n".join(
                    f"- {item['name']}: {item['address']}" for item in map_data['data']
                ) + f"\n\nQuery: {query}"
            elif map_data.get("type") == "directions":
                prompt += f"\n\nMap Data:\nDirections:\n" + "\n".join(
                    f"- Step: {step}" for step in map_data['data']
                ) + f"\n\nQuery: {query}"
            elif map_data.get("type") == "multi_location":
                prompt += f"\n\nMap Data:\n" + "\n".join(
                    f"- {item['city']}: {item['address']}" for item in map_data['data']
                ) + f"\n\nQuery: {query}"
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for providing location-based information."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=1000,
                temperature=0.7
            )
            answer = response.choices[0].message.content.strip()
            logger.info(f"LLM map response: {answer[:100]}...")
            return answer if answer else ""
        except Exception as e:
            logger.error(f"Error processing map query: {e}")
            raise