from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
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

import asyncio

from dotenv import load_dotenv
load_dotenv()

app = FastAPI()
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(url, key)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

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
    location: str
    search_block: str
    replace_block: str

class FormattedResponse(BaseModel):
    summary: str
    plan: str
    progress: str
    planCompleted: bool
    changesCompleted: bool
    rank: int
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

def parse_sr_change(change_text: str, existing_change: Change) -> Change:
    existing_change.search_block = extract_xml_tags(change_text, "search")[0]
    existing_change.replace_block = extract_xml_tags(change_text, "replace")[0]
    return existing_change
    
def parse_change_instruction(change_text: str) -> Change:
    change = Change(
        filepath=extract_xml_tags(change_text, "filepath")[0],
        instruction=extract_xml_tags(change_text, "instruction")[0],
        location=extract_xml_tags(change_text, "location")[0],
        search_block="",
        replace_block=""
    )
    return change

def parse_plan(plan_text: str) -> FormattedResponse:
    summary = extract_xml_tags(plan_text, "summary")[0]
    plan = extract_xml_tags(plan_text, "plan")[0]
    changes = []
    for change in extract_xml_tags(plan_text, "change"):
        changes.append(parse_change_instruction(change))
    return FormattedResponse(summary, plan, changes)

def process_change(filepath, instruction, snippets):
    relevant_snippets = ""
    for snippet in snippets:
        if rapidfuzz.fuzz.partial_ratio(snippet.filepath, filepath) > 0.9:
            if len(relevant_snippets) > 0:
                relevant_snippets += f"...\n{snippet.code}\n"
            else:
                relevant_snippets += f"{snippet.code}\n"
        
    change_response = openai_client.chat.completions.create(
        messages=[
            {
                "role": "system",
                "content": "Generate a search-replace block formatted to handle the requested change."
            },
            {
                "role": "user",
                "content": f"Snippets of code from the file: \n {relevant_snippets}"
            },
            {
                "role": "user",
                "content": f"Instruction: {instruction}"
            }
        ],
        stream=False
    )
    return parse_sr_change(change_response.choices[0].message.content)

@app.post("/get_completion")
def get_completion(message: Message):
    try:
        data = supabase.auth.get_user(message.jwt_token)
        if data:
            async def stream_func():
                responses = []

                async def load_response(response_index):
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

                        update = FormattedResponse(
                            progress=cpy_response,
                            planCompleted=False,
                            changesCompleted=False,
                            changes=[],
                            plan="",
                            summary="",
                            rank=response_index
                        )

                        if response_index > len(responses):
                            responses.append(update)
                        else:
                            responses[response_index] = update
                        
                            
                    plan = parse_plan(response)
                
                    update = FormattedResponse(
                        progress="",
                        planCompleted=True,
                        changesCompleted=False,
                        changes=[],
                        plan=plan,
                        summary="",
                        rank=response_index
                    )

                    if response_index > len(responses):
                        responses.append(update)
                    else:
                        responses[response_index] = update
                    pool = multiprocessing.Pool(processes=len(plan.changes))
                    changes_text = pool.map(process_change, [(change.filepath, change.instruction, message.snippets) for change in plan.changes])
                    changes = [parse_sr_change(change_text) for change_text in changes_text]

                    update = FormattedResponse(
                        planCompleted=True,
                        plan=plan,
                        changedCompleted=True,
                        changes=changes,
                        rank=response_index
                    )
                    
                    if response_index > len(responses):
                        responses.append(update)
                    else:
                        responses[response_index] = update

                for i in range(5):
                    asyncio.create_task(load_response(i))
                
                for _ in range(600): # take max 60 seconds
                    await asyncio.sleep(0.1)
                    all_done = True
                    for response in responses:
                        if not(response["plan_completed"]) or not(response["changes_completed"]):
                            all_done = False
                            yield responses
                    if all_done:
                        yield responses
                        break
            
            return StreamingResponse(stream_func)
    except Exception as e:
        return {"message": "Failed to run"}
    
if __name__ == "__main__":
    app.run(port=8000)