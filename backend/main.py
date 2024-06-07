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
from queue import Queue, Empty
import threading
import time
import traceback

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

def format_responses(responses: List[FormattedResponse]):
    return [response.model_dump_json() for response in responses]

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
    data = supabase.auth.get_user(message.jwt_token)
    print("User data: ", data)
    async def stream_func():
        message_queue = Queue()
        response_count = 5
        responses = [
            FormattedResponse(
                progress="",
                planCompleted=False,
                changesCompleted=False,
                changes=[],
                plan="",
                summary="",
                rank=response_index
            ) for response_index in range(1, response_count + 1)
        ]
        
        def load_response(response_index):
            response = ""
            plan_stream = groq_client.chat.completions.create(
                model="llama3-8b-8192",
                messages=[{"role": "system", "content": "Test"}, {"role": "user", "content": "test"}],
                stream=True
            )
            for chunk in plan_stream:
                if chunk.choices[0].delta.content is not None:
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

                    # print("Added message to queue")
                    message_queue.put({"index": response_index, "fr": update})
                    
                    
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
            
            # print("Added message to queue")
            message_queue.put({"index": response_index, "fr": update})
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
            
            print("Added message to queue")
            message_queue.put({"index": response_index, "fr": update})
        for i in range(5):
            thread = threading.Thread(target=load_response, args=(i,))
            thread.start()
        
        start_time = time.time()
        while True: # take max 60 seconds
            if time.time() - start_time > 60:
                break
            try:
                message = message_queue.get(timeout=0.1)
                responses[message["index"]] = message["fr"]
                all_done = True
                for response in responses:
                    if not(response.planCompleted) or not(response.changesCompleted):
                        all_done = False
                yield json.dumps(format_responses(responses), indent=4)
                if all_done:
                    break
            except (KeyboardInterrupt, SystemExit):
                print("Received keyboard interrupt.")
                return
            except Empty:
                print("Empty")
                continue
    
    return StreamingResponse(stream_func())
    
if __name__ == "__main__":
    app.run(port=8000)