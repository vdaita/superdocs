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
import sys
import logging
import time
import types
import io
from contextlib import redirect_stdout, asynccontextmanager, contextmanager
import threading
from threading import Thread
import typer
import requests
import sched
from subprocess import Popen, PIPE, STDOUT

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
agent_chain = None

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



embeddings = OpenAIEmbeddings()
home_directory = Path.home()
superdocs_directory = os.path.join(home_directory, ".superdocs")
chroma_directory = os.path.join(superdocs_directory, "chroma")

chroma_client = chromadb.PersistentClient(path=chroma_directory)
langchain_chroma = None
code_collection = None
documentation_collection = None

current_project_directory = ""

interface_stringio = io.StringIO()
user_proxy_thread = None

llm_config = {}
assistant_agent = None
user_proxy = None

autogen_runtime = None

def setup(tools):
    global llm_config
    global assistant_agent
    global user_proxy

    config_list = [
        {
            "model": "gpt-4-1106-preview",
            "api_key": os.environ["OPENAI_API_KEY"]
        }
    ]

    llm_config = {
        "functions": [

        ],
        "config_list": config_list,
        "timeout": 120
    }

    function_map = {

    }
    
    for tool in tools:
        llm_config["functions"].append(generate_autogen_tool_schema(tool))
        function_map[tool.name] = tool._run

    # user_proxy = autogen.UserProxyAgent(
    #     name="user_proxy",
    #     is_termination_msg=lambda x: x.get("content", "") and x.get("content", "").rstrip().endswith("TERMINATE"),
    #     human_input_mode="ALWAYS",
    #     max_consecutive_auto_reply=5,
    #     code_execution_config=False
    # )

    # # Register the tool and start the conversation
    # user_proxy.register_function(
    #     function_map=function_map
    # )

    # assistant_agent = autogen.AssistantAgent(
    #     name="chatbot",
    #     system_message="For coding tasks, only use the functions you have been provided with.",
    #     llm_config=llm_config
    # )

    return user_proxy

@app.post("/send_message")
async def send_message(data: request_schemas.MessageRequest):
    global autogen_runtime

    print("Printing: ", data.message, " to standard out")
    # sys.stdout.write(data.message)
    # sys.stdout.flush()
    autogen_runtime.stdin.write(data.message + "\n")
    autogen_runtime.stdin.flush()
    return {"ok": True}

@app.get("/get_sources")
async def get_sources():
    global langchain_chroma 
    docs = langchain_chroma.get()
    return docs

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
    setup(tools_copy) 
    user_proxy.initiate_chat(
        assistant_agent,
        message="Ask the user what he would like to do.",
        llm_config=llm_config
    )   

    return {"ok": True}

def _update_frontend(message, base_url="http://localhost:3005"):
    # print("Sending: ", self.messages, done_loading)
    global interface_stringio
    global autogen_runtime
    print("Test2")
    try:
        # Filtering observations cause showing that output properly is a menace
        # autogen_runtime.stdout.seek(0)
        if not(autogen_runtime) == None:
            print("Test3")
            # print("Stdout: ", autogen_runtime.stdout.read())
        
            filtered_messages = [{
                "role": "system",
                "content": message
            }]

            print(filtered_messages)

            payload_json = {
                "messages": filtered_messages,
                "done": True
            }
            headers = {
                "Content-Type": "application/json"
            }
            requests.post(base_url + "/messages", json=payload_json, headers=headers)
    except Exception as e:
        print("There was an error sending the message: ", e)


def _send_every_interval():
    global interface_stringio
    global autogen_runtime

    threading.Timer(1.0, _send_every_interval).start()
    # print("Test")
    # print(interface_stringio.read())
    # if autogen_runtime:
    #     print(autogen_runtime.stdout.read())
    _update_frontend()

# @contextmanager
# def redirect_stdin_stdout():
#     global interface_stringio

#     sys.stdout = interface_stringio
#     sys.stdin = interface_stringio
#     yield

@contextmanager
def custom_redirection(fileobj):
    old = sys.stdout
    sys.stdout = fileobj
    try:
        yield fileobj
    finally:
        sys.stdout = old

    
def generate_chat_start_thread_function(folder_name):
    def chat_start_thread_function():
        global interface_stringio
        global autogen_runtime

        autogen_runtime = Popen(['python', '-u', 'run_autogen.py', folder_name], stdin=PIPE, stdout=PIPE, stderr=STDOUT, bufsize=0, universal_newlines=True)
        total_output = ""
        with autogen_runtime as p:
            while True:
                char = p.stdout.read(1)
                total_output += char
                if(char == "\n"):
                    total_output += " "
                _update_frontend(total_output)
            # for line in p.stdout:
            #     total_output += line
            #     print(line, end='')
                # _update_frontend(total_output)
    return chat_start_thread_function
        
    # print("Test 2")
    # with open('test.txt', 'w') as out:
    #     with custom_redirection(interface_stringio):
    #         print('This text is redirected to file')
    #         print('So is this string')
    #     print('This text is printed to stdout')
    # print(interface_stringio.read())

        # user_proxy.initiate_chat(
        #     assistant_agent,
        #     message="Ask the user what task they would like to complete."
        # )

def start_server(folder_name: str, port: int = 54323, frontend_port: int = 3005):
    print("Setting current workspace folder to: ", folder_name)
    global current_project_directory
    global code_collection
    global documentation_collection
    global tools
    global agent_chain
    global embeddings
    global langchain_chroma
    global user_proxy
    global assistant_agent
    global user_proxy_thread
    global autogen_runtime

    current_project_directory = folder_name
    alphanumeric_project_directory = re.sub(r'\W+', '', current_project_directory)
    valid_range = alphanumeric_project_directory[max(0, len(alphanumeric_project_directory) - 58):]
    code_collection_name = valid_range + "c"
    documentation_collection_name = valid_range + "d"

    if len(code_collection_name) < 3:
        code_collection_name = "12c"
    if len(documentation_collection_name) < 3:
        documentation_collection_name = "12d"

    code_collection = chroma_client.get_or_create_collection(name=code_collection_name, embedding_function=embeddings) # separate collection for code and documentation
    langchain_chroma = Chroma.from_texts(["Starter"], embeddings)

    tools = get_tools(folder_name)
    tools.append(Tool.from_function(
        func=create_vectorstore_search_function(langchain_chroma),
        name="Search Vectorstore",
        description="Runs semantic search on the current codebase. Useful for queries that are too semantically complex for regular matching.",
        args_schema=SearchInput
    ))

    setup(tools)
    # _send_every_interval(1000)
    # _send_every_interval()
    # chat_start_thread_function(folder_name)
    user_proxy_thread = Thread(target=generate_chat_start_thread_function(folder_name))
    user_proxy_thread.start()
    uvicorn.run(app, port=port)
if __name__ == "__main__":
    typer.run(start_server)
    