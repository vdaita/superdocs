from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from supabase import create_client, Client
import os
from pydantic import BaseModel
from typing import Optional, List

from openai import OpenAI
from groq import Groq
import json

import multiprocessing
import rapidfuzz
import re

from dotenv import load_dotenv
load_dotenv()

app = FastAPI()
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(url, key)

class Snippet(BaseModel):
    filepath: str
    code: str
    startIndex: Optional[int]
    endIndex: Optional[int]
    language: str

class File:
    filepath: str
    contents: str

class Message(BaseModel):
    snippets: List[Snippet]
    request: str
    jwt_token: str

class Change(BaseModel):
    filepath: str
    instruction: str
    search_block: str
    replace_block: str

class FormattedResponse(BaseModel):
    summary: str
    plan: str
    changes: List[Change]

groq_client = Groq(
    api_key=os.environ.get("GROQ_API_KEY")
)

openai_client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY")
)

def extract_xml_tags(text, tag):
    pattern = r'<' + tag + '>(.*?)</' + tag + '>'
    matches = re.findall(pattern, text, re.DOTALL)
    return matches

def file_list_to_dict(files: List[File]) -> dict:
    d = {}
    for file in files:
        d[file.filepath] = file.contents
    return d

def parse_change(change_text: str) -> Change:
    pass

def parse_plan(change_text: str) -> FormattedResponse:
    pass

@app.get("/get_completion")
def get_completion(message: Message):
    try:
        data = supabase.auth.get_user(message.jwt_token)
        if data:
            async def stream_func():
                response = ""
                plan_stream = groq_client.chat.completions.create(
                    messages=[],
                    stream=True
                )
                for chunk in plan_stream:
                    response += chunk.choices[0].delta.content
                    cpy_response = response
                    # Replace all of the keywords 
                    xml_keywords = ["summary", "plan", "changes", "filepath", "instruction"]
                    for keyword in xml_keywords:
                        cpy_response = cpy_response.replace(f"<{keyword}>", "\n")
                        cpy_response = cpy_response.replace(f"</{keyword}>", "\n")
                    yield json.dumps({
                        "progress": cpy_response, 
                        "plan_completed": False,
                        "changes_completed": False,
                        "changes": []
                    })
                
                plan = parse_plan(response)

                yield json.dumps({
                    "plan_completed": True,
                    "plan": plan,
                    "changes_completed": False,
                    "changes": []
                })

                def process_change(filepath, instruction):
                    relevant_snippets = ""
                    for snippet in message.snippets:
                        if rapidfuzz.fuzz.partial_ratio(snippet.filepath, filepath) > 0.9:
                            if len(relevant_snippets) > 0:
                                relevant_snippets += f"...\n{snippet.code}\n"
                            else:
                                relevant_snippets += f"{snippet.code}\n"
                        
                    change_response = openai_client.chat.completions.create(
                        messages=[],
                        stream=False
                    )
                    return change_response.choices[0].message.content
                pool = multiprocessing.Pool(processes=len(plan["changes"]))
                changes_text = pool.map(process_change, [(change["file"], change["chunk"]) for change in plan["changes"]])
                changes = [parse_change(change_text) for change_text in changes_text]

                yield json.dumps({
                    "plan_completed": True,
                    "plan": plan,
                    "changes_completed": True,
                    "changes": changes
                })
                
            return StreamingResponse(stream_func)
    except Exception as e:
        return {"message": "Failed to run"}