import os
import uuid
import logging
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from msal import ConfidentialClientApplication
import requests
from datetime import datetime, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LoginHandler:
    def __init__(self):
        # Retrieve environment variables
        self.client_id = os.getenv("CLIENT_ID")
        self.client_secret = os.getenv("CLIENT_SECRET")
        self.tenant_id = os.getenv("TENANT_ID")
        self.authority = f"https://login.microsoftonline.com/{self.tenant_id}"
        self.redirect_uri = "http://localhost:8000/callback"
        self.scopes = ["User.Read"]

        # Validate environment variables
        if not all([self.client_id, self.client_secret, self.tenant_id]):
            logger.error("Missing required environment variables: CLIENT_ID, CLIENT_SECRET, or TENANT_ID")
            raise ValueError("Missing required environment variables")

        # Initialize MongoDB client
        try:
            self.mongo_client = MongoClient("mongodb://localhost:27017")
            self.db = self.mongo_client["document_analysis"]
            self.users_collection = self.db["users"]
            self.sessions_collection = self.db["sessions"]
            logger.info("Connected to MongoDB successfully")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {str(e)}")
            raise

        # Initialize MSAL application
        try:
            self.app = ConfidentialClientApplication(
                client_id=self.client_id,
                client_credential=self.client_secret,
                authority=self.authority
            )
            logger.info("MSAL application initialized")
        except Exception as e:
            logger.error(f"Failed to initialize MSAL application: {str(e)}")
            raise

    async def initiate_login(self):
        try:
            state = str(uuid.uuid4())
            auth_url = self.app.get_authorization_request_url(
                scopes=self.scopes,
                redirect_uri=self.redirect_uri,
                state=state,
                prompt="select_account"
            )
            logger.info(f"Initiating login with state: {state}")
            response = RedirectResponse(url=auth_url)
            response.set_cookie(key="oauth_state", value=state, httponly=True, secure=False)  # Secure=False for localhost
            return response
        except Exception as e:
            logger.error(f"Error initiating login: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Error initiating login: {str(e)}")

    async def handle_callback(self, request: Request):
        try:
            query_params = request.query_params
            code = query_params.get("code")
            state = query_params.get("state")
            stored_state = request.cookies.get("oauth_state")

            if not code or not state:
                logger.error("Missing code or state in callback")
                raise HTTPException(status_code=400, detail="Missing code or state")

            if state != stored_state:
                logger.error(f"State mismatch: received {state}, stored {stored_state}")
                raise HTTPException(status_code=400, detail="State mismatch")

            result = self.app.acquire_token_by_authorization_code(
                code=code,
                scopes=self.scopes,
                redirect_uri=self.redirect_uri
            )

            if "access_token" not in result:
                logger.error(f"Token acquisition failed: {result.get('error_description')}")
                raise HTTPException(status_code=400, detail=f"Failed to acquire token: {result.get('error_description')}")

            # Fetch user details from Microsoft Graph
            access_token = result["access_token"]
            headers = {"Authorization": f"Bearer {access_token}"}
            user_response = requests.get("https://graph.microsoft.com/v1.0/me", headers=headers)
            user_response.raise_for_status()
            user_data = user_response.json()

            user_id = result.get("id_token_claims", {}).get("oid") or user_data.get("id")
            email = user_data.get("mail") or user_data.get("userPrincipalName")
            if not user_id or not email:
                logger.error("Missing user_id or email in user info")
                raise HTTPException(status_code=400, detail="Invalid user info")

            # Generate session ID
            session_id = str(uuid.uuid4())
            expires_at = datetime.utcnow() + timedelta(hours=1)

            # Store or update user in MongoDB
            try:
                self.users_collection.update_one(
                    {"user_id": user_id},
                    {
                        "$set": {
                            "user_id": user_id,
                            "access_token": access_token,
                            "refresh_token": result.get("refresh_token"),
                            "expires_in": result.get("expires_in"),
                            "display_name": user_data.get("displayName"),
                            "email": email,
                            "given_name": user_data.get("givenName"),
                            "surname": user_data.get("surname"),
                            "job_title": user_data.get("jobTitle"),
                            "office_location": user_data.get("officeLocation"),
                            "last_login": datetime.utcnow()
                        }
                    },
                    upsert=True
                )
                logger.info(f"Stored/updated user {email} in MongoDB")
            except Exception as e:
                logger.error(f"Failed to store user in MongoDB: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Failed to store user in MongoDB: {str(e)}")

            # Store session in MongoDB
            try:
                self.sessions_collection.insert_one({
                    "session_id": session_id,
                    "user_id": user_id,
                    "email": email,
                    "access_token": access_token,
                    "refresh_token": result.get("refresh_token"),
                    "expires_at": expires_at,
                    "created_at": datetime.utcnow()
                })
                logger.info(f"Created session {session_id} for user {email}")
            except Exception as e:
                logger.error(f"Failed to store session in MongoDB: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Failed to store session in MongoDB: {str(e)}")

            # Redirect to frontend with session ID
            redirect_url = f"http://localhost:8080/chat?session_id={session_id}"
            response = RedirectResponse(url=redirect_url)
            response.delete_cookie("oauth_state")
            logger.info(f"Redirecting to frontend: {redirect_url}")
            return response
        except requests.exceptions.RequestException as e:
            logger.error(f"Microsoft Graph API error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Microsoft Graph API error: {str(e)}")
        except Exception as e:
            logger.error(f"Error in callback: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Callback error: {str(e)}")