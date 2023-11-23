from pydantic import BaseModel
from typing import Optional

class SetCurrentProjectRequest(BaseModel):
    directory: str

class MessageRequest(BaseModel):
    message: str

class AddDocumentationSourceRequest(BaseModel):
    base_url: str
    method: str

class DeleteDocumentationSourceRequest(BaseModel):
    id: str

class StartChatRequest(BaseModel):
    message: str
