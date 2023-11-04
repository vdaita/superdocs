from pydantic import BaseModel

class SetCurrentProjectRequest(BaseModel):
    directory: str

class MessageRequest(BaseModel):
    message: str

class AddDocumentationSourceRequest(BaseModel):
    base_url: str
    method: str

class DeleteDocumentationSourceRequest(BaseModel):
    base_url: str