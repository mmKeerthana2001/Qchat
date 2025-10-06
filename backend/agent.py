
import asyncio
import logging
from openai import AsyncOpenAI
from typing import Tuple
from dotenv import load_dotenv
import os
from rapidfuzz import process, fuzz
import json
import re

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
            "Where are all the Quadrant Technologies offices located?",
            "Show me the company video",
            "What is the dress code?",
            "Who is the chairman?",
            "can u list all quadrant locations",
            "hey",
            "hi",
            "hey",
            "hi",
            "Can you tell me more about the team I'll be working with?",
            "What benefits does the company offer?",
            "What is the expected start date?",
            "What is the address of Quadrant Technologies?",
            "Are there any PGs or restaurants near Quadrant Technologies?",
            "Where are all the Quadrant Technologies offices located?",
            "Show me the company video",
            "What is the dress code?"
            
        ]
        self.quadrant_cities = [
            "Redmond, WA", "Iselin, NJ", "Dallas, TX", "Hyderabad, Telangana",
            "Bengaluru, Karnataka", "Warangal, Telangana", "Noida, Uttar Pradesh",
            "Guadalajara, Mexico", "Surrey, Canada", "Dubai, UAE", "Lane Cove, Australia",
            "Kuala Lumpur, Malaysia", "Singapore", "Chiswick, UK"
        ]
        self.common_terms = ["restaurants", "restaurant", "pgs", "pg", "nearby", "near", "address", "locations", "offices"]
        
        # Load media URLs from .env
        self.video_url = os.getenv("VIDEO_URL")
        self.dress_code_image_url = os.getenv("DRESS_CODE_IMAGE_URL")
        self.president_image_url = os.getenv("PRESIDENT_IMAGE_URL")
        if not self.president_image_url:
            logger.warning("PRESIDENT_IMAGE_URL not found in .env file, defaulting to empty string")
            self.president_image_url = ""
        logger.info(f"Loaded VIDEO_URL: {self.video_url}")
        logger.info(f"Loaded PRESIDENT_IMAGE_URL: {self.president_image_url}")

        # Dress item to image URL mapping
        self.dress_images = {
            "formal trousers": os.getenv("DRESS_FORMAL_TROUSERS_URL", "http://localhost:8080/assets/formal-trousers.jpg"),
            "formal shirt": os.getenv("DRESS_FORMAL_SHIRT_URL", "http://localhost:8080/assets/formal-shirt.jpg"),
            "jeans": os.getenv("DRESS_JEANS_URL", "http://localhost:8080/assets/jeans.jpg"),
            "round t-shirt": os.getenv("DRESS_ROUND_TSHIRT_URL", "http://localhost:8080/assets/round-tshirt.jpg"),
            "polo t-shirt": os.getenv("DRESS_POLO_TSHIRT_URL", "http://localhost:8080/assets/polo-tshirt.jpg"),
            "collared t-shirt": os.getenv("DRESS_COLLARD_TSHIRT_URL", "http://localhost:8080/assets/collared-tshirt.jpg"),
            "formal shoes": os.getenv("DRESS_FORMAL_SHOES_URL", "http://localhost:8080/assets/formal-shoes.jpg"),
            "casual shoes": os.getenv("DRESS_CASUAL_SHOES_URL", "http://localhost:8080/assets/casual-shoes.jpg"),
            "salwar kameez": os.getenv("DRESS_SALWAR_KAMEEZ_URL", "http://localhost:8080/assets/salwar-kameez.jpg"),
            "churidar": os.getenv("DRESS_CHURIDAR_URL", "http://localhost:8080/assets/churidar.jpg"),
            "kurta": os.getenv("DRESS_KURTA_URL", "http://localhost:8080/assets/kurta.jpg"),
            "saree": os.getenv("DRESS_SAREE_URL", "http://localhost:8080/assets/saree.jpg"),
            "long frock": os.getenv("DRESS_LONG_FROCK_URL", "http://localhost:8080/assets/long-frock.jpg"),
            "slip-ons": os.getenv("DRESS_SLIPONS_URL", "http://localhost:8080/assets/slip-ons.jpg"),
            "boots": os.getenv("DRESS_BOOTS_URL", "http://localhost:8080/assets/boots.jpg"),
            "sandals": os.getenv("DRESS_SANDALS_URL", "http://localhost:8080/assets/sandals.jpg"),
            "sports shoes": os.getenv("DRESS_SPORTS_SHOES_URL", "http://localhost:8080/assets/sports-shoes.jpg"),
            "sneakers": os.getenv("DRESS_SNEAKERS_URL", "http://localhost:8080/assets/sneakers.jpg"),
            "loafers": os.getenv("DRESS_LOAFERS_URL", "http://localhost:8080/assets/loafers.jpg"),
        }
        self.dress_images = {k: v for k, v in self.dress_images.items() if v}
        logger.info(f"Loaded {len(self.dress_images)} dress images")
    
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

    def _insert_dress_images(self, answer: str) -> str:
        """Post-process dress code response to insert small inline images for all matching dress items."""
        lines = answer.split('\n')
        new_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('- '):
                item_text = stripped[2:].strip().lower()
                matched_items = []
                for key in self.dress_images:
                    if key in item_text:
                        matched_items.append(key)
                img_tags = []
                for matched_item in matched_items:
                    url = self.dress_images[matched_item]
                    img_tag = f' <img src="{url}" width="24" height="24" alt="{matched_item}" style="vertical-align: middle; margin-left: 8px;" />'
                    img_tags.append(img_tag)
                indent = line[:line.find('-')]
                new_line = f"{indent}- {item_text}{''.join(img_tags)}"
            else:
                new_line = line
            new_lines.append(new_line)
        return '\n'.join(new_lines)
    

    def format_dos_donts(self, response: str) -> str:
        """Format do's and don'ts in LLM response with markdown, emojis, and aligned bullets."""
        lines = response.split("\n")
        formatted = []
        in_dos, in_donts = False, False
        seen_items = set()  # Track unique items to avoid duplicates
        current_section = None  # Track current section (e.g., Business Formals, Smart Casuals)
        
        for line in lines:
            stripped = line.strip().lower()
            # Detect main headers
            if stripped.startswith("for male employees:") or stripped.startswith("for female employees:"):
                formatted.append(f"## {line.strip()}")
                current_section = None
                in_dos, in_donts = False, False
            # Detect sub-sections
            elif stripped.startswith("business formals") or stripped.startswith("smart casuals") or stripped.startswith("footwear:") or stripped.startswith("hair") or stripped.startswith("jewelry:"):
                current_section = line.strip()
                formatted.append(f"### {current_section}")
                in_dos, in_donts = False, False
            # Detect Do's and Don'ts
            elif stripped.startswith("do's:") or stripped.startswith("dos:"):
                in_dos, in_donts = True, False
                formatted.append("#### Do's")
            elif stripped.startswith("don'ts:") or stripped.startswith("donts:"):
                in_dos, in_donts = False, True
                formatted.append("#### Don'ts")
            # Process list items
            elif (stripped.startswith("-") or stripped.startswith("*")) and (in_dos or in_donts):
                item = line[1:].strip()
                if item and item.lower() not in seen_items:  # Avoid duplicates
                    formatted.append(f"  - {'✅' if in_dos else '❌'} {item}")
                    seen_items.add(item.lower())
            # Preserve other lines (e.g., empty lines or non-list content)
            else:
                formatted.append(line.rstrip())
                in_dos, in_donts = False, False
                current_section = None
        
        return "\n".join(formatted)

    async def process_query(self, documents: str, history: list, query: str, role: str, intent_data: dict = None) -> Tuple[str, dict | None]:
        try:
            # Null-safety for intent_data: Default to empty dict if None
            intent_data = intent_data or {}

            prompt = (
                "You are an expert assistant analyzing job descriptions and resumes, designed to maintain conversation context like a chat application. "
                f"You are interacting with a {'HR representative' if role == 'hr' else 'job candidate'}. "
                "Below is the extracted text from relevant document sections and the conversation history. "
                "Answer the user's query based on the document content and prior conversation. "
                "Provide a concise and accurate response. If the query cannot be answered based on the provided text or history, say so clearly. "
                "Support follow-up questions and topic switches while maintaining context. "
                "For queries about the president, do not mention any photo or link in the response text."
                "For queries asking for do's and don'ts (e.g., interview tips, dress code, workplace etiquette), structure the response with '#### Do's' and '#### Don'ts' sections containing bullet points starting with a dash (-). Ensure items are unique, concise, properly indented, and avoid duplicates. If applicable, include headers like '## For Male Employees:' or '## For Female Employees:' for dress code, or other relevant headers for the context (e.g., '## Interview Tips'). End with 'If you have any further questions, feel free to ask!'"
            )
            
            if role == "candidate":
                prompt += f"\n\nSuggested Questions for Candidate:\n" + "\n".join(f"- {q}" for q in self.suggested_questions)
            prompt += f"\n\nDocuments:\n{documents}\n\nConversation History:\n"
            for msg in history:
                prompt += f"{msg['role'].capitalize()}: {msg['query']}\nAssistant: {msg['response']}\n"
            prompt += f"\n{role.capitalize()} Query: {query}"

            media_data = None
            intent = intent_data.get("intent")  # Safe now due to null-safety above
            gender = intent_data.get("gender")

            if intent == "video":
                prompt += "\nIf the query is about videos or company overview, provide a brief introduction to the video and reference that the company video is available for viewing. Structure the response professionally: Start with a short description (e.g., 'This video showcases the AI-empowered solutions of Quadrant Technologies.'), then mention 'You can watch the company video below for more details.' End with 'If you have any further questions, feel free to ask!'"
                media_data = {"type": "video", "url": self.video_url} if self.video_url else None
                if not self.video_url:
                    prompt += "\nNote: If no video URL is available, mention that the video will be provided soon."
            elif intent == "dress":
                if gender:
                    gender_cap = gender.capitalize()
                    prompt += f"\nIf the query is about dress code for {gender}, structure the response starting with '## For {gender_cap} Employees:' followed by '### Business Formals (Monday–Thursday):', '### Smart Casuals (Friday):', '### Footwear:', '### Hair & Beard:' or '### Hair:', '### Jewelry:' (as applicable) with '#### Do's' and '#### Don'ts' with bullet points for allowed and prohibited categories. Each item must start with a dash (-), be unique, and avoid duplicates. End with 'For more details, you can view the dress code image here. If you have any further questions, feel free to ask!'"
                else:
                    prompt += "\nIf the query is about dress code, structure the response with two main sections: '## For Male Employees:' and '## For Female Employees:', each followed by '### Business Formals (Monday–Thursday):', '### Smart Casuals (Friday):', '### Footwear:', '### Hair & Beard:' or '### Hair:', '### Jewelry:' (as applicable) with '#### Do's' and '#### Don'ts' with bullet points for allowed and prohibited categories. Each item must start with a dash (-), be unique, and avoid duplicates. End with 'For more details, you can view the dress code image here. If you have any further questions, feel free to ask!'"
                media_data = {"type": "image", "url": self.dress_code_image_url} if self.dress_code_image_url else None
            elif intent == "president":
                media_data = {"type": "image", "url": self.president_image_url} if self.president_image_url else None
                logger.debug(f"President intent detected, media_data set to: {media_data}")

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

            # Format do's and don'ts
            answer = self.format_dos_donts(answer)

            # Post-process for dress: insert inline images for all matching items
            if intent == "dress":
                answer = self._insert_dress_images(answer)

            # Post-process for president: remove photo/link references
            if intent == "president":
                if "photo" in answer.lower() or "link" in answer.lower():
                    answer = answer.split("You can view")[0].strip()
                    if not answer.endswith("."):
                        answer += "."
                    answer += " If you have any further questions about the company or its leadership, feel free to ask!"

            logger.info(f"LLM response: {answer[:100]}...")
            logger.debug(f"Returning media_data: {media_data}")
            return answer, media_data
        except Exception as e:
            logger.error(f"Error processing query: {e}")
            raise

    async def process_map_query(self, map_data: dict, query: str, role: str) -> str:
        try:
            if map_data:
                if map_data["type"] in ["address", "nearby", "multi_location"]:
                    return ""
                elif map_data["type"] == "directions":
                    return "Directions:\n\n" + "\n".join(
                        f"- {step}" for step in map_data['data']
                    )
                elif map_data["type"] == "distance":
                    prompt = (
                        "You are an expert assistant providing location-based information for a job candidate or HR representative. "
                        f"You are interacting with a {'HR representative' if role == 'hr' else 'job candidate'}. "
                        "Using the provided map data, generate a concise natural language response to the query. "
                        "Include the origin, destination, distance, and estimated travel time in a friendly format. "
                        "Do not include map links, as the UI will handle them. "
                        f"\n\nMap Data:\n"
                        f"Origin: {map_data['data']['origin']}\n"
                        f"Destination: {map_data['data']['destination']}\n"
                        f"Distance: {map_data['data']['distance']}\n"
                        f"Duration: {map_data['data']['duration']}\n\n"
                        f"Query: {query}"
                    )
                    response = await self.client.chat.completions.create(
                        model="gpt-4o",
                        messages=[
                            {"role": "system", "content": "You are a helpful assistant for providing location-based information."},
                            {"role": "user", "content": prompt}
                        ],
                        max_tokens=200,
                        temperature=0.7
                    )
                    llm_response = response.choices[0].message.content.strip()
                    logger.info(f"LLM distance response: {llm_response[:100]}...")
                    return llm_response
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
            elif map_data.get("type") == "distance":
                prompt += (
                    f"\n\nMap Data:\n"
                    f"Origin: {map_data['data']['origin']}\n"
                    f"Destination: {map_data['data']['destination']}\n"
                    f"Distance: {map_data['data']['distance']}\n"
                    f"Duration: {map_data['data']['duration']}\n\n"
                    f"Query: {query}"
                )
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

    async def classify_intent_and_extract(self, query: str, history: list, role: str) -> dict:
        try:
            corrected_query = await self.correct_query(query, history, role)
            prompt = (
                "You are an intent classifier for a chat app focused on Quadrant Technologies locations and document-based queries. "
                f"Analyze the query in the context of interacting with {'HR' if role == 'hr' else 'candidate'}. "
                "Step 1: Determine if the query is map-related ('map') or not ('non_map'). "
                "Map-related queries involve locations, addresses, nearby amenities, or directions related to 'Quadrant Technologies'. "
                "Step 2: If map-related, classify the intent into one of: "
                "'single_location' (ask for specific office address/city), "
                "'multi_location' (ask for all offices or multiple cities), "
                "'nearby' (ask for amenities like PGs/restaurants near an office), "
                "'directions' (ask for step-by-step directions to/from an office), "
                "'distance' (ask for distance or travel time to/from an office, e.g., 'how far is airport from Quadrant Hyderabad'). "
                "Extract entities: city (exact match from known: " + ", ".join(self.quadrant_cities) + "), "
                "nearby_type (e.g., 'ladies pgs', 'gents pgs', 'restaurants', or infer from query like 'hotels', 'cafes'), "
                "origin (starting point for directions or distance, e.g., Quadrant office address if not specified), "
                "destination (endpoint for directions or distance, e.g., 'airport'). "
                "If city is implied (e.g., 'nearby PGs in Hyderabad' or 'how far is airport from Quadrant Hyderabad' implies Quadrant Hyderabad), use it. "
                "For 'nearby' and 'directions'/'distance' with no explicit origin, use Quadrant office as the source address. "
                "For queries containing 'how far' or 'distance', classify as 'distance' intent. "
                "If not map-related, classify the intent into one of: "
                "'video' (queries related to videos, company videos, or any video content), "
                "'dress' (queries related to dress code, what to wear, or clothing policies), "
                "'president' (queries related to the president, company leadership, or president details), "
                "'document' (any other general query to be answered from uploaded documents). "
                "For 'dress' intent, also extract 'gender': 'male' if the query mentions male/men/gents, 'female' if female/women/ladies, else null. "
                "Output ONLY a valid JSON object. Examples: "
                "{'is_map': true, 'intent': 'single_location', 'city': 'Bengaluru, Karnataka', 'nearby_type': null, 'origin': null, 'destination': null, 'gender': null} "
                "or {'is_map': true, 'intent': 'distance', 'city': 'Hyderabad, Telangana', 'nearby_type': null, 'origin': null, 'destination': 'airport', 'gender': null} "
                "or {'is_map': false, 'intent': 'video', 'city': null, 'nearby_type': null, 'origin': null, 'destination': null, 'gender': null} "
                "or {'is_map': false, 'intent': 'dress', 'city': null, 'nearby_type': null, 'origin': null, 'destination': null, 'gender': 'male'} "
                "or {'is_map': false, 'intent': 'dress', 'city': null, 'nearby_type': null, 'origin': null, 'destination': null, 'gender': null} "
                "or {'is_map': false, 'intent': 'president', 'city': null, 'nearby_type': null, 'origin': null, 'destination': null, 'gender': null} "
                "or {'is_map': false, 'intent': 'document', 'city': null, 'nearby_type': null, 'origin': null, 'destination': null, 'gender': null}"
            )
            prompt += f"\n\nConversation History:\n"
            for msg in history[-5:]:
                prompt += f"{msg['role'].capitalize()}: {msg['query']}\nAssistant: {msg['response']}\n"
            prompt += f"\nQuery: {corrected_query}\nJSON Output:"

            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a JSON-only responder. Output only a valid JSON object with keys: is_map (bool), intent (string), city (string or null), nearby_type (string or null), origin (string or null), destination (string or null), gender (string or null). No extra text."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=200,
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            raw_content = response.choices[0].message.content.strip()
            logger.info(f"Raw GPT response for intent classification: '{raw_content}'")
            
            intent_data = json.loads(raw_content)
            logger.info(f"Intent classification for '{corrected_query}': {intent_data}")
            return intent_data
        except Exception as e:
            logger.error(f"Error in intent classification: {e}")
            return {"is_map": False, "intent": "document", "city": None, "nearby_type": None, "origin": None, "destination": None, "gender": None}
