from fastapi import FastAPI
from pydantic import BaseModel, Field
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage
from langchain.embeddings import OpenAIEmbeddings
from langchain.agents import load_tools
from langchain.llms import OpenAI
from langchain.utilities import SerpAPIWrapper
from langchain.agents import initialize_agent, Tool
from langchain.tools import tool
from langchain.agents import AgentType
from langchain.utilities import MetaphorSearchAPIWrapper
from langchain.callbacks.manager import CallbackManager
from fastapi.middleware.cors import CORSMiddleware
from langchain.memory import ConversationBufferMemory
from langchain.prompts import MessagesPlaceholder
from langchain.vectorstores import Chroma
import langchain_repo
import autogen

from langchain.agents.agent_toolkits import (
    create_vectorstore_agent,
    VectorStoreToolkit,
    VectorStoreInfo,
)

import dotenv
import uvicorn

import chromadb
from pathlib import Path
import os
import re
import json

import request_schemas
from response_stream_callback import FrontendStreamCallback
from saved_variable import SavedList
from tools import get_tools, generate_autogen_tool_schema

dotenv.load_dotenv(".env")

app = FastAPI()
frontend_stream_callback = FrontendStreamCallback()

callback_manager = CallbackManager([frontend_stream_callback])

chat = ChatOpenAI(model="gpt-4", temperature=0, callback_manager=callback_manager, streaming=True)
agent_chain = None

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# print(chat([HumanMessage(content="Testing 123")]))

embeddings = OpenAIEmbeddings()

home_directory = Path.home()
superdocs_directory = os.path.join(home_directory, ".superdocs")
chroma_directory = os.path.join(superdocs_directory, "chroma")

sources = None

chroma_client = chromadb.PersistentClient(path=chroma_directory)
langchain_chroma = None
code_collection = None
documentation_collection = None

current_project_directory = ""

memory = None
chat_history = None

@app.post("/set_current_project")
async def set_current_project(data: request_schemas.SetCurrentProjectRequest):
    print("Setting current workspace folder to: ", data.directory)
    global current_project_directory
    global code_collection
    global documentation_collection
    global sources
    global tools
    global chat
    global callback_manager
    global agent_chain
    global memory
    global chat_history
    global embeddings
    global langchain_chroma
    
    current_project_directory = data.directory
    alphanumeric_project_directory = re.sub(r'\W+', '', current_project_directory)
    valid_range = alphanumeric_project_directory[max(0, len(alphanumeric_project_directory) - 58):]
    code_collection_name = valid_range + "c"
    documentation_collection_name = valid_range + "d"

    source_filepath = os.path.join(superdocs_directory, valid_range + "_sources.json")
    sources = SavedList(source_filepath) # the last set of tools depends solely on the tools
    
    code_collection = chroma_client.get_or_create_collection(name=code_collection_name, embedding_function=embeddings) # separate collection for code and documentation
    langchain_chroma = Chroma.from_texts(["Starter"], embeddings)

    memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
    chat_history = MessagesPlaceholder(variable_name="chat_history")
    tools = get_tools(data.directory, callback_manager)

    def _handle_error(error) -> str:
        print("Handling parsing errors privately")
        after_action = error.split("Action:")
        if len(after_action) > 1:
            action_json = json.loads(after_action[1])
            return action_json["action_input"]
        return str(error)
    
    agent_chain = initialize_agent(
        tools,
        chat,
        agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True,
        agent_kwargs={
            "history": [chat_history],
            "memory_prompts": [chat_history],
            'input_variables': ["chat_history", "agent_scratchpad", "input"]
        },
        callback_manager=callback_manager,
        memory=memory,
        handle_parsing_errors=_handle_error
    )
    # documentation_collection = client.get_or_create_collection(name=documentation_collection_name, embedding_function=embeddings)

    return {"ok": True}

@app.post("/send_message")
async def send_message(data: request_schemas.MessageRequest):
    agent_chain.invoke({"input": data.message})
    return {"ok": True}

@app.get("/get_sources")
async def get_sources():
    global langchain_chroma 
    docs = langchain_chroma.get()
    return langchain_chroma.get()

@app.post("/add_documentation_source")
async def add_documentation_source(data: request_schemas.AddDocumentationSourceRequest):
    global sources

    if type(sources) == SavedList:
        tmp_sources = sources.get()
        tmp_sources.append(data.base_url)
        sources.set(tmp_sources)
        return {"ok": True}
    return {"ok": False}

@app.post("/delete_source")
async def delete_source(data: request_schemas.DeleteDocumentationSourceRequest):
    global sources

    if type(sources) == SavedList:
        tmp_sources = sources.get()
        tmp_sources.remove(data.base_url)
        sources.set(tmp_sources)
        return {"ok": True}
    return {"ok": False}

class SearchInput(BaseModel):
    query: str = Field()

def create_vectorstore_search_function(local_vectorstore):
    def search_vectorstore(query: str) -> str:
        """Runs semantic search on the current codebase. Useful for queries that are too semantically complex for regular matching."""
        return local_vectorstore.similarity_search_with_score(query, k=10)
    return search_vectorstore

@app.post("/reload_local_sources")
async def reload_local_sources():
    global current_project_directory
    global callback_manager
    global chat
    global tools
    global langchain_chroma
    global agent_chain

    # print(langchain_chroma)
    # langchain_chroma.delete_collection()
    documents = langchain_repo.get_documents(current_project_directory)
    langchain_chroma = Chroma.from_documents(documents, embeddings)

    # @tool

    
    tools_copy = tools.copy()
    tools_copy.append(Tool.from_function(
        func=create_vectorstore_search_function(langchain_chroma),
        name="Search Vectorstore",
        description="Runs semantic search on the current codebase. Useful for queries that are too semantically complex for regular matching.",
        args_schema=SearchInput
    ))

    def _handle_error(error) -> str:
        print("Handling parsing errors privately")
        after_action = error.split("Action:")
        if len(after_action) > 1:
            action_json = json.loads(after_action[1])
            return action_json["action_input"]
        return str(error)
    
    agent_chain = initialize_agent(
        tools_copy,
        chat,
        agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True,
        agent_kwargs={
            "history": [chat_history],
            "memory_prompts": [chat_history],
            'input_variables': ["chat_history", "agent_scratchpad", "input"],
            "handle_parsing_errors": _handle_error
        },
        callback_manager=callback_manager,
        memory=memory
    )
    agent_chain.handle_parsing_errors = _handle_error

    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, port=54323)