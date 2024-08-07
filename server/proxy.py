from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import requests

app = FastAPI()

class RequestData(BaseModel):
    file_content: str
    query: str

class ResponseData(BaseModel):
    text: str

app.post("/make_request", response_model=ResponseData)
async def make_request(data: RequestData):
    try:
        response = requests.post(
            "http://127.0.0.1:8000/edit_request",
            json=data.dict()
        )
        response.raise_for_status()  # Raise an error for bad status codes
        response_data = response.json()
        return {"text": response_data["text"]}
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=str(e))