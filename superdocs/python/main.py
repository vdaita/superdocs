from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage
from langchain.embeddings import OpenAIEmbeddings
import github_load.py as gh
import web_load.py as web

import dotenv
import uvicorn

import chromadb
from pathlib import Path
import os
import re
import json

import request_schemas
from response_stream_callback import FrontendStreamCallback
from saved_variable import SavedVariable

dotenv.load_dotenv()

app = FastAPI()
frontend_stream_callback = FrontendStreamCallback()
chat = ChatOpenAI(callbacks=frontend_stream_callback)
embeddings = OpenAIEmbeddings()

home_directory = Path.home()
superdocs_directory = os.path.join(home_directory, ".superdocs")
chroma_directory = os.path.join(superdocs_directory, "chroma")

sources = None

client = chromadb.PersistentClient(path=chroma_directory)
code_collection = None
documentation_collection = None

current_project_directory = ""

@app.post("/set_current_project")
async def set_current_project(data: request_schemas.SetCurrentProjectRequest):
    global current_project_directory
    global code_collection
    global documentation_collection
    global sources
    
    current_project_directory = data.directory
    alphanumeric_project_directory = re.sub(r'\W+', '', current_project_directory)
    valid_range = alphanumeric_project_directory[max(0, len(alphanumeric_project_directory) - 58):]
    code_collection_name = valid_range + "c"
    documentation_collection_name = valid_range + "d"

    source_filepath = os.path.join(superdocs_directory, valid_range + "_sources.json")
    sources = SavedVariable(source_filepath) # the last set of tools depends solely on the tools
    
    code_collection = client.get_or_create_collection(name=code_collection_name, embedding_function=embeddings) # separate collection for code and documentation
    # documentation_collection = client.get_or_create_collection(name=documentation_collection_name, embedding_function=embeddings)

    return {"ok": True}

@app.post("/send_message")
async def send_message(data: request_schemas.MessageRequest):
    chat([HumanMessage(content=data.message)])
    return {"ok": True}

@app.post("/get_sources")
async def get_sources():
    if type(sources) == SavedVariable:
        return {"ok": True, "sources": sources.get()}
    else:
        return {"ok": True, "sources": []}

@app.post("/add_documentation_source")
async def add_documentation_source(data: request_schemas.AddDocumentationSourceRequest):
    global sources

    if type(sources) == SavedVariable:
        tmp_sources = sources.get()
        tmp_sources.append(data.base_url)
        sources.set(tmp_sources)
        return {"ok": True}
    return {"ok": False}

@app.post("/add_source")
async def add_source(data: request_schemas.AddSourceRequest):
    # Check if the source is a GitHub repository
    if gh.is_github_repo(data.url):
        gh.process_github_repo(data.url)
    else:
        web.fetch_webpage_and_store_in_chromadb(data.url)
    
    return {"ok": True}

@app.post("/delete_doc_source")
async def delete_documentation_source(data: request_schemas.DeleteDocumentationSourceRequest):
    global sources

    if type(sources) == SavedVariable:
        tmp_sources = sources.get()
        tmp_sources.remove(data.base_url)
        sources.set(tmp_sources)
        return {"ok": True}
    return {"ok": False}

@app.post("/delete_source")
async def delete_source(data: request_schemas.DeleteSourceRequest):
    

@app.post("/reload_local_sources")
async def reload_local_sources():
    
    pass

if __name__ == "__main__":
    uvicorn.run(app, port=54323)